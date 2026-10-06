/**
 * Извлекает данные опросника из прототипа docs/source/IDB_Passport.html
 * (объекты T, L2, TYPES, W) и сохраняет снапшот в
 * docs/source/prototype-content.snapshot.json.
 *
 * Снапшот — промежуточный артефакт: из него генератором
 * packages/survey-config/src/build/generate.ts собирается survey.v1.json
 * с присвоенными стабильными кодами. Тексты при этом переносятся
 * посимвольно (ТЗ 6.3.1).
 *
 * Запуск: pnpm survey:extract
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const htmlPath = resolve(root, "docs/source/IDB_Passport.html");
const outPath = resolve(root, "docs/source/prototype-content.snapshot.json");

const html = readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("В прототипе не найден <script>");
const script = scriptMatch[1]!;

// Берём только блок объявления данных — до начала движка.
const engineMarker = script.indexOf("//  ДВИЖОК");
if (engineMarker < 0) throw new Error("Не найден маркер начала движка (//  ДВИЖОК)");
const dataPart = script.slice(0, engineMarker);

const sandbox: Record<string, unknown> = {};
vm.createContext(sandbox);
vm.runInContext(`${dataPart}\n__out = { T, L2, TYPES, W };`, sandbox, { filename: "prototype-data.js" });

const data = sandbox.__out as {
  T: Record<string, unknown>;
  L2: Record<string, unknown>;
  TYPES: Record<string, unknown>;
  W: unknown[];
};

// Тексты экранов из шаблонов функций рендера — вытаскиваем регулярками по якорям.
function pick(re: RegExp, label: string, source: string = script): string {
  const m = source.match(re);
  if (!m) throw new Error(`Не найден текст экрана: ${label}`);
  return m[1]!.replace(/\s+/g, " ").trim();
}

const screens = {
  intro: {
    eyebrow: pick(/renderIntro[\s\S]*?class="eyebrow">([^<]+)</, "intro.eyebrow"),
    titleHtml: pick(/renderIntro[\s\S]*?<h1>([\s\S]*?)<\/h1>/, "intro.title"),
    lead: pick(/renderIntro[\s\S]*?class="lead">([\s\S]*?)<\/p>/, "intro.lead"),
    cardLabel: pick(/renderIntro[\s\S]*?class="rlabel">([^<]+)</, "intro.cardLabel"),
    cardText: pick(
      /renderIntro[\s\S]*?class="rlabel">[^<]+<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/,
      "intro.cardText",
    ),
    startLabel: pick(/id="go">([^<]+)</, "intro.start"),
  },
  result1: {
    eyebrow: pick(/renderResult1[\s\S]*?class="eyebrow">([^<]+)</, "result1.eyebrow"),
    titleHtml: pick(/renderResult1[\s\S]*?<h1>([\s\S]*?)<\/h1>/, "result1.title"),
    lead: pick(/renderResult1[\s\S]*?class="lead">([\s\S]*?)<\/p>/, "result1.lead"),
    typeLabel: pick(/renderResult1[\s\S]*?class="rlabel">([^<]+)</, "result1.typeLabel"),
    announceEyebrow: pick(/renderResult1[\s\S]*?class="ann-eyebrow">([^<]+)</, "result1.annEyebrow"),
    announceTitle: pick(/renderResult1[\s\S]*?class="ann-title">([^<]+)</, "result1.annTitle"),
    announceText: pick(/renderResult1[\s\S]*?class="ann-text">([\s\S]*?)<\/div>/, "result1.annText"),
    announceBullets: [...script.matchAll(/<span class="ann-dot"><\/span>([^<]+)</g)].map((m) => m[1]!.trim()),
    announceFoot: pick(/renderResult1[\s\S]*?class="ann-foot">([^<]+)</, "result1.annFoot"),
    passportButtonPrefix: pick(/id="pass">([^<$]+)\$\{/, "result1.passBtn").trim(),
    laterLabel: pick(/id="later">([^<]+)</, "result1.later"),
    postponedTitle: pick(
      /getElementById\('later'\)\.onclick[\s\S]*?class="ann-title"[^>]*>([^<]+)</,
      "result1.postponedTitle",
    ),
    postponedText: pick(
      /getElementById\('later'\)\.onclick[\s\S]*?class="ann-text"[^>]*>([\s\S]*?)<\/div>/,
      "result1.postponedText",
    ),
    postponedButton: pick(/id="pass2">([^<]+)</, "result1.pass2"),
    howTypeHtml: pick(/<div class="note">\s*([\s\S]*?)\s*<\/div>/, "result1.note"),
    againLabel: pick(/id="again">([^<]+)</, "result1.again"),
  },
  result2: {
    eyebrow: pick(/renderResult2[\s\S]*?class="eyebrow">([^<]+)</, "result2.eyebrow"),
    titleHtml: pick(/renderResult2[\s\S]*?<h1>([\s\S]*?)<\/h1>/, "result2.title"),
    lead: pick(/renderResult2[\s\S]*?class="lead">([\s\S]*?)<\/p>/, "result2.lead"),
    addEyebrow: pick(/renderResult2[\s\S]*?class="ann-eyebrow">([^<]+)</, "result2.addEyebrow"),
    addTitle: pick(/renderResult2[\s\S]*?class="ann-title">([^<]+)</, "result2.addTitle"),
    addTextHtml: pick(/renderResult2[\s\S]*?class="ann-text">([\s\S]*?)<\/div>/, "result2.addText"),
  },
  meter: {
    label: pick(/class="meter-label">([^<]+)</, "meter.label"),
    nextAt40: pick(/\? '([^']+)'\s*:\s*'Добавьте/, "meter.next40"),
    nextPartial: pick(/: '(Добавьте[^']+)'/, "meter.nextPartial"),
    full: pick(/class="meter-next">(Профиль полный[^<]+)</, "meter.full"),
  },
  widgets: {
    prioritySection: pick(/class="sect">(Ваши виджеты[^<]+)</, "widgets.priority"),
    baseSection: pick(/class="sect">(Базовые виджеты[^<]+)</, "widgets.base"),
  },
  ui: {
    hintMulti: pick(/isMulti\?'([^']+)':'/, "ui.hintMulti"),
    hintSingle: pick(/isMulti\?'[^']+':'([^']+)'/, "ui.hintSingle"),
    draftBadge: pick(/class="draft">([^<]+)</, "ui.draft"),
    backLabel: pick(/id="back">([^<]+)</, "ui.back"),
    nextLabel: pick(/id="next"[^>]*>([^<]+)</, "ui.next"),
    skipLabel: pick(/id="skip">([^<]+)</, "ui.skip"),
    singleHint: pick(/var\(--ink-3\)">([^<]+)<\/span>/, "ui.singleHint"),
    headerTag: pick(/class="hdr-tag">([^<]+)</, "ui.headerTag", html),
    passportBlockPrefix: "Паспорт · ",
  },
};

const snapshot = {
  source: "docs/source/IDB_Passport.html",
  extractedAt: new Date().toISOString(),
  T: data.T,
  L2: data.L2,
  TYPES: data.TYPES,
  W: data.W,
  screens,
};

writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const l2Keys = Object.keys(data.L2);
console.log(`✓ снапшот записан: ${outPath}`);
console.log(
  `  базовых вопросов: ${Object.keys(data.T).length}, веток L2: ${l2Keys.length}, виджетов: ${data.W.length}`,
);
for (const k of l2Keys) {
  const b = data.L2[k] as { qs: unknown[] };
  console.log(`  ${k.padEnd(10)} ${b.qs.length} вопросов`);
}
