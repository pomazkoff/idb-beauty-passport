import type { GenderCode, Option, Question, Survey } from "@idb/survey-config";
import { slugify, uniqueSlug } from "@idb/survey-config";

export type Path = (string | number)[];

/** Иммутабельная установка по пути. */
export function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (!path.length) return value as T;
  const [head, ...rest] = path;
  const copy: unknown = Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as object) };
  (copy as Record<string | number, unknown>)[head!] = setIn(
    (obj as Record<string | number, unknown>)[head!],
    rest,
    value,
  );
  return copy as T;
}

export function getIn(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string | number, unknown>)[k]),
    obj,
  );
}

/** Замороженные ключи/коды опубликованной версии (ТЗ 6.1): удалять и переименовывать нельзя. */
export type Frozen = { questions: Set<string>; options: Map<string, Set<string>>; widgets: Set<string> };

export function frozenOf(published: Survey | null): Frozen {
  const f: Frozen = { questions: new Set(), options: new Map(), widgets: new Set() };
  if (!published) return f;
  const add = (q: Question) => {
    f.questions.add(q.key);
    const codes = f.options.get(q.key) ?? new Set<string>();
    const lists = Array.isArray(q.options) ? [q.options] : [q.options.female, q.options.male];
    for (const list of lists) for (const o of list) codes.add(o.code);
    f.options.set(q.key, codes);
  };
  for (const q of published.base) add(q);
  for (const b of published.branches) for (const q of b.questions) add(q);
  for (const w of published.widgets) f.widgets.add(w.code);
  return f;
}

export function optionsOf(q: Question, gender: GenderCode): Option[] {
  return Array.isArray(q.options) ? q.options : q.options[gender];
}

export function nextOptionCode(title: string, q: Question): string {
  const taken = new Set<string>();
  const lists = Array.isArray(q.options) ? [q.options] : [q.options.female, q.options.male];
  for (const list of lists) for (const o of list) taken.add(o.code);
  return uniqueSlug(slugify(title || "option", 3), taken);
}

export function nextQuestionKey(category: string, topic: string, survey: Survey, gender: GenderCode): string {
  const taken = new Set<string>(survey.base.map((q) => q.key));
  for (const b of survey.branches)
    if (b.genders.includes(gender)) for (const q of b.questions) taken.add(q.key);
  return uniqueSlug(`${category}_${slugify(topic || "question", 2)}`, taken);
}

export function nextWidgetCode(name: string, survey: Survey): string {
  return uniqueSlug(
    slugify(name || "widget", 3),
    survey.widgets.map((w) => w.code),
  );
}

export function bumpVersion(v: string, part: "patch" | "minor" | "major" = "minor"): string {
  const [a = 0, b = 0, c = 0] = v.split(".").map(Number);
  if (part === "major") return `${a + 1}.0.0`;
  if (part === "minor") return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

export const GENDER_LABEL: Record<GenderCode, string> = { female: "Женщины", male: "Мужчины" };
export const CATEGORY_CODES = ["face", "body", "hair", "sun", "makeup", "perfume", "home"] as const;

export function emptyQuestion(key: string, block: string, topic: string): Question {
  return {
    key,
    block,
    topic,
    type: "single",
    skippable: false,
    text: "",
    options: [{ code: "option_1", title: "" }],
  };
}
