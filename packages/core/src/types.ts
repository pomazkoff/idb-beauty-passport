import type {
  CategoryCode,
  GenderCode,
  Option,
  PsychoVote,
  PsychotypeCode,
  Widget,
} from "@idb/survey-config";

export type { CategoryCode, GenderCode, PsychoVote, PsychotypeCode };

export type Stage = "base" | "passport";

/** Один ответ. optionCodes пуст только при skipped=true. */
export type AnswerRecord = {
  optionCodes: string[];
  skipped: boolean;
  answeredAt?: string;
  timeMs?: number;
};

/**
 * Состояние прохождения — то, что хранится в сессии на сервере.
 * Все функции движка принимают его и возвращают новое (иммутабельно).
 */
export type SurveyState = {
  answers: Record<string, AnswerRecord>;
  /** Категории, по которым пройдена ветка Паспорта (в порядке прохождения). */
  completedCategories: CategoryCode[];
  /** Выставляется сервером при base:complete. */
  baseCompleted: boolean;
};

export const emptyState = (): SurveyState => ({ answers: {}, completedCategories: [], baseCompleted: false });

/** Вопрос с текстом и вариантами, уже выбранными под пол пользователя. */
export type ResolvedQuestion = {
  key: string;
  stage: Stage;
  category?: CategoryCode;
  block: string;
  topic?: string;
  type: "single" | "multi";
  skippable: boolean;
  draft: boolean;
  text: string;
  options: Option[];
};

export type Votes = Record<PsychoVote, number>;

export type WidgetSelection = { priority: Widget[]; base: Widget[] };

/** Производные от состояния — отдаются клиенту вместе с сессией. */
export type Derived = {
  gender: GenderCode | null;
  baseComplete: boolean;
  psychotype: PsychotypeCode;
  votes: Votes;
  primaryCategory: CategoryCode | null;
  completedCategories: CategoryCode[];
  completenessPct: number;
  widgets: { priority: string[]; base: string[] };
};

export type AnswerValidationError =
  | { code: "QUESTION_NOT_FOUND"; message: string }
  | { code: "OPTION_NOT_ALLOWED"; message: string; option?: string }
  | { code: "VALIDATION_ERROR"; message: string };

/** Контракт профиля для ENSI (ТЗ 10.2). Стабилен; маппинг на поля ENSI — отдельный слой. */
export type BeautyProfile = {
  schema_version: "1.0";
  customer_id: string;
  profile_revision: number;
  survey_version: string;
  updated_at: string;
  gender: GenderCode;
  psychotype: { code: PsychotypeCode; name: string; votes: Votes };
  primary_category: CategoryCode | null;
  completed_categories: CategoryCode[];
  completeness_pct: number;
  widgets: { priority: string[]; base: string[] };
  answers: ProfileAnswer[];
  traits: Record<string, string[]>;
  tags: string[];
};

export type ProfileAnswer = {
  stage: Stage;
  category?: CategoryCode;
  question_key: string;
  option_codes: string[];
  skipped: boolean;
  answered_at?: string;
};
