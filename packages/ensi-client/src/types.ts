import type { BeautyProfile } from "@idb/core";

export type SinkContext = {
  /** W3C traceparent или наш request id — прокидывается в заголовки ENSI. */
  traceId: string;
  /** `<customer_id>:<revision>` — ключ идемпотентности (ТЗ 10.3). */
  idempotencyKey: string;
};

export type SinkResult = { externalId?: string };

/** Адаптер доставки профиля в ENSI (ТЗ 10.4). Реализации: mock | file | http. */
export interface EnsiSink {
  readonly name: string;
  upsertProfile(profile: BeautyProfile, ctx: SinkContext): Promise<SinkResult>;
  /** Опционально: входящий поток — прочитать профиль из ENSI. */
  fetchProfile?(customerId: string): Promise<BeautyProfile | null>;
}

/** Ошибка доставки с признаком, стоит ли повторять (ТЗ 10.3: 5xx/сеть/429 — да, прочие 4xx — нет). */
export class EnsiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "EnsiError";
  }
}

export function classifyStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}
