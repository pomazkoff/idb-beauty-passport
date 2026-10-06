/**
 * Аутентификация (ТЗ 9.1).
 *  jwt — Bearer-токен ЛК: подпись (JWKS или PEM), iss/aud/exp, customer_id из клейма.
 *  dev — заголовок X-Customer-Id; запрещён в production на уровне конфига.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  type JWTPayload,
  type JWTVerifyGetKey,
  type KeyLike,
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
} from "jose";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";

declare module "fastify" {
  interface FastifyRequest {
    customerId: string;
  }
}

export type Authenticator = (req: FastifyRequest) => Promise<string>;

export function devAuthenticator(): Authenticator {
  return async (req) => {
    const id = req.headers["x-customer-id"];
    if (typeof id !== "string" || !id.trim())
      throw new AppError("UNAUTHORIZED", "Нет заголовка X-Customer-Id");
    return id.trim();
  };
}

export function jwtAuthenticator(cfg: Config): Authenticator {
  let key: JWTVerifyGetKey | KeyLike | undefined;
  const getKey = async () => {
    if (key) return key;
    if (cfg.JWT_JWKS_URL) key = createRemoteJWKSet(new URL(cfg.JWT_JWKS_URL));
    else if (cfg.JWT_PUBLIC_KEY_PEM)
      key = await importSPKI(cfg.JWT_PUBLIC_KEY_PEM.replace(/\\n/g, "\n"), "RS256");
    else throw new Error("JWT: нет ключа");
    return key;
  };
  return async (req) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new AppError("UNAUTHORIZED", "Нужен Bearer-токен");
    const token = h.slice(7);
    let payload: JWTPayload;
    try {
      const k = await getKey();
      const opts = { issuer: cfg.JWT_ISSUER, audience: cfg.JWT_AUDIENCE };
      // jose перегружен по типу ключа; приводим явно.
      ({ payload } = await jwtVerify(token, k as KeyLike, opts));
    } catch (e) {
      throw new AppError("UNAUTHORIZED", "Токен недействителен", { reason: (e as Error).message });
    }
    const id = payload[cfg.JWT_CUSTOMER_CLAIM];
    if (typeof id !== "string" && typeof id !== "number") {
      throw new AppError("UNAUTHORIZED", `В токене нет клейма ${cfg.JWT_CUSTOMER_CLAIM}`);
    }
    return String(id);
  };
}

export const authPlugin = fp<{ authenticate: Authenticator }>(async (app: FastifyInstance, opts) => {
  app.decorateRequest("customerId", "");
  app.decorate("authenticate", async (req: FastifyRequest) => {
    req.customerId = await opts.authenticate(req);
  });
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}
