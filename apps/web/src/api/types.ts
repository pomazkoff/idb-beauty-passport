/** Формы ответов API (/api/v1). Отражают routes/survey.ts и SessionService на сервере. */
import type { AnswerRecord, BeautyProfile, Derived } from "@idb/core";

export type Gender = "female" | "male";
export type Category = "face" | "body" | "hair" | "sun" | "makeup" | "perfume" | "home";

export type ApiOption = {
  code: string;
  title: string;
  subtitle?: string;
  exclusive?: boolean;
  categoryCode?: Category;
  vote?: "E" | "P" | "L" | "M";
};

export type ApiQuestion = {
  key: string;
  stage: "base" | "passport";
  category?: Category;
  block: string;
  topic?: string;
  type: "single" | "multi";
  skippable: boolean;
  draft: boolean;
  text: string;
  options: ApiOption[];
};

export type ApiBranch = {
  id: string;
  category: Category;
  name: string;
  draft: boolean;
  questions: Omit<ApiQuestion, "stage" | "category">[];
};

export type ApiWidget = { n: number; code: string; name: string; segment: "all" | string[]; why: string };

export type SurveyConfig = {
  version: string;
  gender: Gender | null;
  genders: { code: Gender; label: string }[];
  categories: { code: Category; label: { female?: string; male?: string } }[];
  base: ApiQuestion[];
  branches: ApiBranch[];
  psychotypes: Record<"E" | "P" | "L" | "M", { name: string; description: string }>;
  widgets: ApiWidget[];
  completeness: { basePct: number; perCategoryPct: number; maxCategories: number };
  screens: {
    intro: {
      eyebrow: string;
      titleHtml: string;
      lead: string;
      cardLabel: string;
      cardText: string;
      startLabel: string;
    };
    result1: {
      eyebrow: string;
      titleHtml: string;
      lead: string;
      typeLabel: string;
      announceEyebrow: string;
      announceTitle: string;
      announceText: string;
      announceBullets: string[];
      announceFoot: string;
      passportButtonPrefix: string;
      laterLabel: string;
      postponedTitle: string;
      postponedText: string;
      postponedButton: string;
      howTypeHtml: string;
      againLabel: string;
    };
    result2: {
      eyebrow: string;
      titleHtml: string;
      lead: string;
      addEyebrow: string;
      addTitle: string;
      addTextTemplate: string;
    };
    meter: { label: string; nextAt40: string; nextPartial: string; full: string };
    widgets: { prioritySection: string; baseSection: string };
  };
  ui: {
    hintSingle: string;
    hintMulti: string;
    singleHint: string;
    draftBadge: string;
    backLabel: string;
    nextLabel: string;
    skipLabel: string;
    headerTag: string;
    brandName: string;
    passportBlockPrefix: string;
    baseBlockLabel: string;
  };
  flags: { showDraftBadge: boolean; countSkippedCategory: boolean };
};

export type SessionStage = "intro" | "base" | "result1" | "passport" | "result2";

export type SessionView = {
  sessionId: string;
  surveyVersion: string;
  stage: SessionStage;
  activeCategory: Category | null;
  answers: Record<string, AnswerRecord>;
  derived: Derived;
};

export type ProfileView = {
  profile: BeautyProfile | null;
  ensi: {
    status: string;
    revision: number | null;
    lastAttemptAt: string | null;
    attempts: number;
    lastError: string | null;
  };
};

export type ApiError = { code: string; message: string; meta?: Record<string, unknown> };
export type Envelope<T> = { data: T; meta?: Record<string, unknown>; errors?: ApiError[] };
