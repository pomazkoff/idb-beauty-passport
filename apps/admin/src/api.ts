/** Клиент админ-API (/api/v1/admin). Токен — в sessionStorage. */
import type { Survey } from "@idb/survey-config";

export type Issue = { path: string; message: string };
export type Report = { schema: Issue[]; semantic: Issue[]; frozen: Issue[]; ok: boolean };
export type VersionSummary = {
  version: string;
  status: "draft" | "published" | "archived";
  notes: string | null;
  sourceVersion: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  questions: number;
  branches: number;
  issues: number;
};
export type VersionDetail = {
  version: string;
  status: VersionSummary["status"];
  notes: string | null;
  sourceVersion: string | null;
  updatedAt: string;
  publishedAt: string | null;
  config: Survey;
};

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly meta?: unknown,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "idb-admin-token";

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:3000";
export const WEB_BASE = (import.meta.env.VITE_WEB_BASE as string | undefined) ?? "http://localhost:5173";

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setToken(t: string) {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим */
  }
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "X-Admin-Token": getToken(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { data: undefined as T };
  const text = await res.text();
  let json: {
    data?: T;
    meta?: Record<string, unknown>;
    errors?: { code: string; message: string; meta?: unknown }[];
  } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const e = json.errors?.[0];
    throw new AdminApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `HTTP ${res.status}`, e?.meta);
  }
  return { data: json.data as T, meta: json.meta };
}

export const api = {
  me: () => req<{ ok: boolean }>("GET", "/admin/me"),
  list: () => req<VersionSummary[]>("GET", "/admin/surveys").then((r) => r.data),
  get: (v: string) =>
    req<VersionDetail>("GET", `/admin/surveys/${v}`).then((r) => ({
      detail: r.data,
      report: r.meta?.report as Report,
    })),
  create: (b: { version: string; fromVersion?: string; notes?: string }) =>
    req<VersionSummary>("POST", "/admin/surveys", b).then((r) => r.data),
  save: (v: string, config: unknown) =>
    req<VersionSummary>("PUT", `/admin/surveys/${v}`, { config }).then((r) => ({
      summary: r.data,
      report: r.meta?.report as Report,
    })),
  validate: (v: string) => req<Report>("POST", `/admin/surveys/${v}/validate`).then((r) => r.data),
  publish: (v: string) => req<VersionSummary>("POST", `/admin/surveys/${v}/publish`).then((r) => r.data),
  remove: (v: string) => req<void>("DELETE", `/admin/surveys/${v}`),
  contentMapUrl: (v: string) => `${API_BASE}/api/v1/admin/surveys/${v}/content-map`,
  previewUrl: (v: string) =>
    `${WEB_BASE}/?version=${encodeURIComponent(v)}&admin=${encodeURIComponent(getToken())}&customer=preview-${v}-${Math.random().toString(36).slice(2, 8)}`,
};
