import { defineConfig, devices } from "@playwright/test";

/**
 * E2E (ТЗ 13.5). Поднимает API (dev-режим, X-Customer-Id) и Vite; нужен PostgreSQL из DATABASE_URL.
 * PW_CHROMIUM_PATH — путь к локальному Chromium, если браузеры Playwright не установлены.
 */
const exe = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1, // первый прогон после холодного старта vite/tsx иногда упирается в таймаут
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    ...(exe ? { launchOptions: { executablePath: exe } } : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 420, height: 860 } } },
  ],
  webServer: [
    {
      command: "pnpm --filter @idb/api dev",
      url: "http://localhost:3000/api/v1/health",
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NODE_ENV: "development",
        AUTH_MODE: "dev",
        CORS_ORIGINS: "http://localhost:5173",
        SWAGGER_ENABLED: "false",
        LOG_LEVEL: "warn",
        AUTO_MIGRATE: "true",
        DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://idb:idb@localhost:5432/beauty_passport",
      },
    },
    {
      command: "pnpm --filter @idb/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_API_BASE: "http://localhost:3000" },
    },
  ],
});
