import type { Db } from "@idb/db";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(
  app: FastifyInstance,
  opts: { db: Db; registry: { current(): { version: string } } },
) {
  app.get("/health", { schema: { tags: ["ops"], security: [], summary: "Liveness" } }, async () => ({
    data: { status: "ok", surveyVersion: opts.registry.current().version },
  }));
  app.get(
    "/ready",
    { schema: { tags: ["ops"], security: [], summary: "Readiness (проверка БД)" } },
    async (_req, reply) => {
      try {
        await opts.db.execute(sql`select 1`);
        return { data: { status: "ready" } };
      } catch (e) {
        return reply
          .code(503)
          .send({ errors: [{ code: "INTERNAL", message: `БД недоступна: ${(e as Error).message}` }] });
      }
    },
  );
}
