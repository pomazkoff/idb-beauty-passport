import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeautyProfile } from "@idb/core";
import { describe, expect, it } from "vitest";
import { FileEnsiSink } from "./file.js";
import { HttpEnsiSink } from "./http/http-sink.js";
import { resolvePath, toEnsiPayload } from "./http/mapping.js";
import { EnsiError, createSinkFromEnv } from "./index.js";
import { MockEnsiSink } from "./mock.js";

const profile: BeautyProfile = {
  schema_version: "1.0",
  customer_id: "c/1",
  profile_revision: 3,
  survey_version: "1.0.0",
  updated_at: "2026-10-06T07:30:00Z",
  gender: "female",
  psychotype: { code: "E", name: "Эмоциональный", votes: { E: 2, P: 1, L: 0, M: 0 } },
  primary_category: "face",
  completed_categories: ["face"],
  completeness_pct: 60,
  widgets: { priority: ["news_blog"], base: ["favorites"] },
  answers: [{ stage: "base", question_key: "gender", option_codes: ["female"], skipped: false }],
  traits: { "face.skin_type": ["combination"], "face.concerns": ["dull", "aging"] },
  tags: ["skin_type:combination"],
};
const ctx = { traceId: "00-abc-def-01", idempotencyKey: "c/1:3" };

describe("mapping", () => {
  it("плоские атрибуты + полный профиль", () => {
    const p = toEnsiPayload(profile);
    expect(p.customer_id).toBe("c/1");
    expect(p.attributes).toMatchObject({
      beauty_psychotype: "E",
      beauty_completeness_pct: 60,
      beauty_trait_face_skin_type: ["combination"],
      beauty_trait_face_concerns: ["dull", "aging"],
      beauty_completed_categories: ["face"],
    });
    expect(p.beauty_profile).toBe(profile);
  });
  it("resolvePath кодирует customer_id", () => {
    expect(resolvePath("/api/v1/customers/{customer_id}/beauty-profile/{revision}", profile)).toBe(
      "/api/v1/customers/c%2F1/beauty-profile/3",
    );
  });
});

describe("MockEnsiSink", () => {
  it("сценарий ошибок и успех", async () => {
    const s = new MockEnsiSink();
    s.script = [503, "network", 422, undefined];
    await expect(s.upsertProfile(profile, ctx)).rejects.toMatchObject({ status: 503, retryable: true });
    await expect(s.upsertProfile(profile, ctx)).rejects.toMatchObject({ status: null, retryable: true });
    await expect(s.upsertProfile(profile, ctx)).rejects.toMatchObject({ status: 422, retryable: false });
    await expect(s.upsertProfile(profile, ctx)).resolves.toEqual({ externalId: "mock-c/1" });
    expect(s.calls).toHaveLength(4);
    expect(await s.fetchProfile("c/1")).toBe(profile);
  });
});

describe("FileEnsiSink", () => {
  it("пишет rev-N.json и latest.json, читает обратно", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ensi-"));
    const s = new FileEnsiSink(dir);
    const r = await s.upsertProfile(profile, ctx);
    expect(r.externalId).toBe("file:c_1/rev-3");
    const raw = JSON.parse(await readFile(join(dir, "c_1", "rev-3.json"), "utf8"));
    expect(raw._meta.idempotencyKey).toBe("c/1:3");
    expect(await s.fetchProfile("c/1")).toEqual(profile);
    expect(await s.fetchProfile("nope")).toBeNull();
  });
});

describe("HttpEnsiSink", () => {
  const mk = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) =>
    new HttpEnsiSink({
      baseUrl: "https://ensi.example/",
      profilePath: "/api/v1/customers/{customer_id}/beauty-profile",
      method: "PUT",
      authHeader: "Authorization",
      authValue: "Bearer t",
      fetchPath: "/api/v1/customers/{customer_id}/beauty-profile",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) =>
        handler(String(url), init ?? {})) as typeof fetch,
    });

  it("PUT с заголовками идемпотентности и трейсинга, читает data.id", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const s = mk((url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ data: { id: 42 } }), { status: 200 });
    });
    const r = await s.upsertProfile(profile, ctx);
    expect(r).toEqual({ externalId: "42" });
    expect(seen!.url).toBe("https://ensi.example/api/v1/customers/c%2F1/beauty-profile");
    const h = seen!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer t");
    expect(h["Idempotency-Key"]).toBe("c/1:3");
    expect(h.traceparent).toBe("00-abc-def-01");
    expect(JSON.parse(seen!.init.body as string).attributes.beauty_psychotype).toBe("E");
  });

  it("конверт ошибок ENSI: 422 не повторяется, 503 повторяется, сеть повторяется", async () => {
    const e422 = mk(
      () =>
        new Response(JSON.stringify({ errors: [{ code: "ValidationError", message: "bad" }] }), {
          status: 422,
        }),
    );
    await expect(e422.upsertProfile(profile, ctx)).rejects.toMatchObject({
      status: 422,
      retryable: false,
      message: expect.stringContaining("ValidationError: bad"),
    });
    const e503 = mk(() => new Response("upstream down", { status: 503 }));
    await expect(e503.upsertProfile(profile, ctx)).rejects.toMatchObject({ status: 503, retryable: true });
    const net = mk(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(net.upsertProfile(profile, ctx)).rejects.toBeInstanceOf(EnsiError);
    await expect(net.upsertProfile(profile, ctx)).rejects.toMatchObject({ retryable: true, status: null });
  });

  it("fetchProfile: 404 → null, data.beauty_profile → профиль", async () => {
    const s404 = mk(() => new Response("", { status: 404 }));
    expect(await s404.fetchProfile("c/1")).toBeNull();
    const ok = mk(() => new Response(JSON.stringify({ data: { beauty_profile: profile } }), { status: 200 }));
    expect(await ok.fetchProfile("c/1")).toEqual(profile);
  });

  it("таймаут → retryable", async () => {
    const s = new HttpEnsiSink({
      baseUrl: "https://ensi.example",
      profilePath: "/p/{customer_id}",
      timeoutMs: 20,
      fetchImpl: ((_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) =>
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
        )) as typeof fetch,
    });
    await expect(s.upsertProfile(profile, ctx)).rejects.toMatchObject({ retryable: true });
  });
});

describe("createSinkFromEnv", () => {
  it("выбирает реализацию", () => {
    expect(createSinkFromEnv({ ENSI_SINK: "mock" }).name).toBe("mock");
    expect(createSinkFromEnv({ ENSI_SINK: "file", ENSI_FILE_DIR: "/tmp/x" }).name).toBe("file");
    expect(
      createSinkFromEnv({ ENSI_SINK: "http", ENSI_BASE_URL: "https://e", ENSI_PROFILE_PATH: "/p" }).name,
    ).toBe("http");
    expect(() => createSinkFromEnv({ ENSI_SINK: "http" })).toThrow(/ENSI_BASE_URL/);
    expect(() => createSinkFromEnv({ ENSI_SINK: "zzz" })).toThrow();
  });
});
