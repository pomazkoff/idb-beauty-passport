import { createDb, runMigrations } from "@idb/db";
import { survey } from "@idb/survey-config";
import { buildApp, registerSurveyVersion } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
if (process.env.AUTO_MIGRATE === "true") await runMigrations(config.DATABASE_URL);

const { db, close } = createDb(config.DATABASE_URL);
await registerSurveyVersion(db, survey);
const app = await buildApp({ config, db, survey });

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

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`survey ${survey.version} · auth=${config.AUTH_MODE} · swagger=${config.SWAGGER_ENABLED}`);
