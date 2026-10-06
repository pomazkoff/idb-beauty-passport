import type { Survey } from "@idb/survey-config";
import { findQuestion, getGender } from "./questions.js";
import type { AnswerRecord, AnswerValidationError, ResolvedQuestion, SurveyState } from "./types.js";

export type ValidationResult = { ok: true } | { ok: false; error: AnswerValidationError };

/** Проверка ответа на вопрос (ТЗ 7.7). */
export function validateAnswer(
  question: ResolvedQuestion,
  optionCodes: string[],
  skipped: boolean,
): ValidationResult {
  const fail = (error: AnswerValidationError): ValidationResult => ({ ok: false, error });

  if (skipped) {
    if (!question.skippable)
      return fail({ code: "VALIDATION_ERROR", message: `Вопрос ${question.key} нельзя пропустить` });
    if (optionCodes.length)
      return fail({ code: "VALIDATION_ERROR", message: "При пропуске optionCodes должен быть пуст" });
    return { ok: true };
  }

  if (new Set(optionCodes).size !== optionCodes.length) {
    return fail({ code: "VALIDATION_ERROR", message: "Коды вариантов повторяются" });
  }
  const allowed = new Map(question.options.map((o) => [o.code, o]));
  for (const code of optionCodes) {
    if (!allowed.has(code)) {
      return fail({
        code: "OPTION_NOT_ALLOWED",
        message: `Вариант ${code} недопустим для вопроса ${question.key}`,
        option: code,
      });
    }
  }

  if (question.type === "single") {
    if (optionCodes.length !== 1)
      return fail({ code: "VALIDATION_ERROR", message: "Нужен ровно один вариант" });
    return { ok: true };
  }

  if (optionCodes.length === 0)
    return fail({ code: "VALIDATION_ERROR", message: "Выберите хотя бы один вариант или пропустите" });
  const exclusive = optionCodes.filter((c) => allowed.get(c)?.exclusive);
  if (exclusive.length && optionCodes.length > 1) {
    return fail({
      code: "VALIDATION_ERROR",
      message: `Вариант ${exclusive[0]} не сочетается с другими`,
      option: exclusive[0],
    } as AnswerValidationError);
  }
  return { ok: true };
}

export type ApplyResult =
  | { ok: true; state: SurveyState; genderReset: boolean }
  | { ok: false; error: AnswerValidationError };

/**
 * Применить ответ и вернуть новое состояние. Смена пола (реальное изменение
 * значения) сбрасывает все остальные ответы и завершённые категории (ТЗ 7.1).
 */
export function applyAnswer(
  survey: Survey,
  state: SurveyState,
  questionKey: string,
  input: { optionCodes: string[]; skipped?: boolean; answeredAt?: string; timeMs?: number },
): ApplyResult {
  const question = findQuestion(survey, state, questionKey);
  if (!question)
    return { ok: false, error: { code: "QUESTION_NOT_FOUND", message: `Вопрос ${questionKey} недоступен` } };

  const skipped = Boolean(input.skipped);
  const v = validateAnswer(question, input.optionCodes, skipped);
  if (!v.ok) return v;

  const record: AnswerRecord = { optionCodes: skipped ? [] : [...input.optionCodes], skipped };
  if (input.answeredAt) record.answeredAt = input.answeredAt;
  if (input.timeMs !== undefined) record.timeMs = input.timeMs;

  if (questionKey === "gender") {
    const prev = getGender(state);
    const next = record.optionCodes[0];
    if (prev && prev !== next) {
      return {
        ok: true,
        genderReset: true,
        state: { answers: { gender: record }, completedCategories: [], baseCompleted: false },
      };
    }
  }

  return {
    ok: true,
    genderReset: false,
    state: { ...state, answers: { ...state.answers, [questionKey]: record } },
  };
}

/** Отметить категорию пройденной; повтор не дублирует (ТЗ 7.4). */
export function completeCategory(
  state: SurveyState,
  category: SurveyState["completedCategories"][number],
): SurveyState {
  if (state.completedCategories.includes(category)) return state;
  return { ...state, completedCategories: [...state.completedCategories, category] };
}

export function markBaseCompleted(state: SurveyState): SurveyState {
  return state.baseCompleted ? state : { ...state, baseCompleted: true };
}
