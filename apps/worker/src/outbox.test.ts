import { createDb, ensiOutbox, profiles, runMigrations, sessions, surveyVersions } from "@idb/db";
import { MockEnsiSink } from "@idb/ensi-client";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OutboxProcessor, backoffMs, enqueueLatest } from "./outbox.js";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://idb@localhost:5432/beauty_passport_test";
let db: ReturnType<typeof createDb>["db"];
let close: () => Promise<void>;

beforeAll(async () => {
  await runMigrations(TEST_DB);
  const c = createDb(TEST_DB, { max: 4 });
  db = c.db;
  close = c.close;
  await db
    .insert(surveyVersions)
    .values({ version: "test", config: {}, checksum: "x" })
    .onConflictDoNothing();
});
afterAll(async () => close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE sessions, profiles, ensi_outbox CASCADE`);
});

/** Создаёт сессию, профиль ревизии N и outbox-запись. */
async function seed(
  customerId: string,
  revision: number,
  status: "pending" | "failed" = "pending",
  attempts = 0,
) {
  const [s] = await db
    .insert(sessions)
    .values({ customerId, surveyVersion: "test" })
    .onConflictDoNothing()
    .returning();
  const sid =
    s?.id ??
    (
      await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.customerId, customerId)).limit(1)
    )[0]!.id;
  const payload = {
    schema_version: "1.0",
    customer_id: customerId,
    profile_revision: revision,
    gender: "female",
  };
  const [p] = await db.insert(profiles).values({ customerId, sessionId: sid, revision, payload }).returning();
  const [o] = await db
    .insert(ensiOutbox)
    .values({ profileId: p!.id, customerId, revision, status, attempts, nextAttemptAt: new Date(0) })
    .returning();
  return o!;
}
const rowsOf = (customerId: string) =>
  db
    .select({
      revision: ensiOutbox.revision,
      status: ensiOutbox.status,
      attempts: ensiOutbox.attempts,
      next: ensiOutbox.nextAttemptAt,
      err: ensiOutbox.lastError,
      ext: ensiOutbox.externalId,
    })
    .from(ensiOutbox)
    .where(eq(ensiOutbox.customerId, customerId))
    .orderBy(ensiOutbox.revision);

describe("backoffMs", () => {
  it("экспонента от 1 мин с потолком 24 ч", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(5)).toBe(960_000);
    expect(backoffMs(20)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("OutboxProcessor", () => {
  it("пустая очередь", async () => {
    const r = await new OutboxProcessor(db, new MockEnsiSink()).processBatch();
    expect(r).toEqual({ claimed: 0, sent: 0, failed: 0, dead: 0, superseded: 0 });
  });

  it("успех: sent, externalId, ключ идемпотентности и traceparent", async () => {
    await seed("a", 1);
    const sink = new MockEnsiSink();
    const r = await new OutboxProcessor(db, sink).processBatch();
    expect(r).toMatchObject({ claimed: 1, sent: 1 });
    expect(await rowsOf("a")).toMatchObject([{ status: "sent", attempts: 1, ext: "mock-a" }]);
    expect(sink.calls[0]!.ctx.idempotencyKey).toBe("a:1");
    expect(sink.calls[0]!.ctx.traceId).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("5xx → failed с задержкой, повтор после next_attempt_at, затем sent", async () => {
    await seed("b", 1);
    const sink = new MockEnsiSink();
    sink.script = [503];
    const t0 = new Date("2026-10-06T10:00:00Z");
    let now = t0;
    const p = new OutboxProcessor(db, sink, { now: () => now });
    expect(await p.processBatch()).toMatchObject({ failed: 1 });
    const [row] = await rowsOf("b");
    expect(row).toMatchObject({ status: "failed", attempts: 1, err: "HTTP 503" });
    expect(row!.next.getTime() - t0.getTime()).toBe(60_000);
    // ещё рано
    expect(await p.processBatch()).toMatchObject({ claimed: 0 });
    now = new Date(t0.getTime() + 61_000);
    expect(await p.processBatch()).toMatchObject({ sent: 1 });
    expect((await rowsOf("b"))[0]).toMatchObject({ status: "sent", attempts: 2, err: null });
  });

  it("4xx (кроме 429) → failed без повторов", async () => {
    await seed("c", 1);
    const sink = new MockEnsiSink();
    sink.script = [422];
    const p = new OutboxProcessor(db, sink);
    expect(await p.processBatch()).toMatchObject({ failed: 1 });
    expect(await p.processBatch()).toMatchObject({ claimed: 0 }); // next_attempt_at = «никогда»
    expect((await rowsOf("c"))[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(sink.calls).toHaveLength(1);
  });

  it("429 повторяется; после maxAttempts → dead", async () => {
    await seed("d", 1, "failed", 2);
    const sink = new MockEnsiSink();
    sink.script = [429];
    const p = new OutboxProcessor(db, sink, { maxAttempts: 3 });
    expect(await p.processBatch()).toMatchObject({ dead: 1 });
    expect((await rowsOf("d"))[0]).toMatchObject({ status: "dead", attempts: 3 });
  });

  it("две ревизии одного клиента в пачке: старая superseded, уходит только новая", async () => {
    await seed("e", 1);
    await seed("e", 2);
    const sink = new MockEnsiSink();
    const r = await new OutboxProcessor(db, sink).processBatch();
    expect(r).toMatchObject({ claimed: 2, sent: 1, superseded: 1 });
    expect(await rowsOf("e")).toMatchObject([
      { revision: 1, status: "superseded" },
      { revision: 2, status: "sent" },
    ]);
    expect(sink.calls.map((c) => c.profile.profile_revision)).toEqual([2]);
  });

  it("ревизия, появившаяся после захвата, вытесняет старую", async () => {
    await seed("f", 1);
    const sink = new MockEnsiSink();
    const p = new OutboxProcessor(db, sink);
    // эмулируем гонку: новая ревизия создаётся до отправки — для теста создаём заранее, но со статусом pending и будущим next_attempt_at
    const [prof] = await db
      .select({ sid: profiles.sessionId })
      .from(profiles)
      .where(eq(profiles.customerId, "f"));
    const [p2] = await db
      .insert(profiles)
      .values({ customerId: "f", sessionId: prof!.sid, revision: 2, payload: { profile_revision: 2 } })
      .returning();
    await db
      .insert(ensiOutbox)
      .values({
        profileId: p2!.id,
        customerId: "f",
        revision: 2,
        nextAttemptAt: new Date(Date.now() + 60_000),
      });
    expect(await p.processBatch()).toMatchObject({ claimed: 1, superseded: 1, sent: 0 });
    expect(sink.calls).toHaveLength(0);
  });

  it("enqueueLatest ставит последнюю ревизию и гасит старые dead", async () => {
    const o = await seed("g", 1);
    await db.update(ensiOutbox).set({ status: "dead" }).where(eq(ensiOutbox.id, o.id));
    expect(await enqueueLatest(db, "g")).toEqual({ revision: 1 });
    expect(await enqueueLatest(db, "nobody")).toBeNull();
    const rows = await rowsOf("g");
    expect(rows.map((r) => r.status).sort()).toEqual(["pending", "superseded"]);
    const sink = new MockEnsiSink();
    expect(await new OutboxProcessor(db, sink).processBatch()).toMatchObject({ sent: 1 });
  });

  it("параллельные воркеры не отправляют одно задание дважды (SKIP LOCKED)", async () => {
    for (let i = 0; i < 6; i++) await seed(`h${i}`, 1);
    const sink = new MockEnsiSink();
    const p1 = new OutboxProcessor(db, sink, { batchSize: 3 });
    const p2 = new OutboxProcessor(db, sink, { batchSize: 3 });
    const [r1, r2] = await Promise.all([p1.processBatch(), p2.processBatch()]);
    expect(r1.sent + r2.sent).toBe(6);
    expect(new Set(sink.calls.map((c) => c.profile.customer_id)).size).toBe(6);
  });
});
