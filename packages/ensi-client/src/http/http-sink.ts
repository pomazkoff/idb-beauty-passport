/**
 * HTTP-адаптер к ENSI (ТЗ 10.1, 10.3). Конвенции ENSI: версионированный URL,
 * конверт { data, meta, errors[{code,message,meta}] }, trace-заголовки.
 *
 * Конфиг (env): ENSI_BASE_URL, ENSI_PROFILE_PATH (шаблон, напр. /api/v1/customers/{customer_id}/beauty-profile),
 * ENSI_PROFILE_METHOD (PUT|POST|PATCH), ENSI_AUTH_HEADER / ENSI_AUTH_VALUE, ENSI_TIMEOUT_MS.
 * Когда появится OpenAPI-контракт — `pnpm --filter @idb/ensi-client generate` и типизация запроса здесь.
 */
import type { BeautyProfile } from "@idb/core";
import { EnsiError, type EnsiSink, type SinkContext, type SinkResult, classifyStatus } from "../types.js";
import { resolvePath, toEnsiPayload } from "./mapping.js";

export type HttpSinkOptions = {
  baseUrl: string;
  profilePath: string;
  method?: "PUT" | "POST" | "PATCH";
  authHeader?: string;
  authValue?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Путь для чтения профиля (опционально, входящий поток). */
  fetchPath?: string;
};

type Envelope = { data?: unknown; errors?: { code: string; message: string; meta?: unknown }[] };

export class HttpEnsiSink implements EnsiSink {
  readonly name = "http";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: HttpSinkOptions) {
    if (!o.baseUrl) throw new Error("ENSI_BASE_URL не задан");
    if (!o.profilePath) throw new Error("ENSI_PROFILE_PATH не задан");
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  private headers(ctx?: SinkContext): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.o.authHeader && this.o.authValue) h[this.o.authHeader] = this.o.authValue;
    if (ctx) {
      h["Idempotency-Key"] = ctx.idempotencyKey;
      h.traceparent = ctx.traceId;
      h["X-Request-Id"] = ctx.traceId;
    }
    return h;
  }

  private async call(method: string, path: string, body?: unknown, ctx?: SinkContext): Promise<Envelope> {
    const url = `${this.o.baseUrl.replace(/\/$/, "")}${path}`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.o.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(ctx),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      throw new EnsiError(`ENSI недоступен: ${(e as Error).message}`, null, true);
    } finally {
      clearTimeout(t);
    }
    let json: Envelope = {};
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text) as Envelope;
      } catch {
        json = { errors: [{ code: "NON_JSON", message: text.slice(0, 500) }] };
      }
    }
    if (!res.ok) {
      const msg = json.errors?.[0]
        ? `${json.errors[0].code}: ${json.errors[0].message}`
        : `HTTP ${res.status}`;
      throw new EnsiError(
        `ENSI ${method} ${path} → ${res.status} ${msg}`,
        res.status,
        classifyStatus(res.status),
        json,
      );
    }
    return json;
  }

  async upsertProfile(profile: BeautyProfile, ctx: SinkContext): Promise<SinkResult> {
    const path = resolvePath(this.o.profilePath, profile);
    const json = await this.call(this.o.method ?? "PUT", path, toEnsiPayload(profile), ctx);
    const data = json.data as { id?: string | number } | undefined;
    return data?.id !== undefined ? { externalId: String(data.id) } : {};
  }

  async fetchProfile(customerId: string): Promise<BeautyProfile | null> {
    if (!this.o.fetchPath) return null;
    const path = this.o.fetchPath.replace("{customer_id}", encodeURIComponent(customerId));
    try {
      const json = await this.call("GET", path);
      const data = json.data as { beauty_profile?: BeautyProfile } | BeautyProfile | null | undefined;
      if (!data) return null;
      return "beauty_profile" in data ? (data.beauty_profile ?? null) : (data as BeautyProfile);
    } catch (e) {
      if (e instanceof EnsiError && e.status === 404) return null;
      throw e;
    }
  }
}
