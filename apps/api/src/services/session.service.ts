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
import { type Db, type SessionRow, answers, ensiOutbox, profiles, sessions } from "@idb/db";
import { type Survey, findBranch } from "@idb/survey-config";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";

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

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly survey: Survey,
  ) {}

  // ── чтение ──────────────────────────────────────────────────────
  async getOrCreate(customerId: string): Promise<SessionView> {
    const existing = await this.db.query.sessions.findFirst({
      where: and(eq(sessions.customerId, customerId), eq(sessions.status, "active")),
      with: { answers: true },
    });
    if (existing) return this.toView(existing, existing.answers);

    const [row] = await this.db
      .insert(sessions)
      .values({ customerId, surveyVersion: this.survey.version })
      .onConflictDoNothing()
      .returning();
    if (row) return this.toView(row, []);
    // гонка: кто-то создал параллельно
    return this.getOrCreate(customerId);
  }

  private async loadActive(customerId: string) {
    const row = await this.db.query.sessions.findFirst({
      where: and(eq(sessions.customerId, customerId), eq(sessions.status, "active")),
      with: { answers: true },
    });
    if (!row) throw new AppError("NOT_FOUND", "Активная сессия не найдена");
    if (row.surveyVersion !== this.survey.version) {
      // Сессия начата на другой версии конфига: продолжать нельзя — сервер держит в памяти только текущую.
      throw new AppError(
        "SURVEY_VERSION_MISMATCH",
        "Сессия начата на другой версии опросника; начните заново",
        {
          session: row.surveyVersion,
          current: this.survey.version,
        },
      );
    }
    return row;
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

  private toView(row: SessionRow, rows: (typeof answers.$inferSelect)[]): SessionView {
    const state = this.toState(row, rows);
    return {
      sessionId: row.id,
      surveyVersion: row.surveyVersion,
      stage: row.stage,
      activeCategory: (row.activeCategory as CategoryCode | null) ?? null,
      answers: state.answers,
      derived: derive(this.survey, state),
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
    const r = applyAnswer(this.survey, state, questionKey, { ...input, answeredAt: now.toISOString() });
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
    return { ...this.toView(fresh, fresh.answers), genderReset: r.genderReset };
  }

  // ── завершение этапов ───────────────────────────────────────────
  async completeBase(customerId: string): Promise<BeautyProfile> {
    const row = await this.loadActive(customerId);
    const state = this.toState(row, row.answers);
    if (!isBaseAnswered(this.survey, state)) {
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
    if (!findBranch(this.survey, gender, category)) {
      throw new AppError("BRANCH_NOT_AVAILABLE", `Категория ${category} недоступна`, { gender, category });
    }
    await this.db
      .update(sessions)
      .set({ stage: "passport", activeCategory: category, updatedAt: new Date() })
      .where(eq(sessions.id, row.id));
    const fresh = await this.loadActive(customerId);
    return this.toView(fresh, fresh.answers);
  }

  async completePassport(customerId: string, category: CategoryCode): Promise<BeautyProfile> {
    const row = await this.loadActive(customerId);
    const state = this.toState(row, row.answers);
    const gender = getGender(state);
    if (!state.baseCompleted || !gender) throw new AppError("STAGE_NOT_COMPLETE", "Сначала завершите базу");
    if (!getBranchQuestions(this.survey, gender, category)) {
      throw new AppError("BRANCH_NOT_AVAILABLE", `Категория ${category} недоступна`, { gender, category });
    }
    if (!isBranchAnswered(this.survey, state, category)) {
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
    row: SessionRow,
    state: SurveyState,
    patch: { stage: SessionRow["stage"]; activeCategory: string | null },
  ): Promise<BeautyProfile> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
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

      const profile = buildProfile(this.survey, state, {
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
  async reset(customerId: string): Promise<SessionView> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(and(eq(sessions.customerId, customerId), eq(sessions.status, "active")));
      await tx.insert(sessions).values({ customerId, surveyVersion: this.survey.version });
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

  /** Удаление архивных сессий и событий старше retentionDays (ТЗ 9.3). */
  async purgeOld(retentionDays: number): Promise<number> {
    const r = await this.db.execute(sql`
      DELETE FROM sessions WHERE status = 'archived' AND archived_at < now() - make_interval(days => ${retentionDays})`);
    await this.db.execute(sql`
      DELETE FROM analytics_events WHERE server_ts < now() - make_interval(days => ${retentionDays})`);
    return Number((r as unknown as { count?: number }).count ?? 0);
  }
}
