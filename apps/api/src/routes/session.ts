// Примечание: двойное двоеточие в путях — экранирование литерального «:» для роутера Fastify (find-my-way); публичный URL — с одним «:».
import type { CategoryCode } from "@idb/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import type { SessionService } from "../services/session.service.js";
import { isAdmin } from "./admin.js";

const Category = z.enum(["face", "body", "hair", "sun", "makeup", "perfume", "home"]);
const AnswerBody = z.object({
  optionCodes: z.array(z.string().min(1).max(64)).max(32),
  skipped: z.boolean().default(false),
  timeMs: z.number().int().nonnegative().max(86_400_000).optional(),
});

export async function sessionRoutes(app: FastifyInstance, opts: { service: SessionService; config: Config }) {
  const { service, config } = opts;
  const auth = { preHandler: app.authenticate };
  const perUser = { rateLimit: { max: config.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } };

  // version — предпросмотр черновика из конструктора (нужен X-Admin-Token); иначе — опубликованная версия.
  const previewVersion = (req: FastifyRequest): string | undefined => {
    const v = (req.query as { version?: string }).version;
    if (!v) return undefined;
    if (!isAdmin(req, config))
      throw new AppError("FORBIDDEN", "Предпросмотр версии доступен только с X-Admin-Token");
    return v;
  };
  const VersionQuery = z.object({ version: z.string().optional() });

  app.get(
    "/me/session",
    {
      ...auth,
      schema: {
        tags: ["session"],
        summary: "Текущая сессия (создаётся при отсутствии)",
        querystring: VersionQuery,
      },
    },
    async (req) => ({ data: await service.getOrCreate(req.customerId, previewVersion(req)) }),
  );

  app.put(
    "/me/session/answers/:questionKey",
    {
      ...auth,
      config: perUser,
      schema: {
        tags: ["session"],
        summary: "Сохранить ответ на вопрос",
        params: z.object({ questionKey: z.string().regex(/^[a-z][a-z0-9_]*$/) }),
        body: AnswerBody,
      },
    },
    async (req) => {
      const { questionKey } = req.params as { questionKey: string };
      const body = req.body as z.infer<typeof AnswerBody>;
      await service.getOrCreate(req.customerId);
      const view = await service.answer(req.customerId, questionKey, body);
      const { genderReset, ...data } = view;
      return { data, meta: { genderReset } };
    },
  );

  app.post(
    "/me/session/base::complete",
    { ...auth, schema: { tags: ["session"], summary: "Завершить этап 1" } },
    async (req) => ({
      data: await service.completeBase(req.customerId),
    }),
  );

  app.post(
    "/me/session/passport::start",
    {
      ...auth,
      schema: {
        tags: ["session"],
        summary: "Начать категорию Паспорта",
        body: z.object({ category: Category }),
      },
    },
    async (req) => ({
      data: await service.startPassport(req.customerId, (req.body as { category: CategoryCode }).category),
    }),
  );

  app.post(
    "/me/session/passport::complete",
    {
      ...auth,
      schema: {
        tags: ["session"],
        summary: "Завершить категорию Паспорта",
        body: z.object({ category: Category }),
      },
    },
    async (req) => ({
      data: await service.completePassport(req.customerId, (req.body as { category: CategoryCode }).category),
    }),
  );

  app.post(
    "/me/session::reset",
    { ...auth, schema: { tags: ["session"], summary: "Пройти заново", querystring: VersionQuery } },
    async (req) => ({ data: await service.reset(req.customerId, previewVersion(req)) }),
  );

  app.get(
    "/me/profile",
    { ...auth, schema: { tags: ["profile"], summary: "Последний профиль и статус синка в ENSI" } },
    async (req) => ({
      data: await service.latestProfile(req.customerId),
    }),
  );
}
