import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Создаёт подключение и типизированный клиент. Один экземпляр на процесс. */
export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}) {
  if (!url) throw new Error("DATABASE_URL не задан");
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
