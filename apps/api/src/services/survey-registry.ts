/**
 * Реестр версий опросника (этап 8). Источник правды — таблица survey_versions.
 * В памяти кэшируются распарсенные конфиги; опубликованная версия — `current()`.
 * Сессии, начатые на старых версиях, продолжают работать: `get(version)`.
 */
import { createHash } from "node:crypto";
import { type Db, sessions, surveyVersions } from "@idb/db";
import {
  type Survey,
  Survey as SurveySchema,
  type ValidationIssue,
  checkFrozenCodes,
  survey as packagedSurvey,
  validateSurvey,
} from "@idb/survey-config";
import { desc, eq } from "drizzle-orm";
import { AppError } from "../errors.js";

export type VersionRow = typeof surveyVersions.$inferSelect;
export type VersionSummary = {
  version: string;
  status: VersionRow["status"];
  notes: string | null;
  sourceVersion: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  questions: number;
  branches: number;
  issues: number;
};

export type ValidationReport = {
  schema: ValidationIssue[];
  semantic: ValidationIssue[];
  frozen: ValidationIssue[];
  ok: boolean;
};

const checksum = (config: unknown) => createHash("sha256").update(JSON.stringify(config)).digest("hex");

export class SurveyRegistry {
  private cache = new Map<string, Survey>();
  private currentVersion: string | null = null;

  constructor(private readonly db: Db) {}

  /** При старте: если опубликованной версии нет — публикуем встроенный survey.v1.json (сид). */
  async init(): Promise<Survey> {
    const published = await this.db.query.surveyVersions.findFirst({
      where: eq(surveyVersions.status, "published"),
    });
    if (!published) {
      await this.db
        .insert(surveyVersions)
        .values({
          version: packagedSurvey.version,
          config: packagedSurvey,
          checksum: checksum(packagedSurvey),
          status: "published",
          notes: "Начальная версия из packages/survey-config/survey.v1.json",
          publishedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: surveyVersions.version,
          set: { status: "published", publishedAt: new Date() },
        });
    }
    return this.refresh();
  }

  /** Перечитать опубликованную версию из БД. */
  async refresh(): Promise<Survey> {
    const row = await this.db.query.surveyVersions.findFirst({
      where: eq(surveyVersions.status, "published"),
    });
    if (!row) throw new Error("Нет опубликованной версии опросника");
    const parsed = SurveySchema.parse(row.config);
    this.cache.set(row.version, parsed);
    this.currentVersion = row.version;
    return parsed;
  }

  current(): Survey {
    if (!this.currentVersion) throw new Error("SurveyRegistry не инициализирован");
    return this.cache.get(this.currentVersion)!;
  }

  /** Конфиг любой версии (в т. ч. черновика — для предпросмотра и старых сессий). */
  async get(version: string): Promise<Survey> {
    const cached = this.cache.get(version);
    if (cached) return cached;
    const row = await this.db.query.surveyVersions.findFirst({ where: eq(surveyVersions.version, version) });
    if (!row) throw new AppError("NOT_FOUND", `Версия опросника ${version} не найдена`);
    const parsed = SurveySchema.parse(row.config);
    // черновики меняются — кэшируем только опубликованные/архивные
    if (row.status !== "draft") this.cache.set(version, parsed);
    return parsed;
  }

  // ── админ-операции ─────────────────────────────────────────────────
  async list(): Promise<VersionSummary[]> {
    const rows = await this.db.select().from(surveyVersions).orderBy(desc(surveyVersions.createdAt));
    return rows.map((r) => this.summary(r));
  }

  private summary(r: VersionRow): VersionSummary {
    const parsed = SurveySchema.safeParse(r.config);
    const s = parsed.success ? parsed.data : null;
    const issues = parsed.success ? validateSurvey(parsed.data).length : parsed.error.issues.length;
    return {
      version: r.version,
      status: r.status,
      notes: r.notes,
      sourceVersion: r.sourceVersion,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
      questions: s ? s.base.length + s.branches.reduce((n, b) => n + b.questions.length, 0) : 0,
      branches: s?.branches.length ?? 0,
      issues,
    };
  }

  async getRow(version: string): Promise<VersionRow> {
    const row = await this.db.query.surveyVersions.findFirst({ where: eq(surveyVersions.version, version) });
    if (!row) throw new AppError("NOT_FOUND", `Версия ${version} не найдена`);
    return row;
  }

  /** Создать черновик копированием версии-источника (по умолчанию — опубликованной). */
  async createDraft(input: {
    version: string;
    fromVersion?: string;
    notes?: string;
  }): Promise<VersionSummary> {
    if (!/^\d+\.\d+\.\d+$/.test(input.version))
      throw new AppError("VALIDATION_ERROR", "Версия должна быть вида 1.2.3");
    const exists = await this.db.query.surveyVersions.findFirst({
      where: eq(surveyVersions.version, input.version),
    });
    if (exists) throw new AppError("VALIDATION_ERROR", `Версия ${input.version} уже существует`);
    const from = input.fromVersion ?? this.currentVersion!;
    const source = await this.getRow(from);
    const config = { ...(source.config as object), version: input.version };
    const [row] = await this.db
      .insert(surveyVersions)
      .values({
        version: input.version,
        config,
        checksum: checksum(config),
        status: "draft",
        notes: input.notes ?? null,
        sourceVersion: from,
      })
      .returning();
    return this.summary(row!);
  }

  /** Сохранить черновик. Структурно невалидный JSON сохраняется тоже — публикацию блокирует валидация. */
  async saveDraft(
    version: string,
    config: unknown,
  ): Promise<{ summary: VersionSummary; report: ValidationReport }> {
    const row = await this.getRow(version);
    if (row.status !== "draft") throw new AppError("FORBIDDEN", "Редактировать можно только черновик");
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw new AppError("VALIDATION_ERROR", "Конфиг должен быть объектом");
    const fixed = { ...(config as Record<string, unknown>), version };
    const [updated] = await this.db
      .update(surveyVersions)
      .set({ config: fixed, checksum: checksum(fixed), updatedAt: new Date() })
      .where(eq(surveyVersions.version, version))
      .returning();
    return { summary: this.summary(updated!), report: await this.validate(version, fixed) };
  }

  async validate(version: string, config?: unknown): Promise<ValidationReport> {
    const cfg = config ?? (await this.getRow(version)).config;
    const parsed = SurveySchema.safeParse(cfg);
    if (!parsed.success) {
      const schema = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return { schema, semantic: [], frozen: [], ok: false };
    }
    const semantic = validateSurvey(parsed.data);
    const frozen =
      this.currentVersion && this.currentVersion !== version
        ? checkFrozenCodes(this.current(), parsed.data)
        : [];
    return { schema: [], semantic, frozen, ok: semantic.length === 0 && frozen.length === 0 };
  }

  /** Публикация: валидна → предыдущая опубликованная в архив, эта — published. */
  async publish(version: string): Promise<VersionSummary> {
    const row = await this.getRow(version);
    if (row.status === "published") return this.summary(row);
    const report = await this.validate(version, row.config);
    if (!report.ok) {
      throw new AppError("VALIDATION_ERROR", "Черновик не проходит проверку — публикация невозможна", {
        report,
      });
    }
    const now = new Date();
    const [updated] = await this.db.transaction(async (tx) => {
      await tx
        .update(surveyVersions)
        .set({ status: "archived", updatedAt: now })
        .where(eq(surveyVersions.status, "published"));
      return tx
        .update(surveyVersions)
        .set({ status: "published", publishedAt: now, updatedAt: now })
        .where(eq(surveyVersions.version, version))
        .returning();
    });
    this.cache.delete(version);
    await this.refresh();
    return this.summary(updated!);
  }

  async deleteDraft(version: string): Promise<void> {
    const row = await this.getRow(version);
    if (row.status !== "draft") throw new AppError("FORBIDDEN", "Удалять можно только черновик");
    // сессии предпросмотра ссылаются на черновик — удаляем вместе с ним
    await this.db.delete(sessions).where(eq(sessions.surveyVersion, version));
    await this.db.delete(surveyVersions).where(eq(surveyVersions.version, version));
    this.cache.delete(version);
  }
}
