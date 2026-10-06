/**
 * Маппинг BeautyProfile → тело запроса в ENSI (ТЗ 10.2, 10.4).
 *
 * Точный контракт целевого эндпоинта ENSI ещё не получен (docs/ENSI.md), поэтому
 * маппинг даёт структуру, совместимую с конвенциями ENSI (snake_case, плоские
 * атрибуты для сегментации) и целиком вкладывает исходный профиль. Когда контракт
 * появится — правится ТОЛЬКО этот файл и его тесты.
 */
import type { BeautyProfile } from "@idb/core";

export type EnsiProfilePayload = {
  customer_id: string;
  /** Плоские атрибуты клиента — кандидат на кастомные поля/атрибуты в ENSI. */
  attributes: Record<string, string | number | boolean | string[]>;
  /** Полный профиль по контракту BeautyProfile — для хранения как JSON-поле. */
  beauty_profile: BeautyProfile;
};

export function toEnsiPayload(p: BeautyProfile): EnsiProfilePayload {
  const attributes: EnsiProfilePayload["attributes"] = {
    beauty_gender: p.gender,
    beauty_psychotype: p.psychotype.code,
    beauty_psychotype_name: p.psychotype.name,
    beauty_primary_category: p.primary_category ?? "",
    beauty_completed_categories: p.completed_categories,
    beauty_completeness_pct: p.completeness_pct,
    beauty_widgets_priority: p.widgets.priority,
    beauty_widgets_base: p.widgets.base,
    beauty_profile_revision: p.profile_revision,
    beauty_survey_version: p.survey_version,
    beauty_updated_at: p.updated_at,
    beauty_tags: p.tags,
  };
  for (const [k, v] of Object.entries(p.traits)) attributes[`beauty_trait_${k.replace(".", "_")}`] = v;
  return { customer_id: p.customer_id, attributes, beauty_profile: p };
}

/** Подстановка {customer_id} и {revision} в шаблон пути из конфига. */
export function resolvePath(template: string, p: BeautyProfile): string {
  return template
    .replace("{customer_id}", encodeURIComponent(p.customer_id))
    .replace("{revision}", String(p.profile_revision));
}
