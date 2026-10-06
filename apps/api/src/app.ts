import { createHash, randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { type Db, surveyVersions } from "@idb/db";
import { type Survey, survey as defaultSurvey, validateSurvey } from "@idb/survey-config";
import Fastify, { type FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { Metrics, metricsRoutes } from "./metrics.js";
import { type Authenticator, authPlugin, devAuthenticator, jwtAuthenticator } from "./plugins/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { eventsRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { sessionRoutes } from "./routes/session.js";
import { surveyRoutes } from "./routes/survey.js";
import { SessionService } from "./services/session.service.js";
import { SurveyRegistry } from "./services/survey-registry.js";

export type BuildOptions = {
  config: Config;
  db: Db;
  authenticate?: Authenticator;
  logger?: boolean | object;
};

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config, db } = opts;
  const registry = new SurveyRegistry(db);
  const survey = await registry.init();
  const app = Fastify({
    logger: opts.logger ?? {
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers['x-customer-id']"],
      ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
    },
    genReqId: (req) => (req.headers["x-request-id"] as string) ?? randomUUID(),
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Трейсинг: пробрасываем traceparent (W3C) в лог и ответ.
  app.addHook("onRequest", async (req, reply) => {
    const tp = req.headers.traceparent;
    if (typeof tp === "string") reply.header("traceparent", tp);
    reply.header("x-request-id", req.id);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Customer-Id", "X-Admin-Token", "X-Api-Key", "If-None-Match", "traceparent"],
    exposedHeaders: ["ETag", "x-request-id"],
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => req.customerId || req.ip,
    errorResponseBuilder: () => new AppError("RATE_LIMITED", "Слишком много запросов").toBody(),
  });

  if (config.SWAGGER_ENABLED) {
    await app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: {
          title: "ИЛЬ ДЕ БОТЭ · Опросник ЛК / Паспорт красоты",
          version: survey.version,
          description: "Конверт ответа: { data, meta?, errors?: [{ code, message, meta? }] } — как в ENSI.",
        },
        components: {
          securitySchemes: {
            bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
            dev: { type: "apiKey", in: "header", name: "X-Customer-Id" },
          },
        },
        security: [{ bearer: [] }, { dev: [] }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
    app.get("/api/v1/openapi.json", async () => app.swagger());
  }

  const authenticate =
    opts.authenticate ?? (config.AUTH_MODE === "dev" ? devAuthenticator() : jwtAuthenticator(config));
  await app.register(authPlugin, { authenticate });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send(err.toBody());
    if (err instanceof ZodError || (err as { validation?: unknown }).validation) {
      const issues = (err as ZodError).issues ?? (err as { validation?: unknown }).validation;
      return reply
        .code(422)
        .send({ errors: [{ code: "VALIDATION_ERROR", message: "Некорректный запрос", meta: { issues } }] });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429)
      return reply.code(429).send(new AppError("RATE_LIMITED", "Слишком много запросов").toBody());
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({
        errors: [
          { code: status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR", message: (err as Error).message },
        ],
      });
    }
    req.log.error({ err }, "unhandled");
    return reply.code(500).send(new AppError("INTERNAL", "Внутренняя ошибка").toBody());
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ errors: [{ code: "NOT_FOUND", message: "Маршрут не найден" }] }),
  );

  const metrics = new Metrics();
  const service = new SessionService(db, registry);
  app.decorate("sessionService", service);
  app.decorate("surveyRegistry", registry);

  await app.register(metricsRoutes, { db, metrics });
  await app.register(
    async (api) => {
      await api.register(healthRoutes, { db, registry });
      await api.register(surveyRoutes, { registry, config });
      await api.register(sessionRoutes, { service, config });
      await api.register(eventsRoutes, { db, config });
      await api.register(adminRoutes, { registry, config });
    },
    { prefix: "/api/v1" },
  );

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    sessionService: SessionService;
    surveyRegistry: SurveyRegistry;
  }
}
