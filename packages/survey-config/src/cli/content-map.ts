/**
 * Генерирует docs/content-map.md — карту контента для сверки с заказчиком (ТЗ 6.3.7).
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { questionOptions, questionText, survey } from "../index.js";
import type { GenderCode, Question } from "../schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../../docs/content-map.md");

const lines: string[] = [];
const L = (s = "") => lines.push(s);

L("# Карта контента опросника");
L();
L(
  `Сгенерировано из \`packages/survey-config/survey.v1.json\` (версия ${survey.version}). Не редактировать руками — \`pnpm survey:content-map\`.`,
);
L();
L("Коды — стабильные идентификаторы для хранения и передачи в ENSI. Тексты — посимвольно из прототипа.");
L();

function questionTable(q: Question, gender: GenderCode | null) {
  const opts = questionOptions(q, gender);
  L("| Код | Текст варианта | Подзаголовок | Доп. |");
  L("|---|---|---|---|");
  for (const o of opts) {
    const extra = [
      o.vote ? `голос **${o.vote}**` : "",
      o.categoryCode ? `категория \`${o.categoryCode}\`` : "",
      o.exclusive ? "exclusive" : "",
      o.tags?.length ? `теги: ${o.tags.join(", ")}` : "",
      o.deprecated ? "deprecated" : "",
    ]
      .filter(Boolean)
      .join("; ");
    L(`| \`${o.code}\` | ${o.title} | ${o.subtitle ?? ""} | ${extra} |`);
  }
  L();
}

L("## Этап 1 · База");
L();
for (const q of survey.base) {
  L(`### \`${q.key}\` · ${q.type}`);
  L();
  if (typeof q.text === "string" && Array.isArray(q.options)) {
    L(`**${q.text}**`);
    L();
    questionTable(q, null);
  } else {
    for (const g of ["female", "male"] as GenderCode[]) {
      L(`**${g === "female" ? "Женщинам" : "Мужчинам"}:** ${questionText(q, g)}`);
      L();
      questionTable(q, g);
    }
  }
}

L("## Этап 2 · Паспорт");
L();
L("| Ветка | Пол | Категория | Название | Вопросов | Draft |");
L("|---|---|---|---|---|---|");
for (const b of survey.branches) {
  L(
    `| \`${b.id}\` | ${b.genders.join(", ")} | \`${b.category}\` | ${b.name} | ${b.questions.length} | ${b.draft ? "да" : ""} |`,
  );
}
L();
for (const b of survey.branches) {
  L(
    `### \`${b.id}\` · ${b.name} (${b.genders.join(", ")})${b.draft ? " · *вопросы дописаны, могут меняться*" : ""}`,
  );
  L();
  b.questions.forEach((q, i) => {
    L(`#### ${i + 1}. \`${q.key}\` · ${q.topic} · ${q.type}${q.skippable ? " · можно пропустить" : ""}`);
    L();
    L(`**${questionText(q, b.genders[0]!)}**`);
    L();
    questionTable(q, b.genders[0]!);
  });
}

L("## Психотипы");
L();
L("| Код | Название | Описание |");
L("|---|---|---|");
for (const [k, v] of Object.entries(survey.psychotypes)) L(`| \`${k}\` | ${v.name} | ${v.description} |`);
L();

L("## Виджеты ЛК");
L();
L("| № | Код | Виджет | Сегмент | Зачем |");
L("|---|---|---|---|---|");
for (const w of survey.widgets) {
  const seg = w.segment === "all" ? "все" : w.segment.join(", ");
  L(`| ${w.n} | \`${w.code}\` | ${w.name} | ${seg} | ${w.why} |`);
}
L();
L("Приоритетных виджетов: E — 7, P — 5, L — 5, M — все 11 неуниверсальных; базовых (все) — 6.");

writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
console.log(`✓ ${out}`);
