/** Воркер доставки профилей в ENSI (ТЗ 10.3). Один или несколько инстансов — безопасно (SKIP LOCKED). */
import { createDb, loadDotenv } from "@idb/db";
import { createSinkFromEnv } from "@idb/ensi-client";
import pino from "pino";
import { OutboxProcessor } from "./outbox.js";

loadDotenv();

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
});
const pollMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000);
const { db, close } = createDb(process.env.DATABASE_URL, { max: 4 });
const sink = createSinkFromEnv();
const processor = new OutboxProcessor(db, sink, {
  batchSize: Number(process.env.OUTBOX_BATCH_SIZE ?? 20),
  maxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 10),
  log,
});

log.info({ sink: sink.name, pollMs }, "worker started");
let stopping = false;
let current: Promise<unknown> = Promise.resolve();

const stop = async () => {
  if (stopping) return;
  stopping = true;
  log.info("worker stopping: ждём текущую пачку");
  await current.catch(() => {});
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

while (!stopping) {
  try {
    const batch = processor.processBatch();
    current = batch;
    const r = await batch;
    if (r.claimed) log.info(r, "batch");
    // пачка была полной — не ждём, сразу следующую
    if (r.claimed >= Number(process.env.OUTBOX_BATCH_SIZE ?? 20)) continue;
  } catch (e) {
    log.error({ err: (e as Error).message }, "batch failed");
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
