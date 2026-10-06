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

/**
 * GET /survey?gender=female|male — конфиг, отфильтрованный под пол (ТЗ 9.2).
 * Без пола — только вопрос gender и метаданные. Кэшируется по ETag.
 */
export async function surveyRoutes(app: FastifyInstance, opts: { survey: Survey; config: Config }) {
  const { survey, config } = opts;

  const build = (gender: GenderCode | null) => {
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

  const cache = new Map<string, { body: string; etag: string }>();
  const get = (gender: GenderCode | null) => {
    const k = gender ?? "none";
    let c = cache.get(k);
    if (!c) {
      const body = JSON.stringify({ data: build(gender) });
      c = { body, etag: `"${createHash("sha1").update(body).digest("hex")}"` };
      cache.set(k, c);
    }
    return c;
  };

  app.get(
    "/survey",
    {
      schema: {
        tags: ["survey"],
        summary: "Конфиг опросника, отфильтрованный под пол",
        querystring: z.object({ gender: z.enum(["female", "male"]).optional() }),
      },
    },
    async (req, reply) => {
      const { gender } = req.query as { gender?: GenderCode };
      const c = get(gender ?? null);
      if (req.headers["if-none-match"] === c.etag) return reply.code(304).send();
      reply.header("ETag", c.etag).header("Cache-Control", "public, max-age=300").type("application/json");
      return reply.send(c.body);
    },
  );
}
