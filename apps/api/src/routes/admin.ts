/**
 * Админ-API конструктора (этап 8–9). Авторизация: заголовок X-Admin-Token = ADMIN_TOKEN (env).
 * Пути: /api/v1/admin/surveys[...]; действия — под-ресурсы (/validate, /publish), т. к. «:action» после параметра
 * конфликтует в роутере.
 */
import { timingSafeEqual } from "node:crypto";
import { Survey as SurveySchema, renderContentMap } from "@idb/survey-config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import type { SurveyRegistry } from "../services/survey-registry.js";

export function isAdmin(req: FastifyRequest, config: Config): boolean {
  const token = config.ADMIN_TOKEN;
  const given = req.headers["x-admin-token"];
  if (!token || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAdmin(config: Config) {
  return async (req: FastifyRequest) => {
    if (!config.ADMIN_TOKEN) throw new AppError("FORBIDDEN", "Конструктор выключен: не задан ADMIN_TOKEN");
    if (!isAdmin(req, config)) throw new AppError("UNAUTHORIZED", "Неверный X-Admin-Token");
  };
}

const Version = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });

export async function adminRoutes(app: FastifyInstance, opts: { registry: SurveyRegistry; config: Config }) {
  const { registry, config } = opts;
  const guard = { preHandler: requireAdmin(config) };
  const tags = ["admin"];
  const security = [{ "X-Admin-Token": [] }];

  app.get("/admin/me", { ...guard, schema: { tags, security, summary: "Проверка токена" } }, async () => ({
    data: { ok: true },
  }));

  app.get("/admin/surveys", { ...guard, schema: { tags, security, summary: "Список версий" } }, async () => ({
    data: await registry.list(),
  }));

  app.post(
    "/admin/surveys",
    {
      ...guard,
      schema: {
        tags,
        security,
        summary: "Создать черновик (копия опубликованной или указанной версии)",
        body: z.object({
          version: z.string().regex(/^\d+\.\d+\.\d+$/),
          fromVersion: z.string().optional(),
          notes: z.string().max(2000).optional(),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as { version: string; fromVersion?: string; notes?: string };
      return reply.code(201).send({ data: await registry.createDraft(body) });
    },
  );

  app.get(
    "/admin/surveys/:version",
    { ...guard, schema: { tags, security, summary: "Версия целиком", params: Version } },
    async (req) => {
      const { version } = req.params as { version: string };
      const row = await registry.getRow(version);
      return {
        data: {
          version: row.version,
          status: row.status,
          notes: row.notes,
          sourceVersion: row.sourceVersion,
          updatedAt: row.updatedAt.toISOString(),
          publishedAt: row.publishedAt?.toISOString() ?? null,
          config: row.config,
        },
        meta: { report: await registry.validate(version, row.config) },
      };
    },
  );

  app.put(
    "/admin/surveys/:version",
    {
      ...guard,
      schema: {
        tags,
        security,
        summary: "Сохранить черновик",
        params: Version,
        body: z.object({ config: z.unknown() }),
      },
    },
    async (req) => {
      const { version } = req.params as { version: string };
      const { config: cfg } = req.body as { config: unknown };
      const r = await registry.saveDraft(version, cfg);
      return { data: r.summary, meta: { report: r.report } };
    },
  );

  app.post(
    "/admin/surveys/:version/validate",
    { ...guard, schema: { tags, security, summary: "Проверить версию", params: Version } },
    async (req) => {
      const { version } = req.params as { version: string };
      return { data: await registry.validate(version) };
    },
  );

  app.post(
    "/admin/surveys/:version/publish",
    { ...guard, schema: { tags, security, summary: "Опубликовать (предыдущая — в архив)", params: Version } },
    async (req) => {
      const { version } = req.params as { version: string };
      return { data: await registry.publish(version) };
    },
  );

  app.delete(
    "/admin/surveys/:version",
    { ...guard, schema: { tags, security, summary: "Удалить черновик", params: Version } },
    async (req, reply) => {
      const { version } = req.params as { version: string };
      await registry.deleteDraft(version);
      return reply.code(204).send();
    },
  );

  app.get(
    "/admin/surveys/:version/content-map",
    { ...guard, schema: { tags, security, summary: "Карта контента (markdown)", params: Version } },
    async (req, reply) => {
      const { version } = req.params as { version: string };
      const row = await registry.getRow(version);
      const parsed = SurveySchema.safeParse(row.config);
      if (!parsed.success)
        throw new AppError("VALIDATION_ERROR", "Версия структурно невалидна — карту собрать нельзя");
      return reply.type("text/markdown; charset=utf-8").send(renderContentMap(parsed.data));
    },
  );
}
