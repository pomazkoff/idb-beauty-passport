/**
 * Ручной ресинк профилей в ENSI (ТЗ 10.3.5).
 *   pnpm ensi:resync -- --customer <id>
 *   pnpm ensi:resync -- --all [--since 2026-10-01]
 *   pnpm ensi:resync -- --dead        # перепоставить все dead
 * Ставит в очередь последнюю ревизию; воркер отправит.
 */
import { createDb, ensiOutbox, profiles } from "@idb/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { enqueueLatest } from "../outbox.js";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? (args[i + 1] ?? true) : undefined;
};

const { db, close } = createDb(process.env.DATABASE_URL, { max: 2 });
try {
  const customer = flag("--customer");
  if (typeof customer === "string") {
    const r = await enqueueLatest(db, customer);
    console.log(
      r ? `✓ ${customer}: ревизия ${r.revision} поставлена в очередь` : `✗ ${customer}: профиля нет`,
    );
  } else if (flag("--dead")) {
    const rows = await db
      .selectDistinct({ customerId: ensiOutbox.customerId })
      .from(ensiOutbox)
      .where(eq(ensiOutbox.status, "dead"));
    for (const r of rows) await enqueueLatest(db, r.customerId);
    console.log(`✓ перепоставлено клиентов: ${rows.length}`);
  } else if (flag("--all")) {
    const since = flag("--since");
    const where = typeof since === "string" ? and(gte(profiles.createdAt, new Date(since))) : undefined;
    const rows = await db.selectDistinct({ customerId: profiles.customerId }).from(profiles).where(where);
    for (const r of rows) await enqueueLatest(db, r.customerId);
    console.log(`✓ поставлено в очередь клиентов: ${rows.length}`);
  } else {
    const stats = await db
      .select({ status: ensiOutbox.status, n: sql<number>`count(*)` })
      .from(ensiOutbox)
      .groupBy(ensiOutbox.status);
    console.log("Использование: --customer <id> | --all [--since <date>] | --dead");
    console.log("Очередь:", stats.map((s) => `${s.status}=${s.n}`).join(" ") || "пусто");
  }
} finally {
  await close();
}
