import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { events, newCustomer, open, passBase, passBranch, pick, serverProfile, step } from "./helpers.js";

test.describe("Опросник ЛК / Паспорт красоты", () => {
  test("сценарий 1 · женщина E: лицо → волосы, 80 %, профиль ушёл в outbox", async ({ page }) => {
    const c = newCustomer("w-e");
    await open(page, c);
    await expect(page.locator("h1")).toContainText("Ваш профиль");
    await passBase(page, "female", ["E", "E", "P"], "face");

    await expect(page.locator("[data-testid=psychotype] .rtype-name")).toHaveText("Эмоциональный");
    await expect(page.locator("[data-testid=meter-val]")).toHaveText("40%");
    await expect(page.locator("[data-testid=widgets-priority] .w")).toHaveCount(7);
    await expect(page.locator("[data-testid=widgets-base] .w")).toHaveCount(6);
    await expect(page.locator("#pass")).toHaveText(/Собрать Паспорт · Уход за лицом/);

    await page.click("#pass");
    await expect(page.locator("#stepName")).toHaveText("Паспорт · Уход за лицом");
    await expect(step(page)).toHaveText("1 / 7");
    await passBranch(page);
    await expect(page.locator("[data-testid=meter-val]")).toHaveText("60%");
    await expect(page.locator("[data-testid=profile-face] .prow")).toHaveCount(7);
    await expect(page.locator("[data-testid=add-category] .opt")).toHaveCount(6);

    await page.click('[data-testid=add-category] .opt[data-c="hair"]');
    await expect(page.locator("#stepName")).toHaveText("Паспорт · Уход за волосами");
    await passBranch(page);
    await expect(page.locator("[data-testid=meter-val]")).toHaveText("80%");
    await expect(page.locator("[data-testid=profile-hair]")).toBeVisible();
    await expect(page.locator("[data-testid=profile-face]")).toBeVisible();

    const p = await serverProfile(c);
    expect(p.profile).toMatchObject({
      psychotype: { code: "E" },
      completeness_pct: 80,
      completed_categories: ["face", "hair"],
    });
    expect(["pending", "sent", "sending"]).toContain(p.ensi.status);
    expect(p.ensi.revision).toBe(3);
  });

  test("сценарий 2 · мужчина P: лицо и бритьё, 5 вопросов, без макияжа", async ({ page }) => {
    const c = newCustomer("m-p");
    await open(page, c);
    await passBase(page, "male", ["P", "P", "L"], "face");
    await expect(page.locator("[data-testid=psychotype] .rtype-name")).toHaveText("Прагматичный");
    await expect(page.locator("[data-testid=widgets-priority] .w")).toHaveCount(5);
    await expect(page.locator("#pass")).toHaveText(/Уход за лицом и бритьё/);
    await page.click("#pass");
    await expect(step(page)).toHaveText("1 / 5");
    await passBranch(page);
    await expect(page.locator("[data-testid=profile-face] .pk")).toContainText([
      "Тип кожи",
      "Состояния и задачи",
      "Рутина",
      "Бритьё",
      "Факторы влияния",
    ]);
    const rest = await page
      .locator("[data-testid=add-category] .opt")
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.c));
    expect(rest).toEqual(["body", "hair", "sun", "perfume", "home"]);
  });

  test("сценарий 3 · смешанный тип: все 11 приоритетных виджетов, пропуск всех multi даёт +20 %", async ({
    page,
  }) => {
    const c = newCustomer("w-m");
    await open(page, c);
    await passBase(page, "female", ["E", "P", "L"], "home");
    await expect(page.locator("[data-testid=psychotype] .rtype-name")).toHaveText("Смешанный");
    await expect(page.locator("[data-testid=widgets-priority] .w")).toHaveCount(11);
    await page.click("#pass");
    await expect(page.locator(".draft")).toHaveText("вопрос дописан");
    await passBranch(page, { skipMulti: true });
    await expect(page.locator("[data-testid=meter-val]")).toHaveText("60%");
    await expect(page.locator("[data-testid=profile-home]")).toHaveCount(0); // всё пропущено — таблицы нет
  });

  test("сценарий 4 · прерывание и восстановление сессии", async ({ page }) => {
    const c = newCustomer("resume");
    await open(page, c);
    await page.click("#go");
    await pick(page, "female");
    await expect(step(page)).toHaveText("2 / 5");
    await pick(page, "L");
    await expect(step(page)).toHaveText("3 / 5");
    await page.waitForTimeout(500); // дождаться отправки
    await page.reload();
    await expect(step(page)).toHaveText("3 / 5");
    await expect(page.locator(".qtext")).toContainText("Какое главное ощущение");
    await pick(page, "L");
    await pick(page, "L");
    await pick(page, "perfume");
    await expect(page.locator("[data-testid=psychotype] .rtype-name")).toHaveText("Премиальный");
    await page.reload();
    await expect(page.locator("[data-testid=psychotype] .rtype-name")).toHaveText("Премиальный");
  });

  test("смена пола через «Назад» сбрасывает ответы", async ({ page }) => {
    await open(page, newCustomer("gender"));
    await page.click("#go");
    await pick(page, "female");
    await pick(page, "E");
    await pick(page, "E");
    await expect(step(page)).toHaveText("4 / 5");
    await page.click("#back");
    await page.click("#back");
    await page.click("#back");
    await expect(step(page)).toHaveText("1 / 5");
    await expect(page.locator('.opt[data-code="female"]')).toHaveClass(/on/);
    await pick(page, "male");
    await expect(step(page)).toHaveText("2 / 5");
    await expect(page.locator(".opt.on")).toHaveCount(0);
    await expect(page.locator(".otitle").first()).toContainText("Широкий выбор"); // мужская формулировка
    const ev = await events(page);
    expect(ev.filter((e) => e === "quiz_back")).toHaveLength(3);
  });

  test("«Позже» → «Всё-таки собрать»; exclusive-вариант; события аналитики", async ({ page }) => {
    const c = newCustomer("later");
    await open(page, c);
    await passBase(page, "female", ["E", "E", "E"], "face");
    await page.click("#later");
    await expect(page.locator("[data-testid=announce]")).toContainText("Хорошо, вернёмся к этому позже");
    await page.click("#pass2");
    await pick(page, "oily");
    await pick(page, "dull");
    await pick(page, "none");
    await expect(page.locator(".opt.on")).toHaveCount(1);
    await expect(page.locator('.opt[data-code="none"]')).toHaveClass(/on/);
    await pick(page, "aging");
    await expect(page.locator('.opt[data-code="none"]')).not.toHaveClass(/on/);
    await page.click("#next");
    await page.click("#skip");
    const ev = await events(page);
    for (const n of [
      "quiz_started",
      "quiz_question_shown",
      "quiz_question_answered",
      "quiz_base_completed",
      "passport_announce_shown",
      "passport_postponed",
      "passport_started",
      "quiz_question_skipped",
    ]) {
      expect(ev, n).toContain(n);
    }
    const answered = await page.evaluate(() =>
      ((window as unknown as { dataLayer: Record<string, unknown>[] }).dataLayer ?? []).find(
        (e) => e.event === "quiz_question_answered" && e.question_key === "psycho1",
      ),
    );
    expect(answered).toMatchObject({ stage: "base", answer_codes: ["E"] });
    expect(typeof (answered as { time_ms: number }).time_ms).toBe("number");
    // события дошли до сервера
    await page.waitForTimeout(2500);
    const r = await fetch(`${process.env.E2E_API_URL ?? "http://localhost:3000"}/metrics`);
    expect(await r.text()).toContain('http_requests_total{route="/api/v1/events",status="202"}');
  });

  test("«Пройти заново» архивирует сессию", async ({ page }) => {
    const c = newCustomer("again");
    await open(page, c);
    await passBase(page, "male", ["E", "E", "E"], "body");
    await page.click("#again");
    await expect(page.locator("#go")).toBeVisible();
    await page.click("#go");
    await expect(step(page)).toHaveText("1 / 1");
    await expect(page.locator(".opt.on")).toHaveCount(0);
  });

  test("доступность: axe без критических нарушений на intro, вопросе и результате", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // без fade-анимации — axe видит итоговые цвета
    await open(page, newCustomer("axe"));
    const check = async (label: string) => {
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(serious, `${label}: ${serious.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual(
        [],
      );
    };
    await check("intro");
    await page.click("#go");
    await pick(page, "female");
    await expect(step(page)).toHaveText("2 / 5");
    await check("single");
    await pick(page, "E");
    await pick(page, "E");
    await pick(page, "E");
    await pick(page, "face");
    await check("result1");
    await page.click("#pass");
    await pick(page, "dry");
    await check("multi");
    // клавиатура: стрелка вниз переводит фокус между вариантами, пробел выбирает
    await page.locator(".opt").first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".opt").nth(1)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator(".opt").nth(1)).toHaveClass(/on/);
  });
});
