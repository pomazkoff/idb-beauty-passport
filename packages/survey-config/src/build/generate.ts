/**
 * Генератор survey.v1.json из снапшота прототипа и карты кодов.
 * Тексты переносятся посимвольно; структура — по схеме (ТЗ 6.2).
 *
 * Запуск: tsx src/build/generate.ts  (из packages/survey-config)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Branch, type Option, type Question, Survey } from "../schema.js";
import {
  BASE_CODES,
  BRANCH_CODES,
  EXCLUSIVE_PATTERN,
  type QuestionCodes,
  SHARED_ALIASES,
  WIDGET_CODES,
} from "./codes.js";

type ProtoOpt = { t: string; s?: string; v?: string };
type ProtoBaseQ = {
  key: string;
  block: string;
  text: string;
  type: "single" | "multi";
  opts?: ProtoOpt[];
  byGender?: { ж: ProtoOpt[]; м: ProtoOpt[] };
};
type ProtoL2Q = { k: string; text: string; type: "single" | "multi"; opts: ProtoOpt[] };
type ProtoBranch = { name: string; draft?: boolean; qs: ProtoL2Q[] };
type Snapshot = {
  T: Record<string, ProtoBaseQ>;
  L2: Record<string, ProtoBranch>;
  TYPES: Record<"E" | "P" | "L" | "M", { name: string; desc: string }>;
  W: { n: number; name: string; seg: string; why: string }[];
  screens: Record<string, Record<string, unknown>>;
};

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");
const repoRoot = resolve(pkgRoot, "../..");
const snapshot = JSON.parse(
  readFileSync(resolve(repoRoot, "docs/source/prototype-content.snapshot.json"), "utf8"),
) as Snapshot;

const BASE_BLOCK = snapshot.T.q1!.block; // «Уровень 1 · О вас»
const PASSPORT_PREFIX = "Паспорт · ";

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function mkOption(o: ProtoOpt, code: string, extra: Partial<Option> = {}): Option {
  const opt: Option = { code, title: clean(o.t) };
  if (o.s) opt.subtitle = clean(o.s);
  Object.assign(opt, extra);
  return opt;
}

// ── База ─────────────────────────────────────────────────────────
function baseQuestion(q: ProtoBaseQ, key: string, mapOpt: (o: ProtoOpt, i: number) => Option): Question {
  const base = { key, block: BASE_BLOCK, type: q.type, skippable: q.type === "multi", text: clean(q.text) };
  if (q.byGender) {
    return { ...base, options: { female: q.byGender.ж.map(mapOpt), male: q.byGender.м.map(mapOpt) } };
  }
  return { ...base, options: q.opts!.map(mapOpt) };
}

const genderQ = baseQuestion(snapshot.T.q1!, "gender", (o, i) => mkOption(o, BASE_CODES.gender[i]!));
const psychoQ = (q: ProtoBaseQ, key: string) =>
  baseQuestion(q, key, (o) => {
    const vote = o.v as "E" | "P" | "L" | "M";
    if (!vote || !BASE_CODES.psycho.includes(vote)) throw new Error(`${key}: нет голоса у варианта «${o.t}»`);
    return mkOption(o, vote, { vote });
  });
const categoryQ = baseQuestion(snapshot.T.q5!, "category", (o) => {
  const code = o.v as (typeof BASE_CODES.category)[number];
  if (!BASE_CODES.category.includes(code)) throw new Error(`category: неизвестный код ${o.v}`);
  return mkOption(o, code, { categoryCode: code });
});

const base: Question[] = [
  genderQ,
  psychoQ(snapshot.T.q2!, "psycho1"),
  psychoQ(snapshot.T.q3!, "psycho2"),
  psychoQ(snapshot.T.q4!, "psycho3"),
  categoryQ,
];

// ── Категории: подпись по полу из вопроса 5 ──────────────────────
const catOpts = snapshot.T.q5!.byGender!;
const categories = BASE_CODES.category.map((code) => {
  const f = catOpts.ж.find((o) => o.v === code);
  const m = catOpts.м.find((o) => o.v === code);
  const label: { female?: string; male?: string } = {};
  if (f) label.female = clean(f.t);
  if (m) label.male = clean(m.t);
  return { code, label };
});

// ── Ветки ─────────────────────────────────────────────────────────
function l2Question(
  q: ProtoL2Q,
  codes: QuestionCodes,
  branchName: string,
  draft: boolean | undefined,
): Question {
  if (codes.codes.length !== q.opts.length) {
    throw new Error(
      `${codes.key}: в карте ${codes.codes.length} кодов, в прототипе ${q.opts.length} вариантов («${q.text}»)`,
    );
  }
  const options = q.opts.map((o, i) => {
    const extra: Partial<Option> = {};
    if (codes.tags?.[i]) extra.tags = codes.tags[i];
    const autoExclusive = q.type === "multi" && EXCLUSIVE_PATTERN.test(clean(o.t));
    if (autoExclusive || codes.exclusive?.includes(i)) extra.exclusive = true;
    return mkOption(o, codes.codes[i]!, extra);
  });
  const question: Question = {
    key: codes.key,
    block: PASSPORT_PREFIX + branchName,
    topic: clean(q.k),
    type: q.type,
    skippable: q.type === "multi",
    text: clean(q.text),
    options,
  };
  if (draft) question.draft = true;
  return question;
}

const branches: Branch[] = [];
for (const [protoKey, proto] of Object.entries(snapshot.L2)) {
  if (SHARED_ALIASES[protoKey]) continue; // копия — пропускаем
  const map = BRANCH_CODES[protoKey];
  if (!map) throw new Error(`Нет карты кодов для ветки ${protoKey}`);
  if (map.questions.length !== proto.qs.length) {
    throw new Error(`${protoKey}: в карте ${map.questions.length} вопросов, в прототипе ${proto.qs.length}`);
  }
  const [g, category] = protoKey.split("_") as [string, Branch["category"]];
  const isShared = Object.values(SHARED_ALIASES).includes(protoKey);
  const genders: Branch["genders"] = isShared ? ["female", "male"] : [g === "ж" ? "female" : "male"];
  const branch: Branch = {
    id: map.id,
    genders,
    category,
    name: clean(proto.name),
    questions: proto.qs.map((q, i) => l2Question(q, map.questions[i]!, clean(proto.name), proto.draft)),
  };
  if (proto.draft) branch.draft = true;
  branches.push(branch);
}

// ── Виджеты ──────────────────────────────────────────────────────
const widgets = snapshot.W.map((w) => ({
  n: w.n,
  code:
    WIDGET_CODES[w.n] ??
    (() => {
      throw new Error(`Нет кода для виджета №${w.n}`);
    })(),
  name: clean(w.name),
  segment: w.seg === "all" ? ("all" as const) : (w.seg.split("") as ("E" | "P" | "L")[]),
  why: clean(w.why),
}));

// ── Психотипы ─────────────────────────────────────────────────────
const psychotypes = Object.fromEntries(
  Object.entries(snapshot.TYPES).map(([k, v]) => [k, { name: v.name, description: v.desc }]),
) as Record<"E" | "P" | "L" | "M", { name: string; description: string }>;

// ── Экраны и UI ───────────────────────────────────────────────────
const sc = snapshot.screens as Record<string, Record<string, string | string[]>>;
const r2 = sc.result2!;
const screens = {
  intro: sc.intro,
  result1: sc.result1,
  result2: {
    eyebrow: r2.eyebrow,
    titleHtml: r2.titleHtml,
    lead: r2.lead,
    addEyebrow: r2.addEyebrow,
    addTitle: r2.addTitle,
    addTextTemplate: String(r2.addTextHtml).replace("${rest.length}", "{count}"),
  },
  meter: sc.meter,
  widgets: sc.widgets,
};
const uiSrc = sc.ui as Record<string, string>;
const ui = {
  hintSingle: uiSrc.hintSingle,
  hintMulti: uiSrc.hintMulti,
  singleHint: uiSrc.singleHint,
  draftBadge: uiSrc.draftBadge,
  backLabel: uiSrc.backLabel,
  nextLabel: uiSrc.nextLabel,
  skipLabel: uiSrc.skipLabel,
  headerTag: uiSrc.headerTag,
  brandName: "ИЛЬ ДЕ БОТЭ",
  passportBlockPrefix: PASSPORT_PREFIX,
  baseBlockLabel: BASE_BLOCK,
};

const survey = {
  version: "1.0.0",
  locale: "ru-RU" as const,
  genders: [
    { code: "female" as const, label: clean(snapshot.T.q1!.opts![0]!.t) },
    { code: "male" as const, label: clean(snapshot.T.q1!.opts![1]!.t) },
  ],
  base,
  categories,
  branches,
  psychotypes,
  widgets,
  completeness: { basePct: 40, perCategoryPct: 20, maxCategories: 3 },
  screens,
  ui,
};

const parsed = Survey.parse(survey);
const out = resolve(pkgRoot, "survey.v1.json");
writeFileSync(out, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
console.log(`✓ ${out}: веток ${parsed.branches.length}, виджетов ${parsed.widgets.length}`);
