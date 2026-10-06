import { type Page, expect } from "@playwright/test";

export const API = process.env.E2E_API_URL ?? "http://localhost:3000";

export function newCustomer(prefix = "e2e") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Открыть опросник с dataLayer-заглушкой и без внешних шрифтов (стабильность). */
export async function open(page: Page, customer: string) {
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.addInitScript(() => {
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [];
  });
  await page.goto(`/?customer=${customer}`);
}

export const pick = (page: Page, code: string) => page.locator(`.opt[data-code="${code}"]`).click();
export const step = (page: Page) => page.locator("#stepNum");

export async function passBase(
  page: Page,
  gender: "female" | "male",
  votes: [string, string, string],
  category: string,
) {
  await page.click("#go");
  await pick(page, gender);
  await expect(step(page)).toHaveText("2 / 5");
  await pick(page, votes[0]);
  await expect(step(page)).toHaveText("3 / 5");
  await pick(page, votes[1]);
  await expect(step(page)).toHaveText("4 / 5");
  await pick(page, votes[2]);
  await expect(step(page)).toHaveText("5 / 5");
  await pick(page, category);
  await expect(page.locator("[data-testid=psychotype]")).toBeVisible();
}

/** Пройти текущую ветку: single — первый вариант, multi — первые два неисключающих (или пропуск). */
export async function passBranch(page: Page, opts: { skipMulti?: boolean } = {}) {
  const phase = () => page.locator(".idbq").getAttribute("data-phase");
  for (let guard = 0; guard < 20; guard++) {
    await expect(page.locator("#stepNum")).toBeVisible();
    const before = await page.locator("#stepNum").textContent();
    const opts_ = page.locator(".opts .opt");
    const isMulti = await page.locator(".opts.multi").count();
    if (!isMulti) {
      await opts_.first().click();
    } else if (opts.skipMulti) {
      await page.click("#skip");
    } else {
      const codes = await page
        .locator(".opts.multi .opt")
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code!));
      // exclusive-варианты определяем по тексту (как в конфиге) — берём первые два, не начинающиеся с «Ни/Не/Пока/Всё/Нет»
      const titles = await page.locator(".opts.multi .otitle").allTextContents();
      const safe = codes
        .filter((_, i) => !/^(Ничего|Не использую|Нет, не пользуюсь|Пока|Всё нормально)/.test(titles[i]!))
        .slice(0, 2);
      for (const c of safe) await pick(page, c);
      await page.click("#next");
    }
    // ждём либо следующий вопрос, либо экран результата
    await page.waitForFunction(
      (prev) =>
        document.querySelector(".idbq")?.getAttribute("data-phase") !== "question" ||
        document.querySelector("#stepNum")?.textContent !== prev,
      before,
    );
    if ((await phase()) !== "question") {
      await expect(page.locator("[data-testid=meter]")).toBeVisible();
      return;
    }
  }
  throw new Error("ветка не завершилась за 20 шагов");
}

export const events = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer: { event: string }[] }).dataLayer ?? []).map((e) => e.event),
  );

export async function serverProfile(customer: string) {
  const r = await fetch(`${API}/api/v1/me/profile`, { headers: { "X-Customer-Id": customer } });
  return (await r.json()).data;
}
