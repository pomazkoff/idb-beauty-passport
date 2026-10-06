import {
  type Branch,
  type Question,
  type Survey,
  branchesForGender,
  findBranch,
  questionOptions,
  questionText,
} from "@idb/survey-config";
import type { CategoryCode, GenderCode, ResolvedQuestion, SurveyState } from "./types.js";

/** Пол из ответа на первый вопрос. */
export function getGender(state: SurveyState): GenderCode | null {
  const code = state.answers.gender?.optionCodes[0];
  return code === "female" || code === "male" ? code : null;
}

/** Категория из вопроса 5 — точка входа в Паспорт. */
export function getPrimaryCategory(survey: Survey, state: SurveyState): CategoryCode | null {
  const code = state.answers.category?.optionCodes[0];
  return survey.categories.some((c) => c.code === code) ? (code as CategoryCode) : null;
}

function resolve(
  q: Question,
  gender: GenderCode | null,
  stage: "base" | "passport",
  category?: CategoryCode,
): ResolvedQuestion {
  const r: ResolvedQuestion = {
    key: q.key,
    stage,
    block: q.block,
    type: q.type,
    skippable: q.skippable,
    draft: Boolean(q.draft),
    text: questionText(q, gender),
    options: questionOptions(q, gender).filter((o) => !o.deprecated),
  };
  if (q.topic) r.topic = q.topic;
  if (category) r.category = category;
  return r;
}

/**
 * Базовые вопросы под пол. Пока пол не выбран, отдаём только первый вопрос:
 * формулировки остальных зависят от ответа (ТЗ 7.1).
 */
export function getBaseQuestions(survey: Survey, gender: GenderCode | null): ResolvedQuestion[] {
  if (!gender) return [resolve(survey.base[0]!, null, "base")];
  return survey.base.map((q) => resolve(q, gender, "base"));
}

/** Вопросы ветки Паспорта или null, если ветка недоступна полу. */
export function getBranchQuestions(
  survey: Survey,
  gender: GenderCode,
  category: CategoryCode,
): ResolvedQuestion[] | null {
  const branch = findBranch(survey, gender, category);
  if (!branch) return null;
  return branch.questions.map((q) => resolve(q, gender, "passport", category));
}

/** Все вопросы, доступные полу, с метаданными этапа и категории. */
export function getAllQuestions(survey: Survey, gender: GenderCode): ResolvedQuestion[] {
  return [
    ...getBaseQuestions(survey, gender),
    ...branchesForGender(survey, gender).flatMap((b: Branch) =>
      b.questions.map((q) => resolve(q, gender, "passport", b.category)),
    ),
  ];
}

/** Найти вопрос по ключу среди доступных пользователю (по текущему полу). */
export function findQuestion(survey: Survey, state: SurveyState, key: string): ResolvedQuestion | null {
  const gender = getGender(state);
  if (!gender) return key === "gender" ? getBaseQuestions(survey, null)[0]! : null;
  return getAllQuestions(survey, gender).find((q) => q.key === key) ?? null;
}

/** Отвечен ли вопрос (ответ или пропуск). */
export function isAnswered(state: SurveyState, key: string): boolean {
  const a = state.answers[key];
  return !!a && (a.skipped || a.optionCodes.length > 0);
}

/** Первый неотвеченный вопрос в списке или null, если все отвечены. */
export function firstUnanswered(questions: ResolvedQuestion[], state: SurveyState): ResolvedQuestion | null {
  return questions.find((q) => !isAnswered(state, q.key)) ?? null;
}

/** База завершена, когда отвечены все 5 вопросов. */
export function isBaseAnswered(survey: Survey, state: SurveyState): boolean {
  const gender = getGender(state);
  if (!gender) return false;
  return getBaseQuestions(survey, gender).every((q) => isAnswered(state, q.key));
}

/** Ветка пройдена, когда каждый её вопрос отвечен или пропущен. */
export function isBranchAnswered(survey: Survey, state: SurveyState, category: CategoryCode): boolean {
  const gender = getGender(state);
  if (!gender) return false;
  const qs = getBranchQuestions(survey, gender, category);
  return !!qs && qs.every((q) => isAnswered(state, q.key));
}

/** Категории, доступные полу и ещё не пройденные (для экрана «Добавьте ещё категорию»). */
export function remainingCategories(survey: Survey, state: SurveyState): CategoryCode[] {
  const gender = getGender(state);
  if (!gender) return [];
  return survey.categories
    .filter((c) => c.label[gender] && !state.completedCategories.includes(c.code))
    .map((c) => c.code);
}
