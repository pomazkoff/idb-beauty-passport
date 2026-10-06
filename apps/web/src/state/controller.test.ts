/**
 * Тест контроллера на фейковом API, собранном поверх реального движка @idb/core —
 * поведение сервера воспроизводится точно, без сети и БД.
 */
import {
  type SurveyState,
  applyAnswer,
  buildProfile,
  completeCategory,
  derive,
  emptyState,
  getBaseQuestions,
  getBranchQuestions,
  markBaseCompleted,
} from "@idb/core";
import { type Survey, branchesForGender, questionOptions, questionText, survey } from "@idb/survey-config";
import { beforeEach, describe, expect, it } from "vitest";
import { Analytics, type AnalyticsEvent } from "../analytics.js";
import type { ApiClient } from "../api/client.js";
import type { ApiQuestion, Category, Gender, SessionStage, SessionView, SurveyConfig } from "../api/types.js";
import { QuizController } from "./controller.js";

class FakeApi {
  state: SurveyState = emptyState();
  stage: SessionStage = "intro";
  activeCategory: Category | null = null;
  revision = 0;
  calls: string[] = [];
  events: unknown[] = [];

  private view(): SessionView {
    return {
      sessionId: "s1",
      surveyVersion: survey.version,
      stage: this.stage,
      activeCategory: this.activeCategory,
      answers: this.state.answers,
      derived: derive(survey, this.state),
    };
  }
  getSurvey = async (gender: Gender | null): Promise<SurveyConfig> => {
    this.calls.push(`survey:${gender}`);
    return toConfig(survey, gender);
  };
  getSession = async () => this.view();
  putAnswer = async (key: string, optionCodes: string[], skipped: boolean) => {
    this.calls.push(`put:${key}`);
    const r = applyAnswer(survey, this.state, key, { optionCodes, skipped });
    if (!r.ok) throw new Error(r.error.message);
    this.state = r.state;
    if (this.stage === "intro") this.stage = "base";
    return { session: this.view(), genderReset: r.genderReset };
  };
  completeBase = async () => {
    this.calls.push("completeBase");
    this.state = markBaseCompleted(this.state);
    this.stage = "result1";
    return buildProfile(survey, this.state, { customerId: "c", revision: ++this.revision, updatedAt: "now" });
  };
  startPassport = async (category: Category) => {
    this.stage = "passport";
    this.activeCategory = category;
    return this.view();
  };
  completePassport = async (category: Category) => {
    this.calls.push(`completePassport:${category}`);
    this.state = completeCategory(this.state, category);
    this.stage = "result2";
    this.activeCategory = null;
    return buildProfile(survey, this.state, { customerId: "c", revision: ++this.revision, updatedAt: "now" });
  };
  reset = async () => {
    this.state = emptyState();
    this.stage = "intro";
    return this.view();
  };
  getProfile = async () => ({
    profile: null,
    ensi: { status: "none", revision: null, lastAttemptAt: null, attempts: 0, lastError: null },
  });
  sendEvents = async (e: unknown[]) => {
    this.events.push(...e);
  };
}

function toConfig(s: Survey, gender: Gender | null): SurveyConfig {
  const base = getBaseQuestions(s, gender) as unknown as ApiQuestion[];
  const branches = gender
    ? branchesForGender(s, gender).map((b) => ({
        id: b.id,
        category: b.category,
        name: b.name,
        draft: Boolean(b.draft),
        questions: b.questions.map((q) => ({
          key: q.key,
          block: q.block,
          topic: q.topic,
          type: q.type,
          skippable: q.skippable,
          draft: Boolean(q.draft),
          text: questionText(q, gender),
          options: questionOptions(q, gender),
        })),
      }))
    : [];
  return {
    version: s.version,
    gender,
    genders: s.genders,
    categories: s.categories,
    base,
    branches,
    psychotypes: s.psychotypes,
    widgets: s.widgets,
    completeness: s.completeness,
    screens: { ...s.screens } as SurveyConfig["screens"],
    ui: s.ui,
    flags: { showDraftBadge: true, countSkippedCategory: true },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) await tick();
};

let api: FakeApi;
let ctrl: QuizController;
let events: AnalyticsEvent[];

beforeEach(async () => {
  api = new FakeApi();
  events = [];
  const analytics = new Analytics(api as unknown as ApiClient, (e) => events.push(e), 10_000);
  ctrl = new QuizController(api as unknown as ApiClient, analytics);
  await ctrl.init();
});

describe("QuizController", () => {
  it("intro → база: после выбора пола очередь перестраивается на 5 вопросов", async () => {
    expect(ctrl.getState().phase).toBe("intro");
    ctrl.start();
    expect(ctrl.queue.map((q) => q.key)).toEqual(["gender"]);
    ctrl.selectSingle("female");
    await settle();
    expect(api.calls).toContain("survey:female");
    expect(ctrl.queue).toHaveLength(5);
    expect(ctrl.current?.key).toBe("psycho1");
    expect(ctrl.index).toBe(1);
  });

  it("ответы идут по порядку, «Назад» возвращает, завершение базы → result1", async () => {
    ctrl.start();
    ctrl.selectSingle("male");
    await settle();
    ctrl.selectSingle("E");
    expect(ctrl.current?.key).toBe("psycho2");
    ctrl.selectSingle("E");
    expect(ctrl.current?.key).toBe("psycho3");
    ctrl.back();
    expect(ctrl.current?.key).toBe("psycho2");
    ctrl.selectSingle("P");
    expect(ctrl.current?.key).toBe("psycho3");
    ctrl.selectSingle("E");
    expect(ctrl.current?.key).toBe("category");
    ctrl.selectSingle("perfume");
    await settle();
    expect(ctrl.getState().phase).toBe("result1");
    expect(ctrl.getState().session?.derived).toMatchObject({
      psychotype: "E",
      completenessPct: 40,
      primaryCategory: "perfume",
    });
    expect(api.calls.filter((c) => c.startsWith("put:"))).toEqual([
      "put:gender",
      "put:psycho1",
      "put:psycho2",
      "put:psycho2",
      "put:psycho3",
      "put:category",
    ]);
    const names = events.map((e) => e.name);
    expect(names).toContain("quiz_started");
    expect(names).toContain("quiz_back");
    expect(names).toContain("quiz_base_completed");
    expect(names[names.length - 1]).toBe("passport_announce_shown");
  });

  it("смена пола через «Назад» сбрасывает ответы", async () => {
    ctrl.start();
    ctrl.selectSingle("female");
    await settle();
    ctrl.selectSingle("E");
    ctrl.back();
    ctrl.back();
    expect(ctrl.current?.key).toBe("gender");
    ctrl.selectSingle("male");
    await settle();
    expect(Object.keys(ctrl.getState().session!.answers)).toEqual(["gender"]);
    expect(ctrl.getState().survey?.gender).toBe("male");
    expect(ctrl.current?.key).toBe("psycho1");
  });

  it("multi: exclusive снимает остальные, «Далее» сохраняет, «Пропустить» — пустой ответ", async () => {
    ctrl.start();
    ctrl.selectSingle("female");
    await settle();
    for (const c of ["E", "E", "E", "face"]) ctrl.selectSingle(c);
    await settle();
    ctrl.startPassport("face");
    await settle();
    expect(ctrl.current?.key).toBe("face_skin_type");
    ctrl.selectSingle("dry");
    expect(ctrl.current?.key).toBe("face_concerns");
    ctrl.toggleMulti("dull");
    ctrl.toggleMulti("aging");
    expect(ctrl.getState().multiSel).toEqual(["dull", "aging"]);
    ctrl.toggleMulti("none");
    expect(ctrl.getState().multiSel).toEqual(["none"]);
    ctrl.toggleMulti("dull");
    expect(ctrl.getState().multiSel).toEqual(["dull"]);
    ctrl.next();
    expect(ctrl.current?.key).toBe("face_routine");
    ctrl.skip();
    await settle();
    expect(api.state.answers.face_routine).toEqual({ optionCodes: [], skipped: true });
    expect(events.map((e) => e.name)).toContain("quiz_question_skipped");
  });

  it("категория завершается → result2 с 60%, вторая категория — passport_category_added", async () => {
    ctrl.start();
    ctrl.selectSingle("male");
    await settle();
    for (const c of ["P", "P", "P", "home"]) ctrl.selectSingle(c);
    await settle();
    ctrl.startPassport("home");
    await settle();
    const qs = getBranchQuestions(survey, "male", "home")!;
    for (const q of qs) {
      ctrl.toggleMulti(q.options[0]!.code);
      ctrl.next();
    }
    await settle();
    expect(ctrl.getState().phase).toBe("result2");
    expect(ctrl.getState().session?.derived.completenessPct).toBe(60);
    ctrl.startPassport("perfume", true);
    await settle();
    expect(ctrl.getState().phase).toBe("question");
    expect(ctrl.current?.key).toBe("perfume_frequency");
    const added = events.find((e) => e.name === "passport_category_added");
    expect(added?.params).toMatchObject({ category: "perfume", already_done: ["home"] });
  });

  it("восстановление: сессия на стадии passport продолжается с первого неотвеченного", async () => {
    const a = new FakeApi();
    a.state = markBaseCompleted(
      ["gender:female", "psycho1:E", "psycho2:E", "psycho3:E", "category:hair", "hair_scalp_type:dry"].reduce(
        (st, kv) => {
          const [k, v] = kv.split(":") as [string, string];
          const r = applyAnswer(survey, st, k, { optionCodes: [v] });
          if (!r.ok) throw new Error(r.error.message);
          return r.state;
        },
        emptyState(),
      ),
    );
    a.stage = "passport";
    a.activeCategory = "hair";
    const c = new QuizController(
      a as unknown as ApiClient,
      new Analytics(a as unknown as ApiClient, undefined, 10_000),
    );
    await c.init();
    expect(c.getState().phase).toBe("question");
    expect(c.current?.key).toBe("hair_condition");
    expect(c.index).toBe(1);
  });

  it("reset возвращает на intro", async () => {
    ctrl.start();
    ctrl.selectSingle("female");
    await settle();
    await ctrl.reset();
    expect(ctrl.getState().phase).toBe("intro");
    expect(ctrl.getState().survey?.gender).toBeNull();
  });
});
