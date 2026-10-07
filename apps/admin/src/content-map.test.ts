import { afterEach, describe, expect, it, vi } from "vitest";
import { type AdminApiError, api, setToken } from "./api.js";
import { fillMarkdownDocument, openContentMap } from "./content-map.js";

afterEach(() => {
  vi.unstubAllGlobals();
  setToken("");
});

describe("api.contentMap", () => {
  it("шлёт X-Admin-Token и не подставляет токен в URL", async () => {
    setToken("secret-admin-token");
    const fetchMock = vi.fn(async () => new Response("# Карта контента\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const md = await api.contentMap("1.0.0");

    expect(md).toBe("# Карта контента\n");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/admin/surveys/1.0.0/content-map");
    expect(url).not.toContain("secret-admin-token");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Token"]).toBe("secret-admin-token");
    expect(headers.Accept).toContain("text/markdown");
  });

  it("401 с конвертом ошибок становится AdminApiError", async () => {
    setToken("nope");
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ errors: [{ code: "UNAUTHORIZED", message: "Неверный X-Admin-Token" }] }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    await expect(api.contentMap("1.0.0")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Неверный X-Admin-Token",
    } satisfies Partial<AdminApiError>);
  });
});

describe("openContentMap", () => {
  function fakeWindow() {
    const doc = document.implementation.createHTMLDocument("");
    const close = vi.fn();
    const w = { document: doc, opener: {} as Window, close } as unknown as Window;
    return { doc, close, w };
  }

  it("пишет markdown текстом и обнуляет opener", async () => {
    const { doc, w } = fakeWindow();
    const errors: string[] = [];

    await openContentMap({
      version: "1.2.3",
      open: () => w,
      load: async () => "# Карта\n<script>alert(1)</script>",
      onError: (m) => errors.push(m),
    });

    expect(errors).toEqual([]);
    expect(w.opener).toBeNull();
    expect(doc.title).toBe("Карта контента 1.2.3");
    expect(doc.body.textContent).toContain("<script>alert(1)</script>");
    expect(doc.querySelector("script")).toBeNull();
  });

  it("без вкладки не ходит в API", async () => {
    const load = vi.fn(async () => "x");
    const errors: string[] = [];

    await openContentMap({
      version: "1.0.0",
      open: () => null,
      load,
      onError: (m) => errors.push(m),
    });

    expect(load).not.toHaveBeenCalled();
    expect(errors[0]).toMatch(/заблокировал/);
  });

  it("ошибка загрузки закрывает вкладку", async () => {
    const { close, w } = fakeWindow();
    const errors: string[] = [];

    await openContentMap({
      version: "1.0.0",
      open: () => w,
      load: async () => {
        throw new Error("Неверный токен");
      },
      onError: (m) => errors.push(m),
    });

    expect(close).toHaveBeenCalledOnce();
    expect(errors).toEqual(["Неверный токен"]);
    expect(w.opener).toBeNull();
  });

  it("fillMarkdownDocument заменяет прежнее содержимое", () => {
    const doc = document.implementation.createHTMLDocument("old");
    doc.body.innerHTML = "<p>старое</p>";
    fillMarkdownDocument(doc, "новый текст", "Карта");
    expect(doc.title).toBe("Карта");
    expect(doc.body.textContent).toBe("новый текст");
    expect(doc.querySelector("p")).toBeNull();
  });
});
