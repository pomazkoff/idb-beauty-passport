import type { Survey, Widget } from "@idb/survey-config";
import { computePsychotype, countVotes, getVotes } from "./psychotype.js";
import { getAllQuestions, getGender, getPrimaryCategory, isBaseAnswered } from "./questions.js";
import type {
  BeautyProfile,
  Derived,
  ProfileAnswer,
  PsychotypeCode,
  SurveyState,
  WidgetSelection,
} from "./types.js";

/** Заполненность профиля (ТЗ 7.3): 0 до завершения базы, затем 40 + 20 × min(категорий, 3). */
export function computeCompleteness(survey: Survey, state: SurveyState): number {
  if (!state.baseCompleted) return 0;
  const { basePct, perCategoryPct, maxCategories } = survey.completeness;
  return Math.min(100, basePct + perCategoryPct * Math.min(state.completedCategories.length, maxCategories));
}

/** Подбор виджетов (ТЗ 7.5): для M — все неуниверсальные. Порядок — по n. */
export function selectWidgets(survey: Survey, psychotype: PsychotypeCode): WidgetSelection {
  const sorted = [...survey.widgets].sort((a, b) => a.n - b.n);
  const isPriority = (w: Widget) =>
    w.segment !== "all" && (psychotype === "M" || (w.segment as string[]).includes(psychotype));
  return {
    priority: sorted.filter(isPriority),
    base: sorted.filter((w) => w.segment === "all"),
  };
}

/** Все производные от состояния — для ответа API и клиента. */
export function derive(survey: Survey, state: SurveyState): Derived {
  const votes = getVotes(survey, state);
  const psychotype = computePsychotype(votes);
  const widgets = selectWidgets(survey, psychotype);
  return {
    gender: getGender(state),
    baseComplete: state.baseCompleted && isBaseAnswered(survey, state),
    psychotype,
    votes: countVotes(votes),
    primaryCategory: getPrimaryCategory(survey, state),
    completedCategories: [...state.completedCategories],
    completenessPct: computeCompleteness(survey, state),
    widgets: { priority: widgets.priority.map((w) => w.code), base: widgets.base.map((w) => w.code) },
  };
}

export type ProfileMeta = { customerId: string; revision: number; updatedAt: string };

/**
 * Сборка профиля для ENSI (ТЗ 7.6, 10.2). Включаются ответы базы и ответы
 * только по завершённым категориям — незавершённая ветка в профиль не попадает.
 */
export function buildProfile(survey: Survey, state: SurveyState, meta: ProfileMeta): BeautyProfile {
  const gender = getGender(state);
  if (!gender) throw new Error("buildProfile: пол не определён — база не завершена");
  const d = derive(survey, state);

  const answers: ProfileAnswer[] = [];
  const traits: Record<string, string[]> = {};
  const tags = new Set<string>();

  for (const q of getAllQuestions(survey, gender)) {
    const a = state.answers[q.key];
    if (!a) continue;
    if (q.stage === "passport" && (!q.category || !state.completedCategories.includes(q.category))) continue;

    const row: ProfileAnswer = {
      stage: q.stage,
      question_key: q.key,
      option_codes: [...a.optionCodes],
      skipped: a.skipped,
    };
    if (q.category) row.category = q.category;
    if (a.answeredAt) row.answered_at = a.answeredAt;
    answers.push(row);

    if (q.stage === "passport" && q.category && !a.skipped) {
      const topic = q.key.startsWith(`${q.category}_`) ? q.key.slice(q.category.length + 1) : q.key;
      traits[`${q.category}.${topic}`] = [...a.optionCodes];
      for (const code of a.optionCodes)
        for (const t of q.options.find((o) => o.code === code)?.tags ?? []) tags.add(t);
    }
  }

  return {
    schema_version: "1.0",
    customer_id: meta.customerId,
    profile_revision: meta.revision,
    survey_version: survey.version,
    updated_at: meta.updatedAt,
    gender,
    psychotype: { code: d.psychotype, name: survey.psychotypes[d.psychotype].name, votes: d.votes },
    primary_category: d.primaryCategory,
    completed_categories: d.completedCategories,
    completeness_pct: d.completenessPct,
    widgets: d.widgets,
    answers,
    traits,
    tags: [...tags].sort(),
  };
}
