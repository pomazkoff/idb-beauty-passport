import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgresql://x", AUTH_MODE: "dev" };

describe("loadConfig", () => {
  it("булевы флаги: 'false'/'0'/'off' выключают, 'true'/'1' включают, пусто — по умолчанию", () => {
    const off = loadConfig({
      ...base,
      SWAGGER_ENABLED: "false",
      SHOW_DRAFT_BADGE: "0",
      SHOW_TRAIT_SUBTITLE: "off",
      COUNT_SKIPPED_CATEGORY: "no",
    });
    expect([
      off.SWAGGER_ENABLED,
      off.SHOW_DRAFT_BADGE,
      off.SHOW_TRAIT_SUBTITLE,
      off.COUNT_SKIPPED_CATEGORY,
    ]).toEqual([false, false, false, false]);
    const on = loadConfig({ ...base, SWAGGER_ENABLED: "true", SHOW_DRAFT_BADGE: "1" });
    expect([on.SWAGGER_ENABLED, on.SHOW_DRAFT_BADGE, on.SHOW_TRAIT_SUBTITLE]).toEqual([true, true, true]);
    expect(loadConfig(base).SWAGGER_ENABLED).toBe(false);
    expect(() => loadConfig({ ...base, SWAGGER_ENABLED: "maybe" })).toThrow(/true\/false/);
  });

  it("dev-режим запрещён в production; jwt требует ключ", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/AUTH_MODE=dev/);
    expect(() => loadConfig({ DATABASE_URL: "postgresql://x", AUTH_MODE: "jwt" })).toThrow(/JWT_JWKS_URL/);
    expect(
      loadConfig({
        DATABASE_URL: "postgresql://x",
        AUTH_MODE: "jwt",
        JWT_JWKS_URL: "https://lk/.well-known/jwks.json",
      }).AUTH_MODE,
    ).toBe("jwt");
  });

  it("CORS_ORIGINS → массив", () => {
    expect(loadConfig({ ...base, CORS_ORIGINS: "https://a, https://b ,," }).corsOrigins).toEqual([
      "https://a",
      "https://b",
    ]);
  });
});
