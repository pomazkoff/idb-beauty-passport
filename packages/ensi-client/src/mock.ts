import type { BeautyProfile } from "@idb/core";
import { EnsiError, type EnsiSink, type SinkContext, type SinkResult } from "./types.js";

/** Для тестов: хранит вызовы, умеет падать по сценарию. */
export class MockEnsiSink implements EnsiSink {
  readonly name = "mock";
  readonly calls: { profile: BeautyProfile; ctx: SinkContext }[] = [];
  readonly store = new Map<string, BeautyProfile>();
  /** Очередь ответов: число → бросить EnsiError с таким статусом; "network" → сетевая ошибка; undefined → успех. */
  script: (number | "network" | undefined)[] = [];

  async upsertProfile(profile: BeautyProfile, ctx: SinkContext): Promise<SinkResult> {
    this.calls.push({ profile, ctx });
    const next = this.script.shift();
    if (next === "network") throw new EnsiError("ECONNRESET", null, true);
    if (typeof next === "number") throw new EnsiError(`HTTP ${next}`, next, next >= 500 || next === 429);
    this.store.set(profile.customer_id, profile);
    return { externalId: `mock-${profile.customer_id}` };
  }

  async fetchProfile(customerId: string): Promise<BeautyProfile | null> {
    return this.store.get(customerId) ?? null;
  }
}
