import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BeautyProfile } from "@idb/core";
import type { EnsiSink, SinkContext, SinkResult } from "./types.js";

/**
 * Локальная демонстрация (ТЗ 10.4): пишет профиль в
 *   <dir>/<customer_id>/rev-<revision>.json  и  <dir>/<customer_id>/latest.json
 * Файлы — ровно тот JSON, что ушёл бы в ENSI (контракт BeautyProfile).
 */
export class FileEnsiSink implements EnsiSink {
  readonly name = "file";
  constructor(private readonly dir: string) {}

  async upsertProfile(profile: BeautyProfile, ctx: SinkContext): Promise<SinkResult> {
    const safe = profile.customer_id.replace(/[^A-Za-z0-9_.-]/g, "_");
    const folder = join(this.dir, safe);
    await mkdir(folder, { recursive: true });
    const body = JSON.stringify(
      { ...profile, _meta: { idempotencyKey: ctx.idempotencyKey, traceId: ctx.traceId } },
      null,
      2,
    );
    await writeFile(join(folder, `rev-${profile.profile_revision}.json`), body, "utf8");
    await writeFile(join(folder, "latest.json"), body, "utf8");
    return { externalId: `file:${safe}/rev-${profile.profile_revision}` };
  }

  async fetchProfile(customerId: string): Promise<BeautyProfile | null> {
    const safe = customerId.replace(/[^A-Za-z0-9_.-]/g, "_");
    try {
      const raw = await readFile(join(this.dir, safe, "latest.json"), "utf8");
      const { _meta, ...profile } = JSON.parse(raw) as BeautyProfile & { _meta?: unknown };
      return profile;
    } catch {
      return null;
    }
  }
}
