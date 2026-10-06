import { survey } from "@idb/survey-config";
import { describe, expect, it } from "vitest";
import { applyAnswer, completeCategory, markBaseCompleted, validateAnswer } from "./answers.js";
import { buildProfile, computeCompleteness, derive, selectWidgets } from "./profile.js";
import { computePsychotype, getVotes } from "./psychotype.js";
import {
  findQuestion,
  firstUnanswered,
  getBaseQuestions,
  getBranchQuestions,
  getGender,
  isBaseAnswered,
  isBranchAnswered,
  remainingCategories,
} from "./questions.js";
import { type PsychoVote, type SurveyState, emptyState } from "./types.js";

// ── helpers ────────────────────────────────────────────────────────
function answer(state: SurveyState, key: string, codes: string[], skipped = false): SurveyState {
  const r = applyAnswer(survey, state, key, { optionCodes: codes, skipped });
  if (!r.ok) throw new Error(`${key}: ${r.error.message}`);
  return r.state;
}

function base(
  gender: "female" | "male",
  votes: [PsychoVote, PsychoVote, PsychoVote],
  category = "face",
): SurveyState {
  let s = emptyState();
  s = answer(s, "gender", [gender]);
  s = answer(s, "psycho1", [votes[0]]);
  s = answer(s, "psycho2", [votes[1]]);
  s = answer(s, "psycho3", [votes[2]]);
  s = answer(s, "category", [category]);
  return markBaseCompleted(s);
}

/** Ответить на все вопросы ветки: single — первый вариант, multi — первые два неисключающих. */
function passBranch(state: SurveyState, category: string, skipAll = false): SurveyState {
  const gender = getGender(state)!;
  const qs = getBranchQuestions(survey, gender, category as never)!;
  let s = state;
  for (const q of qs) {
    if (q.type === "single") s = answer(s, q.key, [q.options[0]!.code]);
    else if (skipAll) s = answer(s, q.key, [], true);
    else
      s = answer(
        s,
        q.key,
        q.options
          .filter((o) => !o.exclusive)
          .slice(0, 2)
          .map((o) => o.code),
      );
  }
  return completeCategory(s, category as never);
}

// ── Психотип (ТЗ 7.2, проверочные случаи tz.md) ────────────────────
describe("computePsychotype", () => {
  it.each<[PsychoVote[], string]>([
    [["E", "E", "E"], "E"],
    [["E", "E", "P"], "E"],
    [["E", "P", "L"], "M"], // ничья трёх
    [["M", "M", "E"], "M"], // два «не подходит»
    [["M", "E", "E"], "E"],
    [[], "M"], // нет голосов
    [["M", "P", "L"], "M"], // ничья двух
    [["P", "P", "L"], "P"],
    [["L", "L", "M"], "L"],
    [["M"], "M"],
    [["P"], "P"], // неполный набор — считаем по имеющимся
    [["E", "L"], "M"],
  ])("%j → %s", (votes, expected) => {
    expect(computePsychotype(votes)).toBe(expected);
  });
});

describe("getVotes", () => {
  it("собирает голоса из ответов по полу", () => {
    expect(getVotes(survey, base("female", ["E", "P", "L"]))).toEqual(["E", "P", "L"]);
    expect(getVotes(survey, base("male", ["M", "M", "P"]))).toEqual(["M", "M", "P"]);
  });
  it("без пола — пусто", () => {
    expect(getVotes(survey, emptyState())).toEqual([]);
  });
  it("частично отвеченная база — только имеющиеся", () => {
    let s = answer(emptyState(), "gender", ["female"]);
    s = answer(s, "psycho2", ["L"]);
    expect(getVotes(survey, s)).toEqual(["L"]);
  });
});

// ── Ветвление (ТЗ 7.1) ──────────────────────────────────────────────
describe("ветвление по полу", () => {
  it("до выбора пола доступен только вопрос gender", () => {
    expect(getBaseQuestions(survey, null).map((q) => q.key)).toEqual(["gender"]);
    expect(findQuestion(survey, emptyState(), "psycho1")).toBeNull();
    expect(findQuestion(survey, emptyState(), "gender")).not.toBeNull();
  });

  it("формулировки psycho-вопросов зависят от пола", () => {
    const f = getBaseQuestions(survey, "female").find((q) => q.key === "psycho1")!;
    const m = getBaseQuestions(survey, "male").find((q) => q.key === "psycho1")!;
    expect(f.options[0]!.title).not.toBe(m.options[0]!.title);
    expect(f.options.map((o) => o.vote)).toEqual(m.options.map((o) => o.vote));
  });

  it("male × makeup → null, female × makeup → 8 вопросов", () => {
    expect(getBranchQuestions(survey, "male", "makeup")).toBeNull();
    expect(getBranchQuestions(survey, "female", "makeup")).toHaveLength(8);
  });

  it("смена пола сбрасывает всё, кроме пола", () => {
    let s = base("female", ["E", "E", "E"], "makeup");
    s = passBranch(s, "makeup");
    expect(s.completedCategories).toEqual(["makeup"]);
    const r = applyAnswer(survey, s, "gender", { optionCodes: ["male"] });
    expect(r.ok && r.genderReset).toBe(true);
    if (!r.ok) throw new Error();
    expect(Object.keys(r.state.answers)).toEqual(["gender"]);
    expect(r.state.completedCategories).toEqual([]);
    expect(r.state.baseCompleted).toBe(false);
  });

  it("повторный выбор того же пола ничего не сбрасывает", () => {
    const s = base("female", ["E", "E", "E"]);
    const r = applyAnswer(survey, s, "gender", { optionCodes: ["female"] });
    expect(r.ok && !r.genderReset).toBe(true);
    if (!r.ok) throw new Error();
    expect(Object.keys(r.state.answers)).toHaveLength(5);
  });

  it("remainingCategories: женщине 7 категорий минус пройденные, мужчине 6", () => {
    const f = passBranch(base("female", ["E", "E", "E"]), "face");
    expect(remainingCategories(survey, f)).toEqual(["body", "hair", "sun", "makeup", "perfume", "home"]);
    expect(remainingCategories(survey, base("male", ["P", "P", "P"]))).toEqual([
      "face",
      "body",
      "hair",
      "sun",
      "perfume",
      "home",
    ]);
    expect(remainingCategories(survey, emptyState())).toEqual([]);
  });
});

// ── Валидация (ТЗ 7.7) ──────────────────────────────────────────────
describe("validateAnswer / applyAnswer", () => {
  const s = base("female", ["E", "E", "E"]);
  const skin = getBranchQuestions(survey, "female", "face")![0]!; // single
  const concerns = getBranchQuestions(survey, "female", "face")![1]!; // multi, есть exclusive

  it("single: ровно один допустимый код", () => {
    expect(validateAnswer(skin, ["oily"], false).ok).toBe(true);
    expect(validateAnswer(skin, [], false)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(validateAnswer(skin, ["oily", "dry"], false)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(validateAnswer(skin, ["nope"], false)).toMatchObject({
      ok: false,
      error: { code: "OPTION_NOT_ALLOWED", option: "nope" },
    });
  });

  it("single нельзя пропустить, multi — можно", () => {
    expect(validateAnswer(skin, [], true)).toMatchObject({ ok: false });
    expect(validateAnswer(concerns, [], true).ok).toBe(true);
    expect(validateAnswer(concerns, ["dull"], true)).toMatchObject({ ok: false });
  });

  it("multi: ≥1 код, без дублей, exclusive — только один", () => {
    expect(validateAnswer(concerns, [], false)).toMatchObject({ ok: false });
    expect(validateAnswer(concerns, ["dull", "dull"], false)).toMatchObject({ ok: false });
    expect(validateAnswer(concerns, ["dull", "aging"], false).ok).toBe(true);
    expect(validateAnswer(concerns, ["none"], false).ok).toBe(true);
    expect(validateAnswer(concerns, ["none", "dull"], false)).toMatchObject({
      ok: false,
      error: { option: "none" },
    });
  });

  it("вариант другого пола недопустим", () => {
    const m = applyAnswer(survey, s, "category", { optionCodes: ["makeup"] });
    expect(m.ok).toBe(true); // женщине можно
    const male = base("male", ["P", "P", "P"]);
    expect(applyAnswer(survey, male, "category", { optionCodes: ["makeup"] })).toMatchObject({
      ok: false,
      error: { code: "OPTION_NOT_ALLOWED" },
    });
  });

  it("неизвестный вопрос", () => {
    expect(applyAnswer(survey, s, "nope", { optionCodes: ["x"] })).toMatchObject({
      ok: false,
      error: { code: "QUESTION_NOT_FOUND" },
    });
    // вопрос мужской ветки недоступен женщине
    expect(applyAnswer(survey, s, "face_shaving", { optionCodes: ["razor"] })).toMatchObject({
      ok: false,
      error: { code: "QUESTION_NOT_FOUND" },
    });
  });

  it("сохраняет answeredAt и timeMs", () => {
    const r = applyAnswer(survey, s, "face_skin_type", {
      optionCodes: ["dry"],
      answeredAt: "2026-10-06T00:00:00Z",
      timeMs: 1234,
    });
    if (!r.ok) throw new Error();
    expect(r.state.answers.face_skin_type).toEqual({
      optionCodes: ["dry"],
      skipped: false,
      answeredAt: "2026-10-06T00:00:00Z",
      timeMs: 1234,
    });
  });
});

// ── Заполненность (ТЗ 7.3, 7.4) ─────────────────────────────────────
describe("computeCompleteness", () => {
  it("0 → 40 → 60 → 80 → 100, четвёртая категория не добавляет", () => {
    let s = emptyState();
    expect(computeCompleteness(survey, s)).toBe(0);
    s = base("female", ["E", "E", "E"]);
    expect(computeCompleteness(survey, s)).toBe(40);
    s = passBranch(s, "face");
    expect(computeCompleteness(survey, s)).toBe(60);
    s = passBranch(s, "hair");
    expect(computeCompleteness(survey, s)).toBe(80);
    s = passBranch(s, "body");
    expect(computeCompleteness(survey, s)).toBe(100);
    s = passBranch(s, "sun");
    expect(computeCompleteness(survey, s)).toBe(100);
    expect(s.completedCategories).toEqual(["face", "hair", "body", "sun"]);
  });

  it("повтор категории не добавляет процент", () => {
    let s = passBranch(base("male", ["P", "P", "P"]), "face");
    s = passBranch(s, "face");
    expect(s.completedCategories).toEqual(["face"]);
    expect(computeCompleteness(survey, s)).toBe(60);
  });

  it("категория со всеми пропущенными multi считается завершённой (COUNT_SKIPPED_CATEGORY)", () => {
    const s = passBranch(base("female", ["E", "E", "E"]), "face", true);
    expect(isBranchAnswered(survey, s, "face")).toBe(true);
    expect(computeCompleteness(survey, s)).toBe(60);
  });

  it("база без флага baseCompleted — 0 даже при всех ответах", () => {
    const s = { ...base("female", ["E", "E", "E"]), baseCompleted: false };
    expect(isBaseAnswered(survey, s)).toBe(true);
    expect(computeCompleteness(survey, s)).toBe(0);
  });
});

// ── Виджеты (ТЗ 7.5) ────────────────────────────────────────────────
describe("selectWidgets", () => {
  const nums = (ws: { n: number }[]) => ws.map((w) => w.n);
  it("E: 7 приоритетных", () =>
    expect(nums(selectWidgets(survey, "E").priority)).toEqual([5, 6, 8, 9, 10, 14, 16]));
  it("P: 5 приоритетных", () =>
    expect(nums(selectWidgets(survey, "P").priority)).toEqual([4, 8, 11, 13, 15]));
  it("L: 5 приоритетных", () =>
    expect(nums(selectWidgets(survey, "L").priority)).toEqual([6, 11, 13, 14, 15]));
  it("M: все 11 неуниверсальных", () =>
    expect(nums(selectWidgets(survey, "M").priority)).toEqual([4, 5, 6, 8, 9, 10, 11, 13, 14, 15, 16]));
  it("базовые для всех — 6, одинаковые", () => {
    for (const t of ["E", "P", "L", "M"] as const)
      expect(nums(selectWidgets(survey, t).base)).toEqual([1, 2, 3, 7, 12, 17]);
  });
});

// ── derive / firstUnanswered ────────────────────────────────────────
describe("derive", () => {
  it("пустое состояние", () => {
    expect(derive(survey, emptyState())).toMatchObject({
      gender: null,
      baseComplete: false,
      psychotype: "M",
      primaryCategory: null,
      completenessPct: 0,
    });
  });
  it("после базы", () => {
    const d = derive(survey, base("male", ["L", "L", "P"], "perfume"));
    expect(d).toMatchObject({
      gender: "male",
      baseComplete: true,
      psychotype: "L",
      primaryCategory: "perfume",
      completenessPct: 40,
    });
    expect(d.votes).toEqual({ E: 0, P: 1, L: 2, M: 0 });
    expect(d.widgets.priority).toEqual([
      "beauty_services",
      "beauty_calendar",
      "product_subscription",
      "closed_sales",
      "expert_selections",
    ]);
  });
  it("firstUnanswered возвращает следующий вопрос и null в конце", () => {
    let s = answer(emptyState(), "gender", ["female"]);
    const qs = getBaseQuestions(survey, "female");
    expect(firstUnanswered(qs, s)?.key).toBe("psycho1");
    s = base("female", ["E", "E", "E"]);
    expect(firstUnanswered(qs, s)).toBeNull();
  });
});

// ── Профиль (ТЗ 7.6, 10.2) ──────────────────────────────────────────
describe("buildProfile", () => {
  const meta = { customerId: "c-1", revision: 2, updatedAt: "2026-10-06T07:30:00Z" };

  it("бросает без пола", () => {
    expect(() => buildProfile(survey, emptyState(), meta)).toThrow();
  });

  it("собирает контракт, traits и tags; незавершённая ветка не попадает", () => {
    let s = base("female", ["E", "P", "E"], "face");
    s = answer(s, "face_skin_type", ["combination"]);
    s = answer(s, "face_concerns", ["dehydrated", "dull"]);
    s = answer(s, "face_routine", [], true);
    s = answer(s, "face_cleansing", ["with_water"]);
    s = answer(s, "face_factors", ["hard_water"]);
    s = answer(s, "face_texture", ["light"]);
    s = answer(s, "face_gadgets", ["none"]);
    s = completeCategory(s, "face");
    // начатая, но не завершённая ветка волос
    s = answer(s, "hair_scalp_type", ["dry"]);

    const p = buildProfile(survey, s, meta);
    expect(p).toMatchObject({
      schema_version: "1.0",
      customer_id: "c-1",
      profile_revision: 2,
      survey_version: "1.0.0",
      updated_at: meta.updatedAt,
      gender: "female",
      psychotype: { code: "E", name: "Эмоциональный", votes: { E: 2, P: 1, L: 0, M: 0 } },
      primary_category: "face",
      completed_categories: ["face"],
      completeness_pct: 60,
    });
    expect(p.widgets.priority).toHaveLength(7);
    expect(p.answers.map((a) => a.question_key)).toEqual([
      "gender",
      "psycho1",
      "psycho2",
      "psycho3",
      "category",
      "face_skin_type",
      "face_concerns",
      "face_routine",
      "face_cleansing",
      "face_factors",
      "face_texture",
      "face_gadgets",
    ]);
    expect(p.answers.find((a) => a.question_key === "face_routine")).toMatchObject({
      skipped: true,
      option_codes: [],
      category: "face",
      stage: "passport",
    });
    expect(p.traits).toEqual({
      "face.skin_type": ["combination"],
      "face.concerns": ["dehydrated", "dull"],
      "face.cleansing": ["with_water"],
      "face.factors": ["hard_water"],
      "face.texture": ["light"],
      "face.gadgets": ["none"],
    });
    expect(p.tags).toEqual(["skin_state:dehydrated", "skin_state:dull", "skin_type:combination"]);
  });

  it("снапшот профиля мужчины P после базы", () => {
    const p = buildProfile(survey, base("male", ["P", "P", "L"], "hair"), meta);
    expect(p).toMatchSnapshot();
  });
});
