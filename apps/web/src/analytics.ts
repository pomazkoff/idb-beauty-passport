/**
 * Аналитика (ТЗ 11): события пушатся в window.dataLayer (если есть) и батчем в POST /events
 * (debounce 2 с, flush при visibilitychange/pagehide через fetch keepalive).
 */
import type { ApiClient } from "./api/client.js";

export type EventName =
  | "quiz_started"
  | "quiz_question_shown"
  | "quiz_question_answered"
  | "quiz_question_skipped"
  | "quiz_back"
  | "quiz_base_completed"
  | "passport_announce_shown"
  | "passport_started"
  | "passport_postponed"
  | "passport_category_completed"
  | "passport_category_added";

export type AnalyticsEvent = { name: EventName; params: Record<string, unknown>; ts: string };

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export class Analytics {
  private queue: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private common: Record<string, unknown> = {};
  readonly log: AnalyticsEvent[] = [];
  private readonly unbind: () => void;

  constructor(
    private readonly api: ApiClient,
    private readonly onEvent?: (e: AnalyticsEvent) => void,
    private readonly debounceMs = 2000,
  ) {
    const flush = () => void this.flush();
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", onVis);
    }
    this.unbind = () => {
      if (typeof window === "undefined") return;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }

  /** Общие параметры (survey_version, session_id, gender) — добавляются к каждому событию. */
  setCommon(params: Record<string, unknown>) {
    this.common = { ...this.common, ...params };
  }

  track(name: EventName, params: Record<string, unknown> = {}) {
    const e: AnalyticsEvent = { name, params: { ...this.common, ...params }, ts: new Date().toISOString() };
    this.log.push(e);
    if (typeof window !== "undefined" && Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...e.params });
    }
    this.onEvent?.(e);
    this.queue.push(e);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 100);
    await this.api.sendEvents(batch);
    if (this.queue.length) await this.flush();
  }

  destroy() {
    this.unbind();
    void this.flush();
  }
}
