import type { BeautyProfile } from "@idb/core";
import type {
  ApiError,
  Category,
  Envelope,
  Gender,
  ProfileView,
  SessionView,
  SurveyConfig,
} from "./types.js";

export type Auth = {
  token?: string;
  customerId?: string;
  /** Предпросмотр черновика из конструктора: версия + X-Admin-Token. */
  previewVersion?: string;
  adminToken?: string;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
  get retryable() {
    return this.status >= 500 || this.status === 429 || this.status === 0;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ApiClient {
  private readonly surveyCache = new Map<string, { etag: string; data: SurveyConfig }>();

  constructor(
    readonly base: string,
    private auth: Auth,
  ) {}

  setAuth(auth: Auth) {
    this.auth = auth;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json", ...extra };
    if (this.auth.token) h.Authorization = `Bearer ${this.auth.token}`;
    else if (this.auth.customerId) h["X-Customer-Id"] = this.auth.customerId;
    if (this.auth.adminToken) h["X-Admin-Token"] = this.auth.adminToken;
    return h;
  }

  private versionQuery(prefix = "?"): string {
    return this.auth.previewVersion ? `${prefix}version=${encodeURIComponent(this.auth.previewVersion)}` : "";
  }

  /** Запрос с экспоненциальным повтором на сетевых/5xx/429 (ТЗ 8.3). */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { retries?: number } = {},
  ): Promise<Envelope<T>> {
    const retries = opts.retries ?? 4;
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await fetch(`${this.base}/api/v1${path}`, {
          method,
          headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          credentials: "omit",
        });
      } catch (e) {
        if (attempt++ < retries) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw new ApiRequestError(0, { code: "NETWORK", message: (e as Error).message });
      }
      if (res.ok)
        return res.status === 204
          ? ({ data: undefined } as Envelope<T>)
          : ((await res.json()) as Envelope<T>);
      let err: ApiError = { code: "HTTP_ERROR", message: `HTTP ${res.status}` };
      try {
        const j = (await res.json()) as Envelope<unknown>;
        if (j.errors?.[0]) err = j.errors[0];
      } catch {
        /* тело не JSON */
      }
      const e = new ApiRequestError(res.status, err);
      if (e.retryable && attempt++ < retries) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }

  async getSurvey(gender: Gender | null): Promise<SurveyConfig> {
    const key = gender ?? "none";
    const cached = this.surveyCache.get(key);
    const qs = [gender ? `gender=${gender}` : "", this.versionQuery("")].filter(Boolean).join("&");
    const res = await fetch(`${this.base}/api/v1/survey${qs ? `?${qs}` : ""}`, {
      headers: {
        ...(cached ? { "If-None-Match": cached.etag } : {}),
        ...(this.auth.adminToken ? { "X-Admin-Token": this.auth.adminToken } : {}),
      },
    });
    if (res.status === 304 && cached) return cached.data;
    if (!res.ok) throw new ApiRequestError(res.status, { code: "HTTP_ERROR", message: `HTTP ${res.status}` });
    const data = ((await res.json()) as Envelope<SurveyConfig>).data;
    const etag = res.headers.get("ETag");
    if (etag) this.surveyCache.set(key, { etag, data });
    return data;
  }

  getSession = () =>
    this.request<SessionView>("GET", `/me/session${this.versionQuery()}`).then((r) => r.data);

  putAnswer = (key: string, optionCodes: string[], skipped: boolean, timeMs?: number) =>
    this.request<SessionView>("PUT", `/me/session/answers/${key}`, { optionCodes, skipped, timeMs }).then(
      (r) => ({
        session: r.data,
        genderReset: Boolean(r.meta?.genderReset),
      }),
    );

  completeBase = () => this.request<BeautyProfile>("POST", "/me/session/base:complete").then((r) => r.data);
  startPassport = (category: Category) =>
    this.request<SessionView>("POST", "/me/session/passport:start", { category }).then((r) => r.data);
  completePassport = (category: Category) =>
    this.request<BeautyProfile>("POST", "/me/session/passport:complete", { category }).then((r) => r.data);
  reset = () =>
    this.request<SessionView>("POST", `/me/session:reset${this.versionQuery()}`).then((r) => r.data);
  getProfile = () => this.request<ProfileView>("GET", "/me/profile").then((r) => r.data);

  /** Пакет событий. keepalive переживает закрытие вкладки (аналог sendBeacon, но с заголовками авторизации). */
  sendEvents(events: { name: string; params: Record<string, unknown>; ts: string }[]): Promise<void> {
    return fetch(`${this.base}/api/v1/events`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ events }),
      keepalive: true,
    })
      .then(() => undefined)
      .catch(() => undefined);
  }
}
