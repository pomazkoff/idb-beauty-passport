import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Единый тип клиента для обоих драйверов (PostgreSQL и встроенный PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type DbHandle = { db: Db; close: () => Promise<void>; kind: "postgres" | "pglite" };

/**
 * `postgresql://…` — обычный PostgreSQL; `pglite:<каталог>` (или `pglite:memory`) — встроенный Postgres
 * (PGlite) без установки: один процесс, данные в каталоге. Для демо и локальной разработки без Docker.
 */
export function isPglite(url = process.env.DATABASE_URL ?? ""): boolean {
  return url.startsWith("pglite:");
}

export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}): DbHandle {
  if (!url) throw new Error("DATABASE_URL не задан");
  if (isPglite(url)) {
    const target = url.slice("pglite:".length);
    const client = target === "memory" || target === "" ? new PGlite() : new PGlite(target);
    const db = drizzlePglite(client, { schema, casing: "snake_case" }) as unknown as Db;
    return { db, close: () => client.close(), kind: "pglite" };
  }
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzlePg(sql, { schema, casing: "snake_case" }) as unknown as Db;
  return { db, close: () => sql.end({ timeout: 5 }), kind: "postgres" };
}

/**
 * Результат db.execute() у драйверов разный: postgres-js отдаёт массив строк с .count,
 * PGlite — { rows, affectedRows }. Эти две функции скрывают разницу.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r?.rows ?? [];
}

export function affectedOf(result: unknown): number {
  const r = result as { count?: number; affectedRows?: number };
  return Number(r?.affectedRows ?? r?.count ?? 0);
}
