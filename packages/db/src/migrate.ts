/** Применяет SQL-миграции из ./drizzle к DATABASE_URL (PostgreSQL или PGlite). Идемпотентно. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { type DbHandle, createDb } from "./client.js";
import { loadDotenv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../drizzle");

/** Миграции на уже открытом подключении (нужно для PGlite в памяти — там база живёт в одном инстансе). */
export async function migrateHandle(handle: DbHandle): Promise<void> {
  // Мигратор типизирован под конкретный драйвер, у нас общий тип Db — сужаем через unknown.
  if (handle.kind === "pglite")
    await migratePglite(handle.db as unknown as Parameters<typeof migratePglite>[0], { migrationsFolder });
  else await migratePg(handle.db as unknown as Parameters<typeof migratePg>[0], { migrationsFolder });
}

export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    await migrateHandle(handle);
  } finally {
    await handle.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadDotenv();
  runMigrations()
    .then(() => {
      console.log("✓ миграции применены");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
