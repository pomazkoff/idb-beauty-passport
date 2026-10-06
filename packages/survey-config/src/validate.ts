/**
 * Семантическая валидация конфига поверх Zod-схемы (ТЗ 13.1):
 * уникальность ключей и кодов, инварианты базы, доступность веток,
 * голоса у psycho-вопросов, отсутствие M в psycho3, makeup только у женщин.
 *
 * Контрольные числа (ТЗ 6.4) проверяются отдельно в тестах —
 * они привязаны к версии 1.0.0 контента, а валидатор — к структуре.
 */
import { BASE_KEYS, type GenderCode, type Survey } from "./schema.js";

export type ValidationIssue = { path: string; message: string };

export function validateSurvey(s: Survey): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  // Ключи базовых вопросов фиксированы и в этом порядке.
  s.base.forEach((q, i) => {
    if (q.key !== BASE_KEYS[i]) push(`base[${i}].key`, `ожидался ключ ${BASE_KEYS[i]}, получен ${q.key}`);
    if (q.type !== "single") push(`base[${i}].type`, "базовые вопросы — только single");
    if (q.skippable) push(`base[${i}].skippable`, "базовые вопросы нельзя пропускать");
  });

  // Голоса психотипа.
  for (const key of ["psycho1", "psycho2", "psycho3"]) {
    const q = s.base.find((b) => b.key === key);
    if (!q) continue;
    for (const g of ["female", "male"] as GenderCode[]) {
      const opts = Array.isArray(q.options) ? q.options : q.options[g];
      opts.forEach((o, i) => {
        if (!o.vote) push(`${key}.${g}[${i}]`, "у варианта psycho-вопроса нет голоса (vote)");
        if (o.code !== o.vote)
          push(`${key}.${g}[${i}]`, "код варианта psycho-вопроса должен равняться голосу");
      });
      if (key === "psycho3" && opts.some((o) => o.vote === "M")) {
        push(`${key}.${g}`, "psycho3 не содержит варианта «не подходит» (M)");
      }
    }
  }

  // Категория: коды и доступность по полу.
  const catQ = s.base.find((b) => b.key === "category");
  if (catQ && !Array.isArray(catQ.options)) {
    for (const g of ["female", "male"] as GenderCode[]) {
      for (const o of catQ.options[g]) {
        if (!o.categoryCode) push(`category.${g}.${o.code}`, "нет categoryCode");
        const cat = s.categories.find((c) => c.code === o.categoryCode);
        if (!cat?.label[g])
          push(`category.${g}.${o.code}`, "категория не размечена как доступная этому полу");
        if (!s.branches.some((b) => b.category === o.categoryCode && b.genders.includes(g))) {
          push(`category.${g}.${o.code}`, "для категории нет ветки этого пола");
        }
      }
    }
    if (catQ.options.male.some((o) => o.categoryCode === "makeup"))
      push("category.male", "у мужчин нет makeup");
  }

  // Ветки: уникальность id, одна ветка на пол×категорию.
  const branchIds = new Set<string>();
  for (const b of s.branches) {
    if (branchIds.has(b.id)) push(`branches.${b.id}`, "дублирующийся id ветки");
    branchIds.add(b.id);
    for (const g of b.genders) {
      const same = s.branches.filter((x) => x.category === b.category && x.genders.includes(g));
      if (same.length > 1) push(`branches.${b.id}`, `несколько веток для ${g} × ${b.category}`);
    }
    if (!b.questions.every((q) => q.block.endsWith(b.name)))
      push(`branches.${b.id}`, "block вопроса ≠ имени ветки");
  }

  // Уникальность ключей вопросов в пределах «пола» и кодов вариантов в пределах вопроса.
  for (const g of ["female", "male"] as GenderCode[]) {
    const seen = new Set<string>();
    const qs = [...s.base, ...s.branches.filter((b) => b.genders.includes(g)).flatMap((b) => b.questions)];
    for (const q of qs) {
      if (seen.has(q.key)) push(`questions.${g}.${q.key}`, "дублирующийся ключ вопроса в рамках пола");
      seen.add(q.key);
      const opts = Array.isArray(q.options) ? q.options : q.options[g];
      const codes = new Set<string>();
      for (const o of opts) {
        if (codes.has(o.code)) push(`${q.key}.${o.code}`, "дублирующийся код варианта");
        codes.add(o.code);
        if (o.exclusive && q.type === "single")
          push(`${q.key}.${o.code}`, "exclusive имеет смысл только для multi");
      }
      if (q.type === "multi" && !q.skippable)
        push(`${q.key}`, "multi-вопрос должен быть skippable (поведение прототипа)");
      if (q.type === "single" && q.skippable)
        push(`${q.key}`, "single-вопрос не пропускается (поведение прототипа)");
    }
  }

  // Виджеты.
  const nums = new Set<number>();
  const wcodes = new Set<string>();
  for (const w of s.widgets) {
    if (nums.has(w.n)) push(`widgets.${w.n}`, "дублирующийся номер виджета");
    if (wcodes.has(w.code)) push(`widgets.${w.code}`, "дублирующийся код виджета");
    nums.add(w.n);
    wcodes.add(w.code);
  }

  // Заполненность.
  const c = s.completeness;
  if (c.basePct + c.perCategoryPct * c.maxCategories !== 100) {
    push("completeness", "basePct + perCategoryPct × maxCategories должно давать 100");
  }

  return issues;
}
