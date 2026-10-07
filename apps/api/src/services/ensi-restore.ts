/**
 * Восстановление сессии из BeautyProfile, прочитанного из ENSI.
 * Ответы, которые текущий опросник уже не принимает, пропускаются.
 * null — из профиля нельзя собрать завершённую базу, опросник открывается с начала.
 */
import {
  type BeautyProfile,
  type SurveyState,
  applyAnswer,
  completeCategory,
  emptyState,
  isBaseAnswered,
  isBranchAnswered,
  markBaseCompleted,
} from "@idb/core";
import type { Survey } from "@idb/survey-config";

const BASE_ORDER = ["gender", "psycho1", "psycho2", "psycho3", "category"];

export type RestoredSession = {
  state: SurveyState;
  stage: "result1" | "result2";
};

export function restoreStateFromProfile(survey: Survey, profile: BeautyProfile): RestoredSession | null {
  if (profile.schema_version !== "1.0" || !profile.answers?.length) return null;
  let state = emptyState();
  const ordered = [...profile.answers].sort((a, b) => rank(a.question_key) - rank(b.question_key));
  for (const a of ordered) {
    const r = applyAnswer(survey, state, a.question_key, {
      optionCodes: a.option_codes ?? [],
      skipped: a.skipped,
      answeredAt: a.answered_at,
    });
    if (r.ok) state = r.state;
  }
  if (!isBaseAnswered(survey, state)) return null;
  state = markBaseCompleted(state);
  for (const cat of profile.completed_categories ?? []) {
    if (isBranchAnswered(survey, state, cat)) state = completeCategory(state, cat);
  }
  return { state, stage: state.completedCategories.length > 0 ? "result2" : "result1" };
}

function rank(key: string): number {
  const i = BASE_ORDER.indexOf(key);
  return i === -1 ? BASE_ORDER.length : i;
}
