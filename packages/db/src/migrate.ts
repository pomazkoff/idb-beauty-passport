/** Применяет SQL-миграции из ./drizzle к DATABASE_URL. Идемпотентно. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../drizzle");

export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
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
