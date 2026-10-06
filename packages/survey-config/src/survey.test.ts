import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { branchesForGender, findBranch, questionOptions, questionText, survey } from "./index.js";
import { validateSurvey } from "./validate.js";

/**
 * Контрольные числа из docs/source/tz.md, раздел 4 «Состав вопросов по веткам».
 * Формат: [topic, type, число вариантов]. Проверяется каждая строка таблицы.
 */
const RTF: Record<string, [string, "single" | "multi", number][]> = {
  female_face: [
    ["Тип кожи", "single", 4],
    ["Состояния и задачи", "multi", 5],
    ["Рутина", "multi", 14],
    ["Очищение", "single", 2],
    ["Факторы влияния", "multi", 7],
    ["Текстуры", "single", 3],
    ["Гаджеты и аксессуары", "multi", 6],
  ],
  male_face: [
    ["Тип кожи", "single", 3],
    ["Состояния и задачи", "multi", 4],
    ["Рутина", "multi", 8],
    ["Бритьё", "multi", 8],
    ["Факторы влияния", "multi", 4],
  ],
  female_hair: [
    ["Тип кожи головы", "single", 4],
    ["Состояние волос", "single", 4],
    ["Особые задачи", "multi", 10],
    ["Частота мытья", "single", 3],
    ["Рутина", "multi", 9],
    ["Аксессуары", "multi", 6],
    ["Средства укладки", "multi", 9],
  ],
  male_hair: [
    ["Тип кожи головы", "single", 4],
    ["Особые задачи", "multi", 4],
    ["Частота мытья", "single", 3],
    ["Рутина", "multi", 4],
    ["Укладка", "single", 3],
    ["Средства укладки", "multi", 4],
  ],
  female_body: [
    ["Тип кожи", "single", 4],
    ["Состояния и задачи", "multi", 6],
    ["Корректирующий уход", "multi", 5],
    ["Ежедневная рутина", "multi", 7],
    ["Аксессуары", "multi", 4],
    ["Образ жизни", "multi", 5],
  ],
  male_body: [
    ["Тип кожи", "single", 3],
    ["Состояния и задачи", "multi", 5],
    ["Ежедневная гигиена", "multi", 7],
    ["Образ жизни", "multi", 5],
  ],
  shared_sun: [
    ["Фототип", "single", 4],
    ["Особенности", "multi", 5],
    ["Условия защиты", "multi", 5],
    ["Рутина", "multi", 6],
    ["Текстуры", "single", 4],
    ["Автозагар", "single", 4],
  ],
  female_makeup: [
    ["Активность", "single", 4],
    ["Предпочитаемые зоны", "multi", 5],
    ["Рутина", "multi", 14],
    ["Интересы", "multi", 6],
    ["Текстуры и эффекты", "multi", 5],
    ["Аксессуары", "multi", 4],
    ["Снятие макияжа", "multi", 5],
    ["Оттенки", "single", 5],
  ],
  shared_perfume: [
    ["Частота", "single", 4],
    ["Коллекция", "single", 4],
    ["Рутина", "multi", 7],
    ["Интенсивность", "single", 4],
    ["Семейства", "multi", 8],
    ["Тип аромата", "single", 4],
  ],
  shared_home: [
    ["Зоны", "multi", 6],
    ["Настроение", "multi", 5],
    ["Формат", "multi", 6],
  ],
};

describe("survey.v1.json — структура", () => {
  it("проходит семантическую валидацию без замечаний", () => {
    expect(validateSurvey(survey)).toEqual([]);
  });

  it("версия и локаль", () => {
    expect(survey.version).toBe("1.0.0");
    expect(survey.locale).toBe("ru-RU");
  });
});

describe("Этап 1 — контрольные числа (ТЗ 6.4)", () => {
  const byKey = Object.fromEntries(survey.base.map((q) => [q.key, q]));

  it("gender: 2 варианта", () => {
    expect(questionOptions(byKey.gender!, null).map((o) => o.code)).toEqual(["female", "male"]);
  });

  it.each([
    ["psycho1", 4],
    ["psycho2", 4],
    ["psycho3", 3],
  ])("%s: %i варианта у обоих полов, семантика голосов одинаковая", (key, n) => {
    const f = questionOptions(byKey[key]!, "female");
    const m = questionOptions(byKey[key]!, "male");
    expect(f).toHaveLength(n);
    expect(m).toHaveLength(n);
    expect(f.map((o) => o.vote)).toEqual(m.map((o) => o.vote));
    expect(f.map((o) => o.vote).slice(0, 3)).toEqual(["E", "P", "L"]);
  });

  it("формулировки psycho-вопросов различаются по полу", () => {
    for (const key of ["psycho1", "psycho2", "psycho3"]) {
      const f = questionOptions(byKey[key]!, "female").map((o) => o.title);
      const m = questionOptions(byKey[key]!, "male").map((o) => o.title);
      expect(f.slice(0, 3)).not.toEqual(m.slice(0, 3));
    }
  });

  it("category: 7 у женщин, 6 у мужчин (без makeup), лицо у мужчин — «Уход за лицом и бритьё»", () => {
    const f = questionOptions(byKey.category!, "female");
    const m = questionOptions(byKey.category!, "male");
    expect(f).toHaveLength(7);
    expect(m).toHaveLength(6);
    expect(m.map((o) => o.categoryCode)).not.toContain("makeup");
    expect(m.find((o) => o.categoryCode === "face")?.title).toBe("Уход за лицом и бритьё");
    expect(f.find((o) => o.categoryCode === "face")?.title).toBe("Уход за лицом");
  });
});

describe("Этап 2 — состав веток 1:1 с таблицами tz.md", () => {
  it("ровно 10 веток в конфиге = 13 веток прототипа (3 общие)", () => {
    expect(survey.branches).toHaveLength(10);
    expect(branchesForGender(survey, "female")).toHaveLength(7);
    expect(branchesForGender(survey, "male")).toHaveLength(6);
  });

  for (const [id, rows] of Object.entries(RTF)) {
    describe(id, () => {
      const branch = survey.branches.find((b) => b.id === id);
      it("ветка существует", () => expect(branch).toBeDefined());
      it(`вопросов: ${rows.length}`, () => expect(branch!.questions).toHaveLength(rows.length));
      rows.forEach(([topic, type, count], i) => {
        it(`№${i + 1} «${topic}» · ${type} · ${count}`, () => {
          const q = branch!.questions[i]!;
          expect(q.topic).toBe(topic);
          expect(q.type).toBe(type);
          expect(questionOptions(q, branch!.genders[0]!)).toHaveLength(count);
        });
      });
    });
  }

  it("мужские sun/perfume/home используют те же вопросы, что женские", () => {
    for (const cat of ["sun", "perfume", "home"]) {
      expect(findBranch(survey, "male", cat)).toBe(findBranch(survey, "female", cat));
    }
  });

  it("male × makeup недоступно", () => {
    expect(findBranch(survey, "male", "makeup")).toBeNull();
  });

  it("ветки body/sun/makeup/perfume/home помечены draft, face/hair — нет", () => {
    const draft = survey.branches
      .filter((b) => b.draft)
      .map((b) => b.category)
      .sort();
    expect(draft).toEqual(["body", "body", "home", "makeup", "perfume", "sun"]);
    expect(
      survey.branches
        .filter((b) => !b.draft)
        .map((b) => b.id)
        .sort(),
    ).toEqual(["female_face", "female_hair", "male_face", "male_hair"]);
  });
});

describe("Виджеты (ТЗ 6.4, 15.1 — источник правды прототип)", () => {
  it("17 виджетов, 6 универсальных", () => {
    expect(survey.widgets).toHaveLength(17);
    expect(survey.widgets.filter((w) => w.segment === "all").map((w) => w.n)).toEqual([1, 2, 3, 7, 12, 17]);
  });

  it.each([
    ["E", 7],
    ["P", 5],
    ["L", 5],
  ] as const)("приоритетных для %s: %i", (t, n) => {
    const prio = survey.widgets.filter((w) => w.segment !== "all" && (w.segment as string[]).includes(t));
    expect(prio).toHaveLength(n);
  });

  it("включает «Общение с комьюнити» и «Геймификация», пропущенные в таблице RTF", () => {
    const names = survey.widgets.map((w) => w.name);
    expect(names).toContain("Общение с комьюнити");
    expect(names).toContain("Геймификация");
  });
});

describe("Посимвольная верность текстов прототипу (ТЗ 6.3.1)", () => {
  const snap = JSON.parse(
    readFileSync(resolve(__dirname, "../../../docs/source/prototype-content.snapshot.json"), "utf8"),
  ) as {
    T: Record<
      string,
      { text: string; opts?: { t: string }[]; byGender?: { ж: { t: string }[]; м: { t: string }[] } }
    >;
    L2: Record<string, { name: string; qs: { text: string; opts: { t: string; s?: string }[] }[] }>;
    TYPES: Record<string, { name: string; desc: string }>;
  };
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  it("базовые вопросы и варианты", () => {
    const protoBase = ["q1", "q2", "q3", "q4", "q5"].map((k) => snap.T[k]!);
    survey.base.forEach((q, i) => {
      const p = protoBase[i]!;
      expect(questionText(q, "female")).toBe(norm(p.text));
      if (p.byGender) {
        expect(questionOptions(q, "female").map((o) => o.title)).toEqual(p.byGender.ж.map((o) => norm(o.t)));
        expect(questionOptions(q, "male").map((o) => o.title)).toEqual(p.byGender.м.map((o) => norm(o.t)));
      } else {
        expect(questionOptions(q, null).map((o) => o.title)).toEqual(p.opts!.map((o) => norm(o.t)));
      }
    });
  });

  it("все ветки: названия, тексты вопросов, заголовки и подзаголовки вариантов", () => {
    const protoKey: Record<string, string> = {
      female_face: "ж_face",
      male_face: "м_face",
      female_hair: "ж_hair",
      male_hair: "м_hair",
      female_body: "ж_body",
      male_body: "м_body",
      shared_sun: "ж_sun",
      female_makeup: "ж_makeup",
      shared_perfume: "ж_perfume",
      shared_home: "ж_home",
    };
    for (const b of survey.branches) {
      const p = snap.L2[protoKey[b.id]!]!;
      expect(b.name).toBe(norm(p.name));
      b.questions.forEach((q, i) => {
        const pq = p.qs[i]!;
        expect(questionText(q, b.genders[0]!)).toBe(norm(pq.text));
        const opts = questionOptions(q, b.genders[0]!);
        expect(opts.map((o) => o.title)).toEqual(pq.opts.map((o) => norm(o.t)));
        expect(opts.map((o) => o.subtitle)).toEqual(pq.opts.map((o) => (o.s ? norm(o.s) : undefined)));
      });
    }
  });

  it("тексты психотипов", () => {
    for (const k of ["E", "P", "L", "M"] as const) {
      expect(survey.psychotypes[k].name).toBe(snap.TYPES[k]!.name);
      expect(survey.psychotypes[k].description).toBe(snap.TYPES[k]!.desc);
    }
  });

  it("в текстах сохранена «ё»", () => {
    const all = JSON.stringify(survey);
    expect(all).toMatch(/ё/);
    expect(all).toContain("чёрные точки");
  });
});
