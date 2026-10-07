import { expect, test } from "@playwright/test";

/**
 * Конструктор (этап 9): вход → черновик → правка → замечания → предпросмотр на черновике → публикация.
 * Токен берётся из окружения API (см. playwright.config.ts). Версии выбираются уникальные, чтобы прогоны не мешали друг другу.
 */
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";
const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const TOKEN = process.env.ADMIN_TOKEN ?? "e2e-admin-token-0123456789";

test.describe("Конструктор опросника", () => {
  test("карта контента запрашивается с X-Admin-Token и открывается во вкладке", async ({ page }) => {
    await page.goto(ADMIN_URL);
    await page.fill("input.mono", TOKEN);
    await page.click("button[type=submit]");
    await expect(page.locator("table")).toBeVisible();
    await page
      .locator("tbody tr")
      .filter({ has: page.locator(".badge.published") })
      .getByRole("button", { name: "Открыть" })
      .click();
    await expect(page.getByRole("button", { name: "Карта контента" })).toBeVisible();

    const reqPromise = page.waitForRequest((r) => r.url().includes("/content-map") && r.method() === "GET");
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "Карта контента" }).click(),
    ]);
    const req = await reqPromise;
    expect(req.headers()["x-admin-token"]).toBe(TOKEN);
    expect(req.url()).not.toContain(TOKEN);
    expect(new URL(req.url()).search).toBe("");
    await expect(popup.locator("pre")).toContainText("Карта контента");
    await popup.close();
  });

  test("полный цикл версии", async ({ page }) => {
    const ver = `7.${Math.floor(Date.now() / 1000) % 100000}.${Math.floor(Math.random() * 100)}`;
    const marker = `[e2e ${ver}]`;
    await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
    await page.goto(ADMIN_URL);
    await page.fill("input.mono", TOKEN);
    await page.click("button[type=submit]");
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("tbody tr td:nth-child(2) .badge.published")).toHaveCount(1);

    // черновик
    await page.click("text=+ Новый черновик");
    const dialog = page.locator("dialog");
    await dialog.locator("input.mono").first().fill(ver);
    await dialog.locator("button.btn-primary").click();
    await expect(page.locator("main.card")).toBeVisible();
    await expect(page.locator(".status-line")).toHaveText(/сохранено/);
    await expect(page.locator("aside .badge")).toHaveText(/замечаний нет/);

    // правка текста psycho1 → автосохранение
    const ta = page.locator("#q-psycho1 textarea").first();
    const original = await ta.inputValue();
    await ta.fill(`${original} ${marker}`);
    await expect(page.locator(".status-line")).toHaveText(/несохранённые|сохраняем/);
    await expect(page.locator(".status-line")).toHaveText(/сохранено/, { timeout: 10_000 });

    // ветка лица: опубликованный вариант нельзя удалить, можно скрыть; новый вариант получает код транслитом
    await page.click("nav button:has-text('Уход за лицом')");
    await page.locator("#q-face_skin_type .q-head").click();
    const firstRow = page.locator("#q-face_skin_type .opt-row").first();
    await expect(firstRow.locator("text=скрыт")).toHaveCount(1);
    await expect(firstRow.locator("text=удалить")).toHaveCount(0);
    await expect(page.locator("#q-face_skin_type input.mono").first()).toBeDisabled();
    await page.click("#q-face_skin_type button:has-text('+ Вариант')");
    const lastRow = page.locator("#q-face_skin_type .opt-row").last();
    await lastRow.locator("input").first().fill("Очень сухая");
    await expect(lastRow.locator("input.mono")).toHaveValue(/^ochen_suhaya(_\d+)?$/);

    // новый вопрос без текста → замечания, после удаления — чисто
    await page.click("main button:has-text('+ Вопрос')");
    const newQ = page.locator(".q-card").last();
    await newQ.locator(".field input").first().fill("Чувствительность");
    await expect(newQ.locator("input.mono").first()).toHaveValue("face_chuvstvitelnost");
    await expect(page.locator("aside .badge.err")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button:has-text('Опубликовать')")).toBeDisabled();
    await newQ.locator("text=Удалить вопрос").click();
    await expect(page.locator("aside .badge")).toHaveText(/замечаний нет/, { timeout: 10_000 });

    // предпросмотр черновика показывает правку, опубликованная — нет
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.click("a:has-text('Предпросмотр')"),
    ]);
    await preview.route("**/fonts.googleapis.com/**", (r) => r.abort());
    await preview.click("#go");
    await preview.click(".opt[data-code=female]");
    await expect(preview.locator(".qtext")).toContainText(marker);
    await preview.close();
    const published = await (await fetch(`${API}/api/v1/survey?gender=female`)).json();
    expect(JSON.stringify(published)).not.toContain(marker);

    // публикация → health отдаёт новую версию, ENSI-API тоже
    await page.click("button:has-text('Опубликовать')");
    await page.locator("dialog button.btn-primary").click();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator(`tr[data-version="${ver}"] td:nth-child(2) .badge.published`)).toBeVisible();
    const health = await (await fetch(`${API}/api/v1/health`)).json();
    expect(health.data.surveyVersion).toBe(ver);
    const ensi = await (
      await fetch(`${API}/api/v1/integration/surveys/current`, {
        headers: { "X-Api-Key": process.env.INTEGRATION_API_KEY ?? "e2e-integration-key-0123456789" },
      })
    ).json();
    expect(ensi.meta.version).toBe(ver);
    expect(JSON.stringify(ensi.data)).toContain(marker);
  });
});
