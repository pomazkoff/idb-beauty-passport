/**
 * Генерирует docs/content-map.md — карту контента для сверки с заказчиком (ТЗ 6.3.7).
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderContentMap, survey } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../../docs/content-map.md");
writeFileSync(out, renderContentMap(survey), "utf8");
console.log(`✓ ${out}`);
