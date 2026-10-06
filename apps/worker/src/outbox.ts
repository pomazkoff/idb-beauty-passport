/**
 * Обработка outbox (ТЗ 10.3):
 *  1. берём пачку pending/failed с next_attempt_at <= now (FOR UPDATE SKIP LOCKED), помечаем sending;
 *  2. для каждого клиента отправляем только последнюю ревизию; более старые → superseded;
 *  3. успех → sent; retryable-ошибка → failed с экспоненциальной задержкой (1 мин → 2 → 4 … ≤ 24 ч);
 *     не-retryable (4xx кроме 429) → failed без повторов; attempts ≥ max → dead.
 */
import type { BeautyProfile } from "@idb/core";
import { type Db, ensiOutbox, profiles } from "@idb/db";
import { EnsiError, type EnsiSink } from "@idb/ensi-client";
import { and, eq, inArray, lte, sql } from "drizzle-orm";

export type OutboxOptions = {
  batchSize?: number;
  /** Задание в статусе sending дольше этого срока считается зависшим (упавший воркер) и возвращается в failed. */
  staleSendingMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => Date;
  log?: {
    info: (o: object, msg: string) => void;
    warn: (o: object, msg: string) => void;
    error: (o: object, msg: string) => void;
  };
  onMetric?: (name: string, value?: number) => void;
};

/** «Никогда» для next_attempt_at: год 9999 — в пределах timestamptz. */
const NEVER = new Date("9999-12-31T00:00:00Z");

export type BatchResult = { claimed: number; sent: number; failed: number; dead: number; superseded: number };

export function backoffMs(attempt: number, base = 60_000, max = 24 * 60 * 60 * 1000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

export class OutboxProcessor {
  private readonly batchSize: number;
  private readonly staleSendingMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => Date;
  private readonly log: NonNullable<OutboxOptions["log"]>;
  private readonly onMetric: NonNullable<OutboxOptions["onMetric"]>;

  constructor(
    private readonly db: Db,
    private readonly sink: EnsiSink,
    o: OutboxOptions = {},
  ) {
    this.batchSize = o.batchSize ?? 20;
    this.staleSendingMs = o.staleSendingMs ?? 10 * 60 * 1000;
    this.maxAttempts = o.maxAttempts ?? 10;
    this.baseDelayMs = o.baseDelayMs ?? 60_000;
    this.maxDelayMs = o.maxDelayMs ?? 24 * 60 * 60 * 1000;
    this.now = o.now ?? (() => new Date());
    this.log = o.log ?? { info: () => {}, warn: () => {}, error: () => {} };
    this.onMetric = o.onMetric ?? (() => {});
  }

  /** Зависшие sending (воркер упал посреди пачки) → failed, повтор сразу. */
  private async sweepStale() {
    const threshold = new Date(this.now().getTime() - this.staleSendingMs);
    const rows = await this.db
      .update(ensiOutbox)
      .set({
        status: "failed",
        lastError: "stale sending: воркер не завершил отправку",
        nextAttemptAt: this.now(),
      })
      .where(and(eq(ensiOutbox.status, "sending"), lte(ensiOutbox.lastAttemptAt, threshold)))
      .returning({ id: ensiOutbox.id });
    if (rows.length) {
      this.log.warn({ count: rows.length }, "ensi: возвращены зависшие sending");
      this.onMetric("ensi_stale_sending_total", rows.length);
    }
  }

  /** Захватить пачку заданий. Отдельная транзакция, чтобы не держать блокировку на время HTTP. */
  private async claim() {
    const now = this.now();
    await this.sweepStale();
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: ensiOutbox.id,
          customerId: ensiOutbox.customerId,
          revision: ensiOutbox.revision,
          attempts: ensiOutbox.attempts,
        })
        .from(ensiOutbox)
        .where(and(inArray(ensiOutbox.status, ["pending", "failed"]), lte(ensiOutbox.nextAttemptAt, now)))
        .orderBy(ensiOutbox.nextAttemptAt)
        .limit(this.batchSize)
        .for("update", { skipLocked: true });
      if (!rows.length) return rows;
      await tx
        .update(ensiOutbox)
        .set({ status: "sending", lastAttemptAt: now })
        .where(
          inArray(
            ensiOutbox.id,
            rows.map((r) => r.id),
          ),
        );
      return rows;
    });
  }

  async processBatch(): Promise<BatchResult> {
    const result: BatchResult = { claimed: 0, sent: 0, failed: 0, dead: 0, superseded: 0 };
    const rows = await this.claim();
    result.claimed = rows.length;
    if (!rows.length) return result;

    // Для каждого клиента — только последняя ревизия в пачке; остальное superseded.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = latest.get(r.customerId);
      if (!cur || cur.revision < r.revision) latest.set(r.customerId, r);
    }
    const stale = rows.filter((r) => latest.get(r.customerId)!.id !== r.id);
    if (stale.length) {
      await this.db
        .update(ensiOutbox)
        .set({ status: "superseded" })
        .where(
          inArray(
            ensiOutbox.id,
            stale.map((r) => r.id),
          ),
        );
      result.superseded = stale.length;
    }

    for (const row of latest.values()) {
      // Если у клиента уже есть более новая ревизия (создана после claim) — эту не шлём.
      const [newer] = await this.db
        .select({ id: ensiOutbox.id })
        .from(ensiOutbox)
        .where(and(eq(ensiOutbox.customerId, row.customerId), sql`${ensiOutbox.revision} > ${row.revision}`))
        .limit(1);
      if (newer) {
        await this.db.update(ensiOutbox).set({ status: "superseded" }).where(eq(ensiOutbox.id, row.id));
        result.superseded++;
        continue;
      }

      const [p] = await this.db
        .select({ payload: profiles.payload })
        .from(profiles)
        .innerJoin(ensiOutbox, eq(ensiOutbox.profileId, profiles.id))
        .where(eq(ensiOutbox.id, row.id));
      if (!p) {
        await this.db
          .update(ensiOutbox)
          .set({ status: "dead", lastError: "profile not found" })
          .where(eq(ensiOutbox.id, row.id));
        result.dead++;
        continue;
      }
      const profile = p.payload as BeautyProfile;
      const attempt = row.attempts + 1;
      const traceId = `00-${crypto.randomUUID().replace(/-/g, "")}-${row.id.replace(/-/g, "").slice(0, 16)}-01`;
      const started = Date.now();
      try {
        const r = await this.sink.upsertProfile(profile, {
          traceId,
          idempotencyKey: `${row.customerId}:${row.revision}`,
        });
        await this.db
          .update(ensiOutbox)
          .set({
            status: "sent",
            attempts: attempt,
            sentAt: this.now(),
            lastError: null,
            externalId: r.externalId ?? null,
          })
          .where(eq(ensiOutbox.id, row.id));
        result.sent++;
        this.onMetric("ensi_sent_total");
        this.log.info(
          { customerId: row.customerId, revision: row.revision, attempt, ms: Date.now() - started, traceId },
          "ensi: sent",
        );
      } catch (e) {
        const err = e instanceof EnsiError ? e : new EnsiError((e as Error).message, null, true);
        const retryable = err.retryable && attempt < this.maxAttempts;
        const dead = !err.retryable ? false : attempt >= this.maxAttempts;
        const status = dead ? "dead" : "failed";
        const next = retryable
          ? new Date(this.now().getTime() + backoffMs(attempt, this.baseDelayMs, this.maxDelayMs))
          : this.now();
        await this.db
          .update(ensiOutbox)
          .set({
            status,
            attempts: attempt,
            lastError: `${err.message}`.slice(0, 2000),
            nextAttemptAt: retryable ? next : NEVER, // не-retryable: никогда
          })
          .where(eq(ensiOutbox.id, row.id));
        if (dead) {
          result.dead++;
          this.onMetric("ensi_outbox_dead_total");
          this.log.error(
            { customerId: row.customerId, revision: row.revision, attempt, err: err.message, traceId },
            "ensi: DEAD",
          );
        } else {
          result.failed++;
          this.onMetric("ensi_failed_total");
          (retryable ? this.log.warn : this.log.error).call(
            this.log,
            {
              customerId: row.customerId,
              revision: row.revision,
              attempt,
              status: err.status,
              retryable,
              nextAttemptAt: retryable ? next.toISOString() : null,
              err: err.message,
              traceId,
            },
            retryable ? "ensi: retry later" : "ensi: permanent failure (4xx)",
          );
        }
      }
    }
    return result;
  }
}

/** Поставить в очередь последнюю ревизию профиля клиента (ручной ресинк, ТЗ 10.3.5). */
export async function enqueueLatest(db: Db, customerId: string): Promise<{ revision: number } | null> {
  const [p] = await db
    .select({ id: profiles.id, revision: profiles.revision })
    .from(profiles)
    .where(eq(profiles.customerId, customerId))
    .orderBy(sql`${profiles.revision} desc`)
    .limit(1);
  if (!p) return null;
  await db.transaction(async (tx) => {
    await tx
      .update(ensiOutbox)
      .set({ status: "superseded" })
      .where(
        and(eq(ensiOutbox.customerId, customerId), inArray(ensiOutbox.status, ["pending", "failed", "dead"])),
      );
    await tx.insert(ensiOutbox).values({
      profileId: p.id,
      customerId,
      revision: p.revision,
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
    });
  });
  return { revision: p.revision };
}
