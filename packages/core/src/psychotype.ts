import type { Survey } from "@idb/survey-config";
import { getBaseQuestions, getGender } from "./questions.js";
import type { PsychoVote, PsychotypeCode, SurveyState, Votes } from "./types.js";

export const PSYCHO_KEYS = ["psycho1", "psycho2", "psycho3"] as const;

export function countVotes(votes: PsychoVote[]): Votes {
  const c: Votes = { E: 0, P: 0, L: 0, M: 0 };
  for (const v of votes) c[v]++;
  return c;
}

/**
 * Алгоритм присвоения психотипа (ТЗ 7.2, tz.md раздел 3). Правила в порядке проверки:
 * 1. M ≥ 2 → M.  2. Максимум голосов E/P/L побеждает.  3. Ничья → M.  4. Нет голосов → M.
 */
export function computePsychotype(votes: PsychoVote[]): PsychotypeCode {
  const c = countVotes(votes);
  if (c.M >= 2) return "M";
  const max = Math.max(c.E, c.P, c.L);
  if (max === 0) return "M";
  const leaders = (["E", "P", "L"] as const).filter((k) => c[k] === max);
  return leaders.length > 1 ? "M" : leaders[0]!;
}

/** Голоса из ответов на psycho1–3 (неотвеченные пропускаются). */
export function getVotes(survey: Survey, state: SurveyState): PsychoVote[] {
  const gender = getGender(state);
  if (!gender) return [];
  const questions = getBaseQuestions(survey, gender);
  const votes: PsychoVote[] = [];
  for (const key of PSYCHO_KEYS) {
    const code = state.answers[key]?.optionCodes[0];
    if (!code) continue;
    const opt = questions.find((q) => q.key === key)?.options.find((o) => o.code === code);
    if (opt?.vote) votes.push(opt.vote);
  }
  return votes;
}
