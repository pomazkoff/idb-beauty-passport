/**
 * Проверка «замороженных» кодов (ТЗ 6.1): после публикации ключи вопросов и коды вариантов
 * менять/удалять нельзя — на них завязаны сохранённые ответы и данные в ENSI.
 * Разрешено: добавлять вопросы и варианты, помечать варианты deprecated, менять тексты.
 */
import type { GenderCode, Question, Survey } from "./schema.js";
import type { ValidationIssue } from "./validate.js";

type Flat = Map<string, { type: string; options: Set<string> }>;

function flatten(s: Survey, gender: GenderCode): Flat {
  const out: Flat = new Map();
  const add = (q: Question) => {
    const opts = Array.isArray(q.options) ? q.options : q.options[gender];
    out.set(q.key, { type: q.type, options: new Set(opts.map((o) => o.code)) });
  };
  for (const q of s.base) add(q);
  for (const b of s.branches) if (b.genders.includes(gender)) for (const q of b.questions) add(q);
  return out;
}

export function checkFrozenCodes(published: Survey, draft: Survey): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const g of ["female", "male"] as GenderCode[]) {
    const was = flatten(published, g);
    const now = flatten(draft, g);
    for (const [key, prev] of was) {
      const cur = now.get(key);
      if (!cur) {
        issues.push({
          path: `${g}.${key}`,
          message: "вопрос был опубликован — удалять или переименовывать ключ нельзя",
        });
        continue;
      }
      if (cur.type !== prev.type)
        issues.push({
          path: `${g}.${key}.type`,
          message: `тип опубликованного вопроса менять нельзя (${prev.type} → ${cur.type})`,
        });
      for (const code of prev.options) {
        if (!cur.options.has(code))
          issues.push({
            path: `${g}.${key}.${code}`,
            message: "вариант был опубликован — удалять нельзя, пометьте deprecated",
          });
      }
    }
  }
  const wasWidgets = new Set(published.widgets.map((w) => w.code));
  const nowWidgets = new Set(draft.widgets.map((w) => w.code));
  for (const c of wasWidgets)
    if (!nowWidgets.has(c))
      issues.push({ path: `widgets.${c}`, message: "код виджета был опубликован — удалять нельзя" });
  return issues;
}
