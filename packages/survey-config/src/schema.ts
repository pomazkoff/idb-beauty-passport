import { z } from "zod";

/** Код пола. В прототипе 'ж' / 'м'. */
export const GenderCode = z.enum(["female", "male"]);
export type GenderCode = z.infer<typeof GenderCode>;

/** Голос за психотип (ТЗ 7.2). */
export const PsychoVote = z.enum(["E", "P", "L", "M"]);
export type PsychoVote = z.infer<typeof PsychoVote>;

/** Код психотипа — совпадает с множеством голосов. */
export const PsychotypeCode = PsychoVote;
export type PsychotypeCode = PsychoVote;

/** Коды категорий — как в прототипе (вопрос category). */
export const CategoryCode = z.enum(["face", "body", "hair", "sun", "makeup", "perfume", "home"]);
export type CategoryCode = z.infer<typeof CategoryCode>;

const slug = z.string().regex(/^[a-z][a-z0-9_]*$/, "код: snake_case латиницей");
/** Код варианта: snake_case; для голосов психотипа допускается одна заглавная буква (E/P/L/M). */
const optionCode = z.string().regex(/^([EPLM]|[a-z][a-z0-9_]*)$/, "код варианта: snake_case или E/P/L/M");

export const Option = z.object({
  code: optionCode,
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  vote: PsychoVote.optional(),
  categoryCode: CategoryCode.optional(),
  tags: z.array(z.string()).optional(),
  exclusive: z.boolean().optional(),
  deprecated: z.boolean().optional(),
});
export type Option = z.infer<typeof Option>;

const ByGender = <T extends z.ZodTypeAny>(inner: T) => z.object({ female: inner, male: inner }).strict();

export const Question = z.object({
  key: slug,
  block: z.string().min(1),
  topic: z.string().min(1).optional(),
  type: z.enum(["single", "multi"]),
  skippable: z.boolean(),
  draft: z.boolean().optional(),
  text: z.union([z.string().min(1), ByGender(z.string().min(1))]),
  options: z.union([z.array(Option).min(1), ByGender(z.array(Option).min(1))]),
});
export type Question = z.infer<typeof Question>;

export const Category = z.object({
  code: CategoryCode,
  /** Подпись по полу; отсутствие ключа = категория недоступна этому полу. */
  label: z.object({ female: z.string().min(1).optional(), male: z.string().min(1).optional() }),
});
export type Category = z.infer<typeof Category>;

export const Branch = z.object({
  id: slug,
  genders: z.array(GenderCode).min(1),
  category: CategoryCode,
  name: z.string().min(1),
  draft: z.boolean().optional(),
  questions: z.array(Question).min(1),
});
export type Branch = z.infer<typeof Branch>;

export const Widget = z.object({
  n: z.number().int().positive(),
  code: slug,
  name: z.string().min(1),
  segment: z.union([z.literal("all"), z.array(z.enum(["E", "P", "L"])).min(1)]),
  why: z.string().min(1),
});
export type Widget = z.infer<typeof Widget>;

export const Psychotype = z.object({ name: z.string().min(1), description: z.string().min(1) });

export const Screens = z.object({
  intro: z.object({
    eyebrow: z.string(),
    titleHtml: z.string(),
    lead: z.string(),
    cardLabel: z.string(),
    cardText: z.string(),
    startLabel: z.string(),
  }),
  result1: z.object({
    eyebrow: z.string(),
    titleHtml: z.string(),
    lead: z.string(),
    typeLabel: z.string(),
    announceEyebrow: z.string(),
    announceTitle: z.string(),
    announceText: z.string(),
    announceBullets: z.array(z.string()),
    announceFoot: z.string(),
    passportButtonPrefix: z.string(),
    laterLabel: z.string(),
    postponedTitle: z.string(),
    postponedText: z.string(),
    postponedButton: z.string(),
    howTypeHtml: z.string(),
    againLabel: z.string(),
  }),
  result2: z.object({
    eyebrow: z.string(),
    titleHtml: z.string(),
    lead: z.string(),
    addEyebrow: z.string(),
    addTitle: z.string(),
    /** Шаблон; {count} подставляется числом оставшихся категорий. */
    addTextTemplate: z.string(),
  }),
  meter: z.object({ label: z.string(), nextAt40: z.string(), nextPartial: z.string(), full: z.string() }),
  widgets: z.object({ prioritySection: z.string(), baseSection: z.string() }),
});

export const Ui = z.object({
  hintSingle: z.string(),
  hintMulti: z.string(),
  singleHint: z.string(),
  draftBadge: z.string(),
  backLabel: z.string(),
  nextLabel: z.string(),
  skipLabel: z.string(),
  headerTag: z.string(),
  brandName: z.string(),
  passportBlockPrefix: z.string(),
  baseBlockLabel: z.string(),
});

export const Survey = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  locale: z.literal("ru-RU"),
  genders: z.array(z.object({ code: GenderCode, label: z.string().min(1) })).length(2),
  base: z.array(Question).length(5),
  categories: z.array(Category).length(7),
  branches: z.array(Branch),
  psychotypes: z.object({ E: Psychotype, P: Psychotype, L: Psychotype, M: Psychotype }),
  widgets: z.array(Widget),
  completeness: z.object({
    basePct: z.number().int(),
    perCategoryPct: z.number().int(),
    maxCategories: z.number().int(),
  }),
  screens: Screens,
  ui: Ui,
});
export type Survey = z.infer<typeof Survey>;

/** Ключи базовых вопросов — фиксированы, на них завязан движок. */
export const BASE_KEYS = ["gender", "psycho1", "psycho2", "psycho3", "category"] as const;
export type BaseKey = (typeof BASE_KEYS)[number];
