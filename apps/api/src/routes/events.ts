import { type Db, analyticsEvents, sessions } from "@idb/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";

/** Имена событий — ровно из таблицы tz.md «События для аналитики» (ТЗ 11). */
export const EVENT_NAMES = [
  "quiz_started",
  "quiz_question_shown",
  "quiz_question_answered",
  "quiz_question_skipped",
  "quiz_back",
  "quiz_base_completed",
  "passport_announce_shown",
  "passport_started",
  "passport_postponed",
  "passport_category_completed",
  "passport_category_added",
] as const;

const Event = z.object({
  name: z.enum(EVENT_NAMES),
  params: z.record(z.unknown()).default({}),
  ts: z.string().datetime().optional(),
});
const Body = z.object({ events: z.array(Event).min(1).max(100) });

export async function eventsRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  app.post(
    "/events",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: opts.config.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } },
      schema: {
        tags: ["analytics"],
        security: [{ bearer: [] }],
        summary: "Пакет событий аналитики. Авторизация — только JWT пользователя.",
        body: Body,
      },
    },
    async (req, reply) => {
      const { events } = req.body as z.infer<typeof Body>;
      const session = await opts.db.query.sessions.findFirst({
        columns: { id: true },
        where: and(eq(sessions.customerId, req.customerId), eq(sessions.status, "active")),
      });
      await opts.db.insert(analyticsEvents).values(
        events.map((e) => ({
          customerId: req.customerId,
          sessionId: session?.id ?? null,
          name: e.name,
          params: e.params,
          clientTs: e.ts ? new Date(e.ts) : null,
        })),
      );
      return reply.code(202).send({ data: { accepted: events.length } });
    },
  );
}
