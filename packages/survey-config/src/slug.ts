/** Транслитерация и slug для автогенерации кодов вариантов/ключей вопросов в конструкторе. */
const MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function translit(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => MAP[ch] ?? ch)
    .join("");
}

/** «Жирный блеск не появляется, кожа матовая» → "zhirnyy_blesk_ne_poyavlyaetsya_kozha_matovaya" (обрезано до maxWords слов). */
export function slugify(s: string, maxWords = 4): string {
  const words = translit(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  let out = words.join("_");
  if (!out) out = "option";
  if (!/^[a-z]/.test(out)) out = `o_${out}`;
  return out;
}

/** Уникальный slug в рамках набора занятых. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now()}`;
}
