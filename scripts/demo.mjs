#!/usr/bin/env node
/**
 * Демо-режим без Docker и PostgreSQL: встроенная база (PGlite) в ./.pgdata,
 * воркер доставки в ENSI внутри API, профили «уходят» в ./.ensi-out.
 *
 *   pnpm demo            → миграции, демо-данные, api :3000, опросник :5173, конструктор :5174
 *   pnpm demo --reset    → стереть базу и начать заново
 *
 * Все переменные можно переопределить через окружение; токены ниже — демонстрационные.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, ".pgdata");
if (process.argv.includes("--reset") && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log("✓ .pgdata удалён");
}

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  DATABASE_URL: process.env.DATABASE_URL ?? `pglite:${dataDir}`,
  AUTH_MODE: "dev",
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "dev-admin-token-change-me",
  INTEGRATION_API_KEY: process.env.INTEGRATION_API_KEY ?? "dev-integration-key-change-me",
  CORS_ORIGINS: "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174",
  SWAGGER_ENABLED: "true",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  ENSI_SINK: process.env.ENSI_SINK ?? "file",
  ENSI_FILE_DIR: process.env.ENSI_FILE_DIR ?? resolve(root, ".ensi-out"),
  VITE_API_BASE: "http://localhost:3000",
  VITE_WEB_BASE: "http://localhost:5173",
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
};

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const run = (args, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(pnpm, args, { cwd: root, env, stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${args.join(" ")} → exit ${code}`))));
  });

console.log("▸ сборка пакетов");
await run(["--filter", "./packages/*", "build"]);
console.log("▸ миграции (PGlite, ./.pgdata)");
await run(["--filter", "@idb/db", "db:migrate"]);
if (!existsSync(resolve(dataDir, ".seeded")) || process.argv.includes("--reset")) {
  console.log("▸ демо-пользователи demo-e / demo-p / demo-m");
  await run(["--filter", "@idb/api", "seed"]);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(resolve(dataDir, ".seeded"), new Date().toISOString());
}

console.log(`
  ▸ запускаем
    опросник      http://localhost:5173/?customer=demo
    конструктор   http://localhost:5174          токен: ${env.ADMIN_TOKEN}
    API / Swagger http://localhost:3000/docs
    ENSI-API      curl -H "X-Api-Key: ${env.INTEGRATION_API_KEY}" http://localhost:3000/api/v1/integration/surveys/current
    профили «в ENSI» → ${env.ENSI_FILE_DIR}
  Остановить: Ctrl+C
`);

const procs = [
  spawn(pnpm, ["--filter", "@idb/api", "dev"], { cwd: root, env, stdio: "inherit" }),
  spawn(pnpm, ["--filter", "@idb/web", "dev"], { cwd: root, env, stdio: "inherit" }),
  spawn(pnpm, ["--filter", "@idb/admin", "dev"], { cwd: root, env, stdio: "inherit" }),
];
const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs)
  p.on("exit", (code) => code && code !== 0 && console.error(`процесс завершился с кодом ${code}`));
