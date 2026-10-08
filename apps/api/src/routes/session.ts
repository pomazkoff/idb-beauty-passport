// Примечание: двойное двоеточие в путях — экранирование литерального «:» для роутера Fastify (find-my-way); публичный URL — с одним «:».
import type { CategoryCode } from "@idb/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import type { SessionService } from "../services/session.service.js";
import { isAdmin } from "./admin.js";

const Category = z.enum(["face", "body", "hair", "sun", "makeup", "perfume", "home"]);
const AnswerBody = z
  .object({
    optionCodes: z.array(z.string().min(1).max(64)).max(32),
    skipped: z.boolean().default(false),
    timeMs: z.number().int().nonnegative().max(86_400_000).optional(),
  })
  .describe("Ответ на один вопрос: коды выбранных вариантов");

/** Ответ, уже лежащий в сессии. Не пустой объект: у каждого question_key такая форма. */
const StoredAnswer = z.object({
  optionCodes: z
    .array(z.string())
    .describe("Коды выбранных вариантов. Пустой массив только вместе с skipped=true"),
  skipped: z.boolean(),
  timeMs: z.number().int().optional().describe("Сколько миллисекунд вопрос был на экране"),
  answeredAt: z.string().describe("ISO-8601, момент сохранения на сервере"),
});

const SessionData = z.object({
  sessionId: z.string().uuid(),
  surveyVersion: z.string(),
  stage: z.enum(["intro", "base", "result1", "passport", "result2"]),
  activeCategory: Category.nullable(),
  answers: z
    .record(z.string(), StoredAnswer)
    .describe("Ключ — question_key. Значение — StoredAnswer, не пустая схема"),
  derived: z.object({
    gender: z.enum(["female", "male"]).nullable(),
    baseComplete: z.boolean(),
    psychotype: z.enum(["E", "P", "L", "M"]),
    votes: z.object({ E: z.number(), P: z.number(), L: z.number(), M: z.number() }),
    primaryCategory: Category.nullable(),
    completedCategories: z.array(Category),
    completenessPct: z.number(),
    widgets: z.object({
      priority: z.array(z.string()),
      base: z.array(z.string()),
    }),
  }),
});

const ProfileAnswer = z.object({
  stage: z.enum(["base", "passport"]),
  category: Category.optional(),
  question_key: z.string(),
  option_codes: z.array(z.string()),
  skipped: z.boolean(),
  answered_at: z.string().optional(),
});

const BeautyProfile = z.object({
  schema_version: z.literal("1.0"),
  customer_id: z.string(),
  profile_revision: z.number().int(),
  survey_version: z.string(),
  updated_at: z.string(),
  gender: z.enum(["female", "male"]),
  psychotype: z.object({
    code: z.enum(["E", "P", "L", "M"]),
    name: z.string(),
    votes: z.object({ E: z.number(), P: z.number(), L: z.number(), M: z.number() }),
  }),
  primary_category: Category.nullable(),
  completed_categories: z.array(Category),
  completeness_pct: z.number(),
  widgets: z.object({ priority: z.array(z.string()), base: z.array(z.string()) }),
  answers: z.array(ProfileAnswer),
  traits: z.record(z.string(), z.array(z.string())),
  tags: z.array(z.string()),
});

const userJwt = [{ bearer: [] }];

const EnsiStatus = z.object({
  status: z
    .enum(["none", "pending", "sending", "sent", "failed", "superseded", "dead"])
    .describe("Статус доставки профиля красоты в ENSI, не доставки контента опросника пользователю"),
  revision: z.number().int().nullable(),
  lastAttemptAt: z.string().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
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
        security: userJwt,
        summary:
          "Текущая сессия пользователя. Создаётся, если активной нет. Авторизация — только JWT пользователя (Bearer). Query version — предпросмотр черновика конструктора и требует X-Admin-Token; фронт ЛК его не передаёт.",
        querystring: VersionQuery,
        response: { 200: z.object({ data: SessionData }) },
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
        security: userJwt,
        summary: "Сохранить ответ на вопрос. Тело — optionCodes, skipped, timeMs.",
        params: z.object({ questionKey: z.string().regex(/^[a-z][a-z0-9_]*$/) }),
        body: AnswerBody,
        response: { 200: z.object({ data: SessionData, meta: z.object({ genderReset: z.boolean() }) }) },
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
    {
      ...auth,
      schema: {
        tags: ["session"],
        security: userJwt,
        summary: "Завершить базу. Обновляет единственный профиль клиента и ставит доставку в ENSI.",
        response: { 200: z.object({ data: BeautyProfile }) },
      },
    },
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
        security: userJwt,
        summary: "Начать категорию Паспорта. Авторизация — только JWT пользователя.",
        body: z.object({ category: Category }),
        response: { 200: z.object({ data: SessionData }) },
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
        security: userJwt,
        summary:
          "Завершить категорию Паспорта. Обновляет единственный профиль клиента и ставит доставку в ENSI.",
        body: z.object({ category: Category }),
        response: { 200: z.object({ data: BeautyProfile }) },
      },
    },
    async (req) => ({
      data: await service.completePassport(req.customerId, (req.body as { category: CategoryCode }).category),
    }),
  );

  app.post(
    "/me/session::reset",
    {
      ...auth,
      schema: {
        tags: ["session"],
        security: userJwt,
        summary:
          "Пройти заново. Архивирует сессию и открывает пустую. Профиль не удаляет и в ENSI не отправляет. Query version — предпросмотр конструктора, нужен X-Admin-Token.",
        querystring: VersionQuery,
        response: { 200: z.object({ data: SessionData }) },
      },
    },
    async (req) => ({ data: await service.reset(req.customerId, previewVersion(req)) }),
  );

  app.get(
    "/me/profile",
    {
      ...auth,
      schema: {
        tags: ["profile"],
        security: userJwt,
        summary:
          "Последний профиль клиента и статус его доставки в ENSI (data.ensi.status). Авторизация — только JWT пользователя. Профиля может не быть: profile = null, HTTP 200.",
        response: {
          200: z.object({
            data: z.object({ profile: BeautyProfile.nullable(), ensi: EnsiStatus }),
          }),
        },
      },
    },
    async (req) => ({
      data: await service.latestProfile(req.customerId),
    }),
  );
}
