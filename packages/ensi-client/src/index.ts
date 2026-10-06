export * from "./types.js";
export { MockEnsiSink } from "./mock.js";
export { FileEnsiSink } from "./file.js";
export { HttpEnsiSink, type HttpSinkOptions } from "./http/http-sink.js";
export { toEnsiPayload, resolvePath, type EnsiProfilePayload } from "./http/mapping.js";

import { FileEnsiSink } from "./file.js";
import { HttpEnsiSink } from "./http/http-sink.js";
import { MockEnsiSink } from "./mock.js";
import type { EnsiSink } from "./types.js";

/** Фабрика по окружению: ENSI_SINK=mock|file|http (ТЗ 10.4). */
export function createSinkFromEnv(env: Record<string, string | undefined> = process.env): EnsiSink {
  const kind = env.ENSI_SINK ?? "file";
  switch (kind) {
    case "mock":
      return new MockEnsiSink();
    case "file":
      return new FileEnsiSink(env.ENSI_FILE_DIR ?? "./.ensi-out");
    case "http":
      return new HttpEnsiSink({
        baseUrl: env.ENSI_BASE_URL ?? "",
        profilePath: env.ENSI_PROFILE_PATH ?? "",
        method: (env.ENSI_PROFILE_METHOD as "PUT" | "POST" | "PATCH" | undefined) ?? "PUT",
        authHeader: env.ENSI_AUTH_HEADER,
        authValue: env.ENSI_AUTH_VALUE,
        timeoutMs: env.ENSI_TIMEOUT_MS ? Number(env.ENSI_TIMEOUT_MS) : undefined,
        fetchPath: env.ENSI_FETCH_PATH,
      });
    default:
      throw new Error(`Неизвестный ENSI_SINK=${kind}`);
  }
}
