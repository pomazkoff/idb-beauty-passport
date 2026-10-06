import { createDb, runMigrations } from "@idb/db";
import { survey } from "@idb/survey-config";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, registerSurveyVersion } from "./app.js";
import { loadConfig } from "./config.js";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://idb@localhost:5432/beauty_passport_test";

let app: FastifyInstance;
let close: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

beforeAll(async () => {
  await runMigrations(TEST_DB);
  const conn = createDb(TEST_DB, { max: 4 });
  db = conn.db;
  close = conn.close;
  await registerSurveyVersion(db, survey);
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    AUTH_MODE: "dev",
    CORS_ORIGINS: "http://localhost:5173",
    SWAGGER_ENABLED: "true",
    RATE_LIMIT_PER_MINUTE: "1000",
  });
  app = await buildApp({ config, db, survey, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await close();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE sessions, profiles, ensi_outbox, analytics_events CASCADE`);
});

// ── helpers ──────────────────────────────────────────────────────────
const H = (customer: string) => ({ "x-customer-id": customer });
const call = (method: "GET" | "POST" | "PUT", url: string, customer: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: H(customer), payload: payload as never });
const put = (customer: string, key: string, codes: string[], skipped = false) =>
  call("PUT", `/me/session/answers/${key}`, customer, { optionCodes: codes, skipped });

async function passBase(customer: string, gender: "female" | "male", votes: string[], category = "face") {
  expect((await put(customer, "gender", [gender])).statusCode).toBe(200);
  expect((await put(customer, "psycho1", [votes[0]!])).statusCode).toBe(200);
  expect((await put(customer, "psycho2", [votes[1]!])).statusCode).toBe(200);
  expect((await put(customer, "psycho3", [votes[2]!])).statusCode).toBe(200);
  expect((await put(customer, "category", [category])).statusCode).toBe(200);
  const r = await call("POST", "/me/session/base:complete", customer);
  expect(r.statusCode).toBe(200);
  return r.json().data;
}

async function passBranch(customer: string, gender: "female" | "male", category: string) {
  const s = await call("POST", "/me/session/passport:start", customer, { category });
  expect(s.statusCode).toBe(200);
  const cfg = (await app.inject({ method: "GET", url: `/api/v1/survey?gender=${gender}` })).json().data;
  const branch = cfg.branches.find((b: { category: string }) => b.category === category);
  for (const q of branch.questions) {
    const codes =
      q.type === "single"
        ? [q.options[0].code]
        : q.options
            .filter((o: { exclusive?: boolean }) => !o.exclusive)
            .slice(0, 2)
            .map((o: { code: string }) => o.code);
    expect((await put(customer, q.key, codes)).statusCode).toBe(200);
  }
  const r = await call("POST", "/me/session/passport:complete", customer, { category });
  expect(r.statusCode).toBe(200);
  return r.json().data;
}

// ── служебные ────────────────────────────────────────────────────────
describe("ops", () => {
  it("health, ready, metrics, openapi", async () => {
    expect((await app.inject({ url: "/api/v1/health" })).json()).toEqual({
      data: { status: "ok", surveyVersion: "1.0.0" },
    });
    expect((await app.inject({ url: "/api/v1/ready" })).statusCode).toBe(200);
    const m = await app.inject({ url: "/metrics" });
    expect(m.statusCode).toBe(200);
    expect(m.body).toContain("ensi_outbox_size");
    const o = await app.inject({ url: "/api/v1/openapi.json" });
    expect(o.statusCode).toBe(200);
    expect(o.json().paths["/api/v1/me/session/answers/{questionKey}"]).toBeDefined();
  });

  it("404 в конверте", async () => {
    const r = await app.inject({ url: "/api/v1/nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ errors: [{ code: "NOT_FOUND", message: "Маршрут не найден" }] });
  });
});

// ── GET /survey ──────────────────────────────────────────────────────
describe("GET /survey", () => {
  it("без пола — только вопрос gender; с полом — 5 базовых и ветки", async () => {
    const none = (await app.inject({ url: "/api/v1/survey" })).json().data;
    expect(none.base.map((q: { key: string }) => q.key)).toEqual(["gender"]);
    expect(none.branches).toEqual([]);
    const f = (await app.inject({ url: "/api/v1/survey?gender=female" })).json().data;
    expect(f.base).toHaveLength(5);
    expect(f.branches).toHaveLength(7);
    const m = (await app.inject({ url: "/api/v1/survey?gender=male" })).json().data;
    expect(m.branches).toHaveLength(6);
    expect(m.branches.map((b: { category: string }) => b.category)).not.toContain("makeup");
  });

  it("ETag / 304", async () => {
    const r1 = await app.inject({ url: "/api/v1/survey?gender=female" });
    const etag = r1.headers.etag as string;
    expect(etag).toBeTruthy();
    const r2 = await app.inject({ url: "/api/v1/survey?gender=female", headers: { "if-none-match": etag } });
    expect(r2.statusCode).toBe(304);
  });

  it("невалидный пол → 422", async () => {
    const r = await app.inject({ url: "/api/v1/survey?gender=x" });
    expect(r.statusCode).toBe(422);
    expect(r.json().errors[0].code).toBe("VALIDATION_ERROR");
  });
});

// ── auth ─────────────────────────────────────────────────────────────
describe("auth (dev)", () => {
  it("без X-Customer-Id → 401", async () => {
    const r = await app.inject({ url: "/api/v1/me/session" });
    expect(r.statusCode).toBe(401);
    expect(r.json().errors[0].code).toBe("UNAUTHORIZED");
  });

  it("изоляция пользователей", async () => {
    await put("a", "gender", ["female"]);
    const b = (await call("GET", "/me/session", "b")).json().data;
    expect(b.answers).toEqual({});
    const a = (await call("GET", "/me/session", "a")).json().data;
    expect(a.answers.gender.optionCodes).toEqual(["female"]);
  });
});

// ── сессия и ответы ──────────────────────────────────────────────────
describe("сессия", () => {
  it("создаётся при первом обращении, одна активная на клиента", async () => {
    const r1 = (await call("GET", "/me/session", "c1")).json().data;
    const r2 = (await call("GET", "/me/session", "c1")).json().data;
    expect(r1.sessionId).toBe(r2.sessionId);
    expect(r1).toMatchObject({
      stage: "intro",
      surveyVersion: "1.0.0",
      derived: { completenessPct: 0, psychotype: "M" },
    });
  });

  it("PUT ответа переводит стадию в base и возвращает derived", async () => {
    const r = await put("c2", "gender", ["male"]);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      data: { stage: "base", derived: { gender: "male" } },
      meta: { genderReset: false },
    });
  });

  it("валидация: неизвестный вопрос 404, чужой вариант 422, два варианта в single 422", async () => {
    await put("c3", "gender", ["female"]);
    expect((await put("c3", "nope", ["x"])).json().errors[0].code).toBe("QUESTION_NOT_FOUND");
    expect((await put("c3", "psycho1", ["Z"])).json()).toMatchObject({
      errors: [{ code: "OPTION_NOT_ALLOWED", meta: { option: "Z" } }],
    });
    expect((await put("c3", "psycho1", ["E", "P"])).statusCode).toBe(422);
    expect((await put("c3", "psycho1", [], true)).statusCode).toBe(422); // single нельзя пропустить
    const bad = await call("PUT", "/me/session/answers/psycho1", "c3", { optionCodes: "E" });
    expect(bad.statusCode).toBe(422);
  });

  it("смена пола сбрасывает ответы (meta.genderReset)", async () => {
    await passBase("c4", "female", ["E", "E", "E"], "makeup");
    const r = await put("c4", "gender", ["male"]);
    expect(r.json().meta.genderReset).toBe(true);
    expect(Object.keys(r.json().data.answers)).toEqual(["gender"]);
    expect(r.json().data.derived.completenessPct).toBe(0);
  });

  it("base:complete до ответов → 409", async () => {
    await put("c5", "gender", ["female"]);
    const r = await call("POST", "/me/session/base:complete", "c5");
    expect(r.statusCode).toBe(409);
    expect(r.json().errors[0].code).toBe("STAGE_NOT_COMPLETE");
  });

  it("полный проход базы → профиль, стадия result1, outbox pending", async () => {
    const p = await passBase("c6", "female", ["E", "E", "P"], "face");
    expect(p).toMatchObject({
      customer_id: "c6",
      profile_revision: 1,
      gender: "female",
      psychotype: { code: "E" },
      primary_category: "face",
      completeness_pct: 40,
      completed_categories: [],
    });
    expect(p.widgets.priority).toHaveLength(7);
    const s = (await call("GET", "/me/session", "c6")).json().data;
    expect(s.stage).toBe("result1");
    const prof = (await call("GET", "/me/profile", "c6")).json().data;
    expect(prof.ensi).toMatchObject({ status: "pending", revision: 1, attempts: 0 });
  });

  it("паспорт: start недоступной категории 422, complete без ответов 409, затем успех и 60%", async () => {
    await passBase("c7", "male", ["P", "P", "P"], "face");
    const bad = await call("POST", "/me/session/passport:start", "c7", { category: "makeup" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].code).toBe("BRANCH_NOT_AVAILABLE");
    await call("POST", "/me/session/passport:start", "c7", { category: "face" });
    const s = (await call("GET", "/me/session", "c7")).json().data;
    expect(s).toMatchObject({ stage: "passport", activeCategory: "face" });
    const early = await call("POST", "/me/session/passport:complete", "c7", { category: "face" });
    expect(early.statusCode).toBe(409);
    const p = await passBranch("c7", "male", "face");
    expect(p).toMatchObject({ profile_revision: 2, completeness_pct: 60, completed_categories: ["face"] });
    expect(Object.keys(p.traits)).toEqual([
      "face.skin_type",
      "face.concerns",
      "face.routine",
      "face.shaving",
      "face.factors",
    ]);
  });

  it("outbox: новая ревизия супersedes старую pending", async () => {
    await passBase("c8", "female", ["L", "L", "L"], "hair");
    await passBranch("c8", "female", "hair");
    const rows = await db.execute(
      sql`SELECT revision, status FROM ensi_outbox WHERE customer_id = 'c8' ORDER BY revision`,
    );
    expect([...rows]).toEqual([
      { revision: 1, status: "superseded" },
      { revision: 2, status: "pending" },
    ]);
  });

  it("повтор категории не добавляет процент; три категории → 100", async () => {
    await passBase("c9", "female", ["E", "E", "E"], "face");
    await passBranch("c9", "female", "face");
    const again = await passBranch("c9", "female", "face");
    expect(again.completeness_pct).toBe(60);
    await passBranch("c9", "female", "hair");
    const p = await passBranch("c9", "female", "home");
    expect(p.completeness_pct).toBe(100);
    expect(p.completed_categories).toEqual(["face", "hair", "home"]);
  });

  it("reset архивирует сессию и начинает новую; профиль остаётся читаемым", async () => {
    await passBase("c10", "male", ["E", "E", "E"], "body");
    const r = await call("POST", "/me/session:reset", "c10");
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ stage: "intro", answers: {} });
    const rows = await db.execute(
      sql`SELECT status FROM sessions WHERE customer_id = 'c10' ORDER BY started_at`,
    );
    expect([...rows].map((x) => (x as { status: string }).status)).toEqual(["archived", "active"]);
    const prof = (await call("GET", "/me/profile", "c10")).json().data;
    expect(prof.profile.profile_revision).toBe(1);
    // новая база даёт ревизию 2
    const p2 = await passBase("c10", "male", ["P", "P", "P"], "face");
    expect(p2.profile_revision).toBe(2);
  });
});

// ── ретеншн ──────────────────────────────────────────────────────────
describe("purgeOld", () => {
  it("удаляет старые архивные сессии без профилей, но не сессии с профилями", async () => {
    await passBase("r1", "female", ["E", "E", "E"], "face"); // сессия с профилем
    await call("POST", "/me/session:reset", "r1"); // архивирована
    await put("r2", "gender", ["male"]);
    await call("POST", "/me/session:reset", "r2"); // архив без профиля
    await db.execute(
      sql`UPDATE sessions SET archived_at = now() - interval '400 days' WHERE status = 'archived'`,
    );
    await app.sessionService.purgeOld(365);
    const left = await db.execute(
      sql`SELECT customer_id FROM sessions WHERE status = 'archived' ORDER BY customer_id`,
    );
    expect([...left].map((r) => (r as { customer_id: string }).customer_id)).toEqual(["r1"]);
    const prof = (await call("GET", "/me/profile", "r1")).json().data;
    expect(prof.profile.profile_revision).toBe(1);
  });
});

// ── события ──────────────────────────────────────────────────────────
describe("POST /events", () => {
  it("принимает пакет, привязывает к сессии, отвергает неизвестные имена", async () => {
    await put("e1", "gender", ["female"]);
    const ok = await call("POST", "/events", "e1", {
      events: [
        { name: "quiz_started", params: {}, ts: new Date().toISOString() },
        { name: "quiz_question_shown", params: { stage: "base", question_key: "gender", index: 0 } },
      ],
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().data.accepted).toBe(2);
    const rows = await db.execute(
      sql`SELECT name, session_id FROM analytics_events WHERE customer_id = 'e1' ORDER BY id`,
    );
    expect([...rows]).toHaveLength(2);
    expect((rows[0] as { session_id: string | null }).session_id).not.toBeNull();
    const bad = await call("POST", "/events", "e1", { events: [{ name: "hack", params: {} }] });
    expect(bad.statusCode).toBe(422);
  });
});
