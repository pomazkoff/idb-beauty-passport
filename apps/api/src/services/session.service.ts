/**
 * Сессии опросника: загрузка/создание, применение ответов, завершение этапов,
 * сброс, профиль. Единственное место, где состояние движка встречается с БД.
 */
import {
  type AnswerRecord,
  type BeautyProfile,
  type CategoryCode,
  type Derived,
  type SurveyState,
  applyAnswer,
  buildProfile,
  completeCategory,
  derive,
  getBranchQuestions,
  getGender,
  isBaseAnswered,
  isBranchAnswered,
  markBaseCompleted,
} from "@idb/core";
import { type Db, type SessionRow, affectedOf, answers, ensiOutbox, profiles, sessions } from "@idb/db";
import type { EnsiSink } from "@idb/ensi-client";
import { type Survey, findBranch } from "@idb/survey-config";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { type RestoredSession, restoreStateFromProfile } from "./ensi-restore.js";
import type { SurveyRegistry } from "./survey-registry.js";

export type SessionView = {
  sessionId: string;
  surveyVersion: string;
  stage: SessionRow["stage"];
  activeCategory: CategoryCode | null;
  answers: Record<string, AnswerRecord>;
  derived: Derived;
};

export type SyncStatus = {
  status: "none" | "pending" | "sending" | "sent" | "failed" | "superseded" | "dead";
  revision: number | null;
  lastAttemptAt: string | null;
  attempts: number;
  lastError: string | null;
};

type ActiveSession = SessionRow & { answers: (typeof answers.$inferSelect)[] };

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly registry: SurveyRegistry,
    private readonly sink?: EnsiSink,
    private readonly log?: { warn: (obj: object, msg: string) => void },
  ) {}

  // ── чтение ──────────────────────────────────────────────────────
  /**
   * Активная сессия клиента; создаётся на опубликованной версии (или на `version` — предпросмотр черновика).
   * Пустой вход залогиненного клиента читает профиль из ENSI и, если он есть, открывает экран результата.
   * Ошибка ENSI и пустой file-sink не мешают открыть опросник с начала.
   */
  async getOrCreate(customerId: string, version?: string): Promise<SessionView> {
    const existing = await this.findActive(customerId);
    if (existing && !this.isBlankIntro(existing))
      return this.toView(existing, existing.answers, await this.registry.get(existing.surveyVersion));

    // Предпросмотр черновика и «Пройти заново» (ensiChecked) не подмешивают профиль из ENSI.
    if (version) {
      if (existing)
        return this.toView(existing, existing.answers, await this.registry.get(existing.surveyVersion));
      return this.insertBlank(customerId, await this.registry.get(version), true, version);
    }
    if (existing?.ensiChecked) {
      return this.toView(existing, existing.answers, await this.registry.get(existing.surveyVersion));
    }

    const fetched = await this.readEnsiProfile(customerId);
    if (fetched.ok && fetched.profile) {
      const survey = await this.surveyFor(fetched.profile);
      const restored = restoreStateFromProfile(survey, fetched.profile);
      if (restored) {
        const applied = await this.persistRestored(
          customerId,
          existing?.id ?? null,
          survey,
          restored,
          fetched.profile,
        );
        if (applied) return applied;
        const fresh = await this.findActive(customerId);
        if (fresh) return this.toView(fresh, fresh.answers, await this.registry.get(fresh.surveyVersion));
      }
    }

    const checked = fetched.ok;
    if (existing) {
      if (checked)
        await this.db.update(sessions).set({ ensiChecked: true }).where(eq(sessions.id, existing.id));
      return this.toView(existing, existing.answers, await this.registry.get(existing.surveyVersion));
    }
    return this.insertBlank(customerId, this.registry.current(), checked);
  }

  private async findActive(customerId: string): Promise<ActiveSession | undefined> {
    return this.db.query.sessions.findFirst({
      where: and(eq(sessions.customerId, customerId), eq(sessions.status, "active")),
      with: { answers: true },
    });
  }

  /** Intro без единого ответа: можно импортировать профиль, не затирая прохождение. */
  private isBlankIntro(row: ActiveSession): boolean {
    return (
      row.stage === "intro" &&
      !row.baseCompleted &&
      row.completedCategories.length === 0 &&
      row.answers.length === 0
    );
  }

  private async surveyFor(profile: BeautyProfile): Promise<Survey> {
    try {
      return await this.registry.get(profile.survey_version);
    } catch {
      return this.registry.current();
    }
  }

  /** ok: false — ENSI недоступен, проверку не запоминаем и повторим на следующем входе. */
  private async readEnsiProfile(
    customerId: string,
  ): Promise<{ ok: true; profile: BeautyProfile | null } | { ok: false }> {
    if (!this.sink?.fetchProfile) return { ok: true, profile: null };
    try {
      const profile = await this.sink.fetchProfile(customerId);
      if (profile && profile.customer_id !== customerId) {
        this.log?.warn({ customerId }, "ensi: профиль с чужим customer_id, импорт пропущен");
        return { ok: true, profile: null };
      }
      return { ok: true, profile: profile ?? null };
    } catch (e) {
      this.log?.warn(
        { customerId, err: (e as Error).message },
        "ensi: профиль не прочитан, опросник откроется с начала",
      );
      return { ok: false };
    }
  }

  private async insertBlank(
    customerId: string,
    survey: Survey,
    ensiChecked: boolean,
    previewVersion?: string,
  ): Promise<SessionView> {
    const [row] = await this.db
      .insert(sessions)
      .values({ customerId, surveyVersion: survey.version, ensiChecked })
      .onConflictDoNothing()
      .returning();
    if (row) return this.toView(row, [], survey);
    return this.getOrCreate(customerId, previewVersion);
  }

  /**
   * Записывает восстановленные ответы и сам профиль. В outbox строка сразу `sent`:
   * профиль уже лежит в ENSI, повторно его не пушим. null — сессию успели заполнить параллельно.
   */
  private async persistRestored(
    customerId: string,
    existingId: string | null,
    survey: Survey,
    restored: RestoredSession,
    profile: BeautyProfile,
  ): Promise<SessionView | null> {
    const now = new Date();
    const saved = await this.db.transaction(async (tx) => {
      let sessionId = existingId;
      if (sessionId) {
        const [cur] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
        if (!cur || cur.status !== "active" || cur.stage !== "intro" || cur.baseCompleted) return null;
        const taken = await tx
          .select({ key: answers.questionKey })
          .from(answers)
          .where(eq(answers.sessionId, sessionId));
        if (taken.length) return null;
      }
      if (!sessionId) {
        const [row] = await tx
          .insert(sessions)
          .values({
            customerId,
            surveyVersion: survey.version,
            stage: restored.stage,
            baseCompleted: true,
            completedCategories: restored.state.completedCategories,
            ensiChecked: true,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning();
        sessionId = row?.id ?? null;
      }
      if (!sessionId) {
        const [cur] = await tx
          .select()
          .from(sessions)
          .where(and(eq(sessions.customerId, customerId), eq(sessions.status, "active")));
        if (!cur || cur.stage !== "intro" || cur.baseCompleted) return null;
        const taken = await tx
          .select({ key: answers.questionKey })
          .from(answers)
          .where(eq(answers.sessionId, cur.id));
        if (taken.length) return null;
        sessionId = cur.id;
      }
      if (!sessionId) return null;
      await tx
        .update(sessions)
        .set({
          surveyVersion: survey.version,
          stage: restored.stage,
          baseCompleted: true,
          completedCategories: restored.state.completedCategories,
          activeCategory: null,
          ensiChecked: true,
          updatedAt: now,
        })
        .where(eq(sessions.id, sessionId));
      await tx.delete(answers).where(eq(answers.sessionId, sessionId));
      const answerRows = Object.entries(restored.state.answers).map(([questionKey, a]) => ({
        sessionId,
        questionKey,
        optionCodes: a.optionCodes,
        skipped: a.skipped,
        timeMs: a.timeMs ?? null,
        answeredAt: a.answeredAt && !Number.isNaN(Date.parse(a.answeredAt)) ? new Date(a.answeredAt) : now,
      }));
      if (answerRows.length) await tx.insert(answers).values(answerRows);

      const revision = profile.profile_revision > 0 ? profile.profile_revision : 1;
      const [stored] = await tx
        .insert(profiles)
        .values({
          customerId,
          sessionId,
          revision,
          payload: { ...profile, customer_id: customerId, profile_revision: revision },
          createdAt: now,
        })
        .onConflictDoNothing({ target: [profiles.customerId, profiles.revision] })
        .returning({ id: profiles.id });
      if (stored) {
        await tx.insert(ensiOutbox).values({
          profileId: stored.id,
          customerId,
          revision,
          status: "sent",
          sentAt: now,
        });
      }
      return sessionId;
    });
    if (!saved) return null;
    const row = await this.findActive(customerId);
    if (!row) return null;
    return this.toView(row, row.answers, await this.registry.get(row.surveyVersion));
  }

  /**
   * Активная сессия + конфиг той версии, на которой она начата: сессия доживает на своей версии,
   * даже если опубликована новая. SURVEY_VERSION_MISMATCH — только если версия удалена.
   */
  private async loadActive(customerId: string) {
    const row = await this.db.query.sessions.findFirst({
      where: and(eq(sessions.customerId, customerId), eq(sessions.status, "active")),
      with: { answers: true },
    });
    if (!row) throw new AppError("NOT_FOUND", "Активная сессия не найдена");
    let survey: Survey;
    try {
      survey = await this.registry.get(row.surveyVersion);
    } catch {
      throw new AppError(
        "SURVEY_VERSION_MISMATCH",
        "Версия опросника этой сессии больше недоступна; начните заново",
        {
          session: row.surveyVersion,
          current: this.registry.current().version,
        },
      );
    }
    return { ...row, survey };
  }

  private toState(row: SessionRow, rows: (typeof answers.$inferSelect)[]): SurveyState {
    const map: Record<string, AnswerRecord> = {};
    for (const a of rows) {
      const rec: AnswerRecord = {
        optionCodes: a.optionCodes,
        skipped: a.skipped,
        answeredAt: a.answeredAt.toISOString(),
      };
      if (a.timeMs !== null) rec.timeMs = a.timeMs;
      map[a.questionKey] = rec;
    }
    return {
      answers: map,
      completedCategories: row.completedCategories as CategoryCode[],
      baseCompleted: row.baseCompleted,
    };
  }

  private toView(row: SessionRow, rows: (typeof answers.$inferSelect)[], survey: Survey): SessionView {
    const state = this.toState(row, rows);
    return {
      sessionId: row.id,
      surveyVersion: row.surveyVersion,
      stage: row.stage,
      activeCategory: (row.activeCategory as CategoryCode | null) ?? null,
      answers: state.answers,
      derived: derive(survey, state),
    };
  }

  // ── ответы ──────────────────────────────────────────────────────
  async answer(
    customerId: string,
    questionKey: string,
    input: { optionCodes: string[]; skipped: boolean; timeMs?: number },
  ): Promise<SessionView & { genderReset: boolean }> {
    const row = await this.loadActive(customerId);
    const state = this.toState(row, row.answers);
    const now = new Date();
    const r = applyAnswer(row.survey, state, questionKey, { ...input, answeredAt: now.toISOString() });
    if (!r.ok)
      throw new AppError(
        r.error.code,
        r.error.message,
        "option" in r.error ? { option: r.error.option } : undefined,
      );

    await this.db.transaction(async (tx) => {
      if (r.genderReset) {
        await tx.delete(answers).where(eq(answers.sessionId, row.id));
        await tx
          .update(sessions)
          .set({
            baseCompleted: false,
            completedCategories: [],
            activeCategory: null,
            stage: "base",
            updatedAt: now,
          })
          .where(eq(sessions.id, row.id));
      } else {
        const patch: Partial<typeof sessions.$inferInsert> = { updatedAt: now };
        if (row.stage === "intro") patch.stage = "base";
        await tx.update(sessions).set(patch).where(eq(sessions.id, row.id));
      }
      await tx
        .insert(answers)
        .values({
          sessionId: row.id,
          questionKey,
          optionCodes: r.state.answers[questionKey]!.optionCodes,
          skipped: r.state.answers[questionKey]!.skipped,
          timeMs: input.timeMs ?? null,
          answeredAt: now,
        })
        .onConflictDoUpdate({
          target: [answers.sessionId, answers.questionKey],
          set: {
            optionCodes: r.state.answers[questionKey]!.optionCodes,
            skipped: r.state.answers[questionKey]!.skipped,
            timeMs: input.timeMs ?? null,
            answeredAt: now,
          },
        });
    });

    const fresh = await this.loadActive(customerId);
    return { ...this.toView(fresh, fresh.answers, fresh.survey), genderReset: r.genderReset };
  }

  // ── завершение этапов ───────────────────────────────────────────
  async completeBase(customerId: string): Promise<BeautyProfile> {
    const row = await this.loadActive(customerId);
    const state = this.toState(row, row.answers);
    if (!isBaseAnswered(row.survey, state)) {
      throw new AppError("STAGE_NOT_COMPLETE", "Не все базовые вопросы отвечены");
    }
    const next = markBaseCompleted(state);
    return this.persistStage(row, next, { stage: "result1", activeCategory: null });
  }

  async startPassport(customerId: string, category: CategoryCode): Promise<SessionView> {
    const row = await this.loadActive(customerId);
    const state = this.toState(row, row.answers);
    const gender = getGender(state);
    if (!state.baseCompleted || !gender) throw new AppError("STAGE_NOT_COMPLETE", "Сначала завершите базу");
    if (!findBranch(row.survey, gender, category)) {
      throw new AppError("BRANCH_NOT_AVAILABLE", `Категория ${category} недоступна`, { gender, category });
    }
    await this.db
      .update(sessions)
      .set({ stage: "passport", activeCategory: category, updatedAt: new Date() })
      .where(eq(sessions.id, row.id));
    const fresh = await this.loadActive(customerId);
    return this.toView(fresh, fresh.answers, fresh.survey);
  }

  async completePassport(customerId: string, category: CategoryCode): Promise<BeautyProfile> {
    const row = await this.loadActive(customerId);
    const state = this.toState(row, row.answers);
    const gender = getGender(state);
    if (!state.baseCompleted || !gender) throw new AppError("STAGE_NOT_COMPLETE", "Сначала завершите базу");
    if (!getBranchQuestions(row.survey, gender, category)) {
      throw new AppError("BRANCH_NOT_AVAILABLE", `Категория ${category} недоступна`, { gender, category });
    }
    if (!isBranchAnswered(row.survey, state, category)) {
      throw new AppError("STAGE_NOT_COMPLETE", "Не все вопросы категории отвечены или пропущены", {
        category,
      });
    }
    const next = completeCategory(state, category);
    return this.persistStage(row, next, { stage: "result2", activeCategory: null });
  }

  /**
   * В одной транзакции: обновить сессию, записать новую ревизию профиля,
   * положить задание в outbox, пометить старые pending того же клиента superseded (ТЗ 10.3).
   */
  private async persistStage(
    row: SessionRow & { survey: Survey },
    state: SurveyState,
    patch: { stage: SessionRow["stage"]; activeCategory: string | null },
  ): Promise<BeautyProfile> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      // UPDATE строки сессии первым — блокирует её до конца транзакции и сериализует
      // конкурентные complete одного клиента, поэтому нумерация ревизий ниже без гонок.
      await tx
        .update(sessions)
        .set({
          ...patch,
          baseCompleted: state.baseCompleted,
          completedCategories: state.completedCategories,
          updatedAt: now,
        })
        .where(eq(sessions.id, row.id));

      const [last] = await tx
        .select({ revision: profiles.revision })
        .from(profiles)
        .where(eq(profiles.customerId, row.customerId))
        .orderBy(desc(profiles.revision))
        .limit(1)
        .for("update");
      const revision = (last?.revision ?? 0) + 1;

      const profile = buildProfile(row.survey, state, {
        customerId: row.customerId,
        revision,
        updatedAt: now.toISOString(),
      });

      const [p] = await tx
        .insert(profiles)
        .values({ customerId: row.customerId, sessionId: row.id, revision, payload: profile, createdAt: now })
        .returning({ id: profiles.id });

      await tx
        .update(ensiOutbox)
        .set({ status: "superseded" })
        .where(
          and(eq(ensiOutbox.customerId, row.customerId), inArray(ensiOutbox.status, ["pending", "failed"])),
        );
      await tx.insert(ensiOutbox).values({ profileId: p!.id, customerId: row.customerId, revision });

      return profile;
    });
  }

  // ── сброс и профиль ─────────────────────────────────────────────
  async reset(customerId: string, version?: string): Promise<SessionView> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(and(eq(sessions.customerId, customerId), eq(sessions.status, "active")));
      await tx.insert(sessions).values({
        customerId,
        surveyVersion: version ?? this.registry.current().version,
        ensiChecked: true,
      });
    });
    return this.getOrCreate(customerId);
  }

  async latestProfile(customerId: string): Promise<{ profile: BeautyProfile | null; ensi: SyncStatus }> {
    const p = await this.db.query.profiles.findFirst({
      where: eq(profiles.customerId, customerId),
      orderBy: desc(profiles.revision),
      with: { outbox: true },
    });
    if (!p)
      return {
        profile: null,
        ensi: { status: "none", revision: null, lastAttemptAt: null, attempts: 0, lastError: null },
      };
    const o = p.outbox[0];
    return {
      profile: p.payload as BeautyProfile,
      ensi: {
        status: o?.status ?? "none",
        revision: p.revision,
        lastAttemptAt:
          o?.sentAt?.toISOString() ?? (o && o.attempts > 0 ? o.nextAttemptAt.toISOString() : null),
        attempts: o?.attempts ?? 0,
        lastError: o?.lastError ?? null,
      },
    };
  }

  /**
   * Удаление архивных сессий и событий старше retentionDays (ТЗ 9.3).
   * Сессии, на которые ссылаются профили, не удаляются: профили — история ревизий для ENSI,
   * их каскадное удаление сбило бы нумерацию ревизий (ревью, 2026-10-06).
   */
  async purgeOld(retentionDays: number): Promise<number> {
    const r = await this.db.execute(sql`
      DELETE FROM sessions s
      WHERE s.status = 'archived'
        AND s.archived_at < now() - make_interval(days => ${retentionDays})
        AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.session_id = s.id)`);
    await this.db.execute(sql`
      DELETE FROM analytics_events WHERE server_ts < now() - make_interval(days => ${retentionDays})`);
    return affectedOf(r);
  }
}
