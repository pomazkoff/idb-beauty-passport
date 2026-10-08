/**
 * Сервисный API для ENSI и других систем (этап 10). Авторизация: X-Api-Key = INTEGRATION_API_KEY.
 * Отдаёт опросник целиком (оба пола, с правилами голосов, виджетами и текстами) и профили клиентов.
 * Конверт — { data, meta, errors } как в ENSI. Черновики недоступны — только published/archived.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import type { SessionService } from "../services/session.service.js";
import type { SurveyRegistry } from "../services/survey-registry.js";

export function requireApiKey(config: Config) {
  return async (req: FastifyRequest) => {
    if (!config.INTEGRATION_API_KEY)
      throw new AppError("FORBIDDEN", "Интеграционный API выключен: не задан INTEGRATION_API_KEY");
    const given = req.headers["x-api-key"];
    if (typeof given !== "string") throw new AppError("UNAUTHORIZED", "Нужен заголовок X-Api-Key");
    const a = Buffer.from(given);
    const b = Buffer.from(config.INTEGRATION_API_KEY);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new AppError("UNAUTHORIZED", "Неверный X-Api-Key");
  };
}

export async function integrationRoutes(
  app: FastifyInstance,
  opts: { registry: SurveyRegistry; service: SessionService; config: Config },
) {
  const { registry, service, config } = opts;
  const guard = {
    preHandler: requireApiKey(config),
    config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
  };
  const tags = ["integration"];
  const security = [{ "X-Api-Key": [] }];

  app.get(
    "/integration/surveys",
    { ...guard, schema: { tags, security, summary: "Версии опросника (без черновиков)" } },
    async () => {
      const all = await registry.list();
      return { data: all.filter((v) => v.status !== "draft").map(({ issues: _i, ...v }) => v) };
    },
  );

  app.get(
    "/integration/surveys/current",
    {
      ...guard,
      schema: { tags, security, summary: "Опубликованный опросник целиком (оба пола, правила, виджеты, тексты)" },
    },
    async (req, reply) => {
      const survey = registry.current();
      const row = await registry.getRow(survey.version);
      const etag = `"${row.checksum}"`;
      if (req.headers["if-none-match"] === etag) return reply.code(304).send();
      reply.header("ETag", etag).header("Cache-Control", "no-cache");
      return {
        data: survey,
        meta: {
          version: survey.version,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          checksum: row.checksum,
        },
      };
    },
  );

  app.get(
    "/integration/surveys/:version",
    {
      ...guard,
      schema: {
        tags,
        security,
        summary: "Опросник указанной версии (published или archived)",
        params: z.object({ version: z.string() }),
      },
    },
    async (req) => {
      const { version } = req.params as { version: string };
      const row = await registry.getRow(version);
      if (row.status === "draft") throw new AppError("NOT_FOUND", `Версия ${version} не опубликована`);
      return {
        data: await registry.get(version),
        meta: {
          version,
          status: row.status,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          checksum: row.checksum,
        },
      };
    },
  );

  app.get(
    "/integration/customers/:customerId/profile",
    {
      ...guard,
      schema: {
        tags,
        security,
        summary:
          "Последний профиль клиента (BeautyProfile) и статус доставки этого профиля в ENSI (meta.ensi.status)",
        params: z.object({ customerId: z.string().min(1).max(256) }),
      },
    },
    async (req) => {
      const { customerId } = req.params as { customerId: string };
      const r = await service.latestProfile(customerId);
      if (!r.profile) throw new AppError("NOT_FOUND", "У клиента нет профиля");
      return { data: r.profile, meta: { ensi: r.ensi } };
    },
  );
}
