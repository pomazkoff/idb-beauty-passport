import { z } from "zod";

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(3000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_URL: z.string().min(1),
    AUTH_MODE: z.enum(["jwt", "dev"]).default("jwt"),
    JWT_JWKS_URL: z.string().url().optional(),
    JWT_PUBLIC_KEY_PEM: z.string().optional(),
    JWT_ISSUER: z.string().optional(),
    JWT_AUDIENCE: z.string().optional(),
    JWT_CUSTOMER_CLAIM: z.string().default("sub"),
    CORS_ORIGINS: z.string().default(""),
    SWAGGER_ENABLED: z.coerce.boolean().default(false),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
    SHOW_DRAFT_BADGE: z.coerce.boolean().default(true),
    SHOW_TRAIT_SUBTITLE: z.coerce.boolean().default(true),
    COUNT_SKIPPED_CATEGORY: z.coerce.boolean().default(true),
    RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && e.AUTH_MODE === "dev") {
      ctx.addIssue({ code: "custom", message: "AUTH_MODE=dev запрещён в production", path: ["AUTH_MODE"] });
    }
    if (e.AUTH_MODE === "jwt" && !e.JWT_JWKS_URL && !e.JWT_PUBLIC_KEY_PEM) {
      ctx.addIssue({
        code: "custom",
        message: "Для AUTH_MODE=jwt нужен JWT_JWKS_URL или JWT_PUBLIC_KEY_PEM",
        path: ["AUTH_MODE"],
      });
    }
  });

export type Config = z.infer<typeof Env> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Некорректная конфигурация: ${msg}`);
  }
  const c = parsed.data;
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
