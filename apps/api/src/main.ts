import { createDb, isPglite, loadDotenv, migrateHandle } from "@idb/db";
import { createSinkFromEnv } from "@idb/ensi-client";
import { OutboxProcessor } from "@idb/outbox";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

loadDotenv();

const config = loadConfig();
const handle = createDb(config.DATABASE_URL);
const { db, close } = handle;
// Миграции на том же подключении: для pglite:memory база живёт только внутри этого процесса.
if (process.env.AUTO_MIGRATE === "true") await migrateHandle(handle);
const app = await buildApp({ config, db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "останавливаемся");
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Ретеншн: раз в сутки чистим архив (ТЗ 9.3).
setInterval(
  () =>
    void app.sessionService.purgeOld(config.RETENTION_DAYS).catch((e) => app.log.error(e, "purge failed")),
  24 * 60 * 60 * 1000,
).unref();

// PGlite — один процесс на каталог данных, поэтому воркер доставки в ENSI работает внутри API.
if (isPglite(config.DATABASE_URL)) {
  const processor = new OutboxProcessor(db, createSinkFromEnv(), { log: app.log });
  const tick = async () => {
    try {
      const r = await processor.processBatch();
      if (r.claimed) app.log.info(r, "outbox batch (in-process)");
    } catch (e) {
      app.log.error({ err: (e as Error).message }, "outbox batch failed");
    }
  };
  setInterval(() => void tick(), Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000)).unref();
  app.log.info("DATABASE_URL=pglite: воркер доставки запущен внутри API");
}

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(
  `survey ${app.surveyRegistry.current().version} · auth=${config.AUTH_MODE} · swagger=${config.SWAGGER_ENABLED} · admin=${Boolean(config.ADMIN_TOKEN)}`,
);
