import surveyJson from "../survey.v1.json" with { type: "json" };
import { type Branch, type GenderCode, type Option, type Question, Survey } from "./schema.js";

export * from "./schema.js";
export { validateSurvey, type ValidationIssue } from "./validate.js";

/** Текущая версия конфига, провалидированная при загрузке модуля. */
export const survey: Survey = Survey.parse(surveyJson);

/** Загрузить и провалидировать произвольный конфиг (например, из БД). */
export function parseSurvey(input: unknown): Survey {
  return Survey.parse(input);
}

/** Текст вопроса для пола. Пока пол неизвестен — женская формулировка (как в прототипе). */
export function questionText(q: Question, gender: GenderCode | null): string {
  return typeof q.text === "string" ? q.text : q.text[gender ?? "female"];
}

/** Варианты вопроса для пола. Пока пол неизвестен — женский список (как в прототипе). */
export function questionOptions(q: Question, gender: GenderCode | null): Option[] {
  return Array.isArray(q.options) ? q.options : q.options[gender ?? "female"];
}

/** Ветка для пары пол × категория или null, если недоступна (напр. male × makeup). */
export function findBranch(s: Survey, gender: GenderCode, category: string): Branch | null {
  return s.branches.find((b) => b.category === category && b.genders.includes(gender)) ?? null;
}

/** Все ветки, доступные полу, в порядке категорий вопроса 5. */
export function branchesForGender(s: Survey, gender: GenderCode): Branch[] {
  return s.categories
    .filter((c) => c.label[gender])
    .map((c) => findBranch(s, gender, c.code))
    .filter((b): b is Branch => b !== null);
}

/** Подпись категории для пола (из вопроса 5), либо null если недоступна. */
export function categoryLabel(s: Survey, gender: GenderCode, category: string): string | null {
  return s.categories.find((c) => c.code === category)?.label[gender] ?? null;
}

/** Все вопросы, которые может увидеть пользователь данного пола (база + все его ветки). */
export function questionsForGender(s: Survey, gender: GenderCode): Question[] {
  return [...s.base, ...branchesForGender(s, gender).flatMap((b) => b.questions)];
}
