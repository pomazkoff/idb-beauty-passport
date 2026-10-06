import { createHash } from "node:crypto";
import { getBaseQuestions } from "@idb/core";
import {
  type GenderCode,
  type Survey,
  branchesForGender,
  questionOptions,
  questionText,
} from "@idb/survey-config";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import type { SurveyRegistry } from "../services/survey-registry.js";
import { isAdmin } from "./admin.js";

/**
 * GET /survey?gender=female|male — конфиг, отфильтрованный под пол (ТЗ 9.2).
 * Без пола — только вопрос gender и метаданные. Кэшируется по ETag.
 */
export async function surveyRoutes(app: FastifyInstance, opts: { registry: SurveyRegistry; config: Config }) {
  const { registry, config } = opts;

  const build = (survey: Survey, gender: GenderCode | null) => {
    const base = getBaseQuestions(survey, gender);
    const branches = gender
      ? branchesForGender(survey, gender).map((b) => ({
          id: b.id,
          category: b.category,
          name: b.name,
          draft: Boolean(b.draft) && config.SHOW_DRAFT_BADGE,
          questions: b.questions.map((q) => ({
            key: q.key,
            block: q.block,
            topic: q.topic,
            type: q.type,
            skippable: q.skippable,
            draft: Boolean(q.draft) && config.SHOW_DRAFT_BADGE,
            text: questionText(q, gender),
            options: questionOptions(q, gender)
              .filter((o) => !o.deprecated)
              .map((o) => ({
                code: o.code,
                title: o.title,
                subtitle: config.SHOW_TRAIT_SUBTITLE ? o.subtitle : o.tags?.length ? undefined : o.subtitle,
                exclusive: o.exclusive,
                categoryCode: o.categoryCode,
              })),
          })),
        }))
      : [];
    return {
      version: survey.version,
      locale: survey.locale,
      gender,
      genders: survey.genders,
      categories: survey.categories,
      base: base.map((q) => ({ ...q, draft: q.draft && config.SHOW_DRAFT_BADGE })),
      branches,
      psychotypes: survey.psychotypes,
      widgets: survey.widgets,
      completeness: survey.completeness,
      screens: survey.screens,
      ui: survey.ui,
      flags: { showDraftBadge: config.SHOW_DRAFT_BADGE, countSkippedCategory: config.COUNT_SKIPPED_CATEGORY },
    };
  };

  // Кэш по (версия, пол). Черновики не кэшируются — они меняются.
  const cache = new Map<string, { body: string; etag: string }>();
  const get = (survey: Survey, gender: GenderCode | null, cacheable: boolean) => {
    const k = `${survey.version}|${gender ?? "none"}`;
    let c = cacheable ? cache.get(k) : undefined;
    if (!c) {
      const body = JSON.stringify({ data: build(survey, gender) });
      c = { body, etag: `"${createHash("sha1").update(body).digest("hex")}"` };
      if (cacheable) cache.set(k, c);
    }
    return c;
  };

  app.get(
    "/survey",
    {
      schema: {
        tags: ["survey"],
        summary:
          "Конфиг опросника, отфильтрованный под пол (version — предпросмотр, черновики только с X-Admin-Token)",
        querystring: z.object({
          gender: z.enum(["female", "male"]).optional(),
          version: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { gender, version } = req.query as { gender?: GenderCode; version?: string };
      let survey = registry.current();
      let cacheable = true;
      if (version && version !== survey.version) {
        const row = await registry.getRow(version);
        if (row.status === "draft") {
          if (!isAdmin(req, config))
            throw new AppError("FORBIDDEN", "Черновик доступен только с X-Admin-Token");
          cacheable = false;
        }
        survey = await registry.get(version);
      }
      const c = get(survey, gender ?? null, cacheable);
      if (req.headers["if-none-match"] === c.etag) return reply.code(304).send();
      reply
        .header("ETag", c.etag)
        .header("Cache-Control", cacheable ? "public, max-age=300" : "no-store")
        .type("application/json");
      return reply.send(c.body);
    },
  );
}
