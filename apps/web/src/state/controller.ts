/**
 * Контроллер опросника: состояние экрана, очередь вопросов, оптимистичные ответы,
 * восстановление сессии, аналитика. Чистый TS без React — тестируется отдельно.
 */
import type { AnswerRecord, BeautyProfile } from "@idb/core";
import type { Analytics, EventName } from "../analytics.js";
import { type ApiClient, ApiRequestError } from "../api/client.js";
import type { ApiQuestion, Category, Gender, SessionStage, SessionView, SurveyConfig } from "../api/types.js";

export type Phase = "loading" | "intro" | "question" | "result1" | "result2" | "error";

export type QuizState = {
  phase: Phase;
  survey: SurveyConfig | null;
  session: SessionView | null;
  /** Ключ показанного вопроса (для «Назад»); null — первый неотвеченный. */
  cursor: string | null;
  multiSel: string[];
  postponed: boolean;
  pending: number;
  saveError: string | null;
  fatalError: string | null;
  lastProfile: BeautyProfile | null;
};

export type QuizEvents = {
  onBaseCompleted?: (profile: BeautyProfile) => void;
  onCategoryCompleted?: (profile: BeautyProfile) => void;
  onClosed?: () => void;
};

type Listener = () => void;

export class QuizController {
  private state: QuizState = {
    phase: "loading",
    survey: null,
    session: null,
    cursor: null,
    multiSel: [],
    postponed: false,
    pending: 0,
    saveError: null,
    fatalError: null,
    lastProfile: null,
  };
  private listeners = new Set<Listener>();
  /** Последовательная очередь сохранений — порядок ответов важен для сервера. */
  private chain: Promise<unknown> = Promise.resolve();
  private shownAt = 0;
  private shownKey: string | null = null;
  /** Растёт при локальном сбросе по смене пола: ответы сервера на более ранние запросы игнорируются. */
  private resetEpoch = 0;
  private resumed = false;

  constructor(
    private readonly api: ApiClient,
    private readonly analytics: Analytics,
    private readonly events: QuizEvents = {},
  ) {}

  // ── подписка ──────────────────────────────────────────────────────
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(patch: Partial<QuizState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ── загрузка и восстановление (ТЗ 8.3) ───────────────────────────
  async init(): Promise<void> {
    try {
      const session = await this.api.getSession();
      const survey = await this.api.getSurvey(session.derived.gender);
      this.analytics.setCommon({
        survey_version: survey.version,
        session_id: session.sessionId,
        gender: session.derived.gender,
      });
      this.set({ survey, session, phase: this.phaseFor(session.stage) });
      if (this.state.phase === "question") this.afterQueueChange();
      if (session.stage === "result1" || session.stage === "result2") {
        this.analytics.track("passport_announce_shown", { psychotype: session.derived.psychotype });
        try {
          const view = await this.api.getProfile();
          if (view.profile) {
            this.set({ lastProfile: view.profile });
            if (session.stage === "result2") this.events.onCategoryCompleted?.(view.profile);
            else this.events.onBaseCompleted?.(view.profile);
          }
        } catch {
          /* экран результата уже собран из сессии */
        }
      }
      this.resumed = true;
    } catch (e) {
      this.set({ phase: "error", fatalError: (e as Error).message });
    }
  }

  private phaseFor(stage: SessionStage): Phase {
    switch (stage) {
      case "intro":
        return "intro";
      case "base":
      case "passport":
        return "question";
      case "result1":
        return "result1";
      case "result2":
        return "result2";
    }
  }

  // ── очередь вопросов ──────────────────────────────────────────────
  get queue(): ApiQuestion[] {
    const { survey, session } = this.state;
    if (!survey || !session) return [];
    if (session.stage === "passport" && session.activeCategory) {
      const b = survey.branches.find((x) => x.category === session.activeCategory);
      return b ? b.questions.map((q) => ({ ...q, stage: "passport" as const, category: b.category })) : [];
    }
    return survey.base;
  }

  get current(): ApiQuestion | null {
    const q = this.queue;
    if (!q.length) return null;
    if (this.state.cursor) return q.find((x) => x.key === this.state.cursor) ?? null;
    return q.find((x) => !this.isAnswered(x.key)) ?? null;
  }

  get index(): number {
    const c = this.current;
    return c ? this.queue.findIndex((q) => q.key === c.key) : this.queue.length;
  }

  isAnswered(key: string): boolean {
    const a = this.state.session?.answers[key];
    return !!a && (a.skipped || a.optionCodes.length > 0);
  }

  private afterQueueChange() {
    const c = this.current;
    if (!c) {
      // всё отвечено, а стадия не закрыта (например, упал complete) — закрываем
      void this.finishStage();
      return;
    }
    const saved = this.state.session?.answers[c.key];
    const sel = c.type === "multi" && saved && !saved.skipped ? [...saved.optionCodes] : [];
    this.set({ multiSel: sel });
    if (this.shownKey !== c.key) {
      this.shownKey = c.key;
      this.shownAt = Date.now();
      this.analytics.track("quiz_question_shown", { stage: c.stage, question_key: c.key, index: this.index });
    }
  }

  // ── действия пользователя ─────────────────────────────────────────
  start() {
    if (!this.state.session) return;
    this.analytics.track("quiz_started");
    this.set({ phase: "question", cursor: null, session: { ...this.state.session, stage: "base" } });
    this.afterQueueChange();
  }

  selectSingle(code: string) {
    const q = this.current;
    if (!q || q.type !== "single") return;
    this.save(q, [code], false);
    // Пол выбран впервые или изменён: очередь базы перестроится после загрузки конфига под пол (см. save).
    if (q.key === "gender" && this.state.survey?.gender !== code) {
      this.set({ cursor: null });
      this.scrollTop();
      return;
    }
    this.advance(q.key);
  }

  toggleMulti(code: string) {
    const q = this.current;
    if (!q || q.type !== "multi") return;
    const opt = q.options.find((o) => o.code === code);
    let sel = this.state.multiSel;
    if (sel.includes(code)) sel = sel.filter((c) => c !== code);
    else if (opt?.exclusive) sel = [code];
    else sel = [...sel.filter((c) => !q.options.find((o) => o.code === c)?.exclusive), code];
    this.set({ multiSel: sel });
  }

  next() {
    const q = this.current;
    if (!q || q.type !== "multi" || !this.state.multiSel.length) return;
    this.save(q, this.state.multiSel, false);
    this.advance(q.key);
  }

  skip() {
    const q = this.current;
    if (!q || !q.skippable) return;
    this.analytics.track("quiz_question_skipped", { stage: q.stage, question_key: q.key });
    this.save(q, [], true);
    this.advance(q.key);
  }

  back() {
    const i = this.index;
    if (i <= 0) return;
    const prev = this.queue[i - 1]!;
    this.analytics.track("quiz_back", { stage: prev.stage, from_index: i });
    this.set({ cursor: prev.key });
    this.afterQueueChange();
    this.scrollTop();
  }

  startPassport(category: Category, added = false) {
    const s = this.state.session;
    if (!s) return;
    this.analytics.track(added ? "passport_category_added" : "passport_started", {
      category,
      ...(added ? { already_done: s.derived.completedCategories } : {}),
    });
    this.set({
      phase: "question",
      cursor: null,
      postponed: false,
      session: { ...s, stage: "passport", activeCategory: category },
    });
    this.enqueue(async () => {
      const session = await this.api.startPassport(category);
      this.set({ session: { ...session, stage: "passport", activeCategory: category } });
    });
    this.afterQueueChange();
    this.scrollTop();
  }

  postpone() {
    this.analytics.track("passport_postponed", { category: this.state.session?.derived.primaryCategory });
    this.set({ postponed: true });
  }

  async reset() {
    this.set({ phase: "loading", cursor: null, multiSel: [], postponed: false, lastProfile: null });
    await this.chain.catch(() => {});
    try {
      const session = await this.api.reset();
      const survey = await this.api.getSurvey(null);
      this.shownKey = null;
      this.analytics.setCommon({ session_id: session.sessionId, gender: null });
      this.set({ session, survey, phase: "intro" });
      this.scrollTop();
    } catch (e) {
      this.set({ phase: "error", fatalError: (e as Error).message });
    }
  }

  // ── сохранение и переходы ─────────────────────────────────────────
  private save(q: ApiQuestion, codes: string[], skipped: boolean) {
    const s = this.state.session;
    if (!s) return;
    const timeMs = this.shownAt ? Date.now() - this.shownAt : undefined;
    if (!skipped) {
      this.analytics.track("quiz_question_answered", {
        stage: q.stage,
        question_key: q.key,
        answer_codes: codes,
        time_ms: timeMs,
      });
    }
    const prevGender = s.derived.gender;
    const record: AnswerRecord = { optionCodes: codes, skipped };
    // Оптимистично: пол меняется → локально сбрасываем остальное (как сделает сервер)
    const genderChanged = q.key === "gender" && prevGender !== null && prevGender !== codes[0];
    const answers = genderChanged ? { gender: record } : { ...s.answers, [q.key]: record };
    if (genderChanged) this.resetEpoch++;
    const epoch = this.resetEpoch;
    this.set({
      session: {
        ...s,
        answers,
        ...(genderChanged
          ? {
              derived: {
                ...s.derived,
                gender: codes[0] as Gender,
                completedCategories: [],
                completenessPct: 0,
              },
            }
          : {}),
      },
    });

    this.enqueue(async () => {
      const { session, genderReset } = await this.api.putAnswer(q.key, codes, skipped, timeMs);
      // Ответ на запрос, отправленный до локального сброса по полу, устарел — локальное состояние новее.
      if (epoch !== this.resetEpoch) return;
      // Сервер сбросил ответы — верим ему; иначе не затираем более новые локальные ответы.
      const answers = genderReset ? session.answers : { ...session.answers, ...this.localNewer(session) };
      const merged = { ...session, answers };
      this.set({
        session: {
          ...merged,
          stage: this.state.session?.stage ?? merged.stage,
          activeCategory: this.state.session?.activeCategory ?? merged.activeCategory,
        },
      });
      if (
        q.key === "gender" &&
        (genderReset || !this.state.survey?.gender || this.state.survey.gender !== session.derived.gender)
      ) {
        const survey = await this.api.getSurvey(session.derived.gender);
        this.analytics.setCommon({ gender: session.derived.gender });
        this.set({ survey });
        this.afterQueueChange();
      }
    });
  }

  /** Локальные ответы на вопросы, которые сервер ещё не видел (ещё в очереди). */
  private localNewer(server: SessionView): Record<string, AnswerRecord> {
    const out: Record<string, AnswerRecord> = {};
    const local = this.state.session?.answers ?? {};
    for (const [k, v] of Object.entries(local)) if (!server.answers[k]) out[k] = v;
    return out;
  }

  private enqueue(task: () => Promise<void>) {
    this.set({ pending: this.state.pending + 1, saveError: null });
    this.chain = this.chain
      .catch(() => {})
      .then(task)
      .catch((e: unknown) => {
        const msg = e instanceof ApiRequestError ? e.error.message : (e as Error).message;
        // Конфиг обновился на сервере — продолжать нельзя, предлагаем «Пройти заново» (DECISIONS).
        if (e instanceof ApiRequestError && e.error.code === "SURVEY_VERSION_MISMATCH") {
          this.set({ phase: "error", fatalError: msg, saveError: null });
          return;
        }
        this.set({ saveError: msg });
      })
      .finally(() => this.set({ pending: Math.max(0, this.state.pending - 1) }));
  }

  /** Переход к вопросу после `fromKey` (ключ только что отвеченного; индекс нельзя брать из current — он уже сдвинулся). */
  private advance(fromKey: string) {
    const i = this.queue.findIndex((q) => q.key === fromKey);
    const nextQ = this.queue[i + 1];
    if (nextQ) {
      this.set({ cursor: nextQ.key });
      this.afterQueueChange();
      this.scrollTop();
      return;
    }
    void this.finishStage();
  }

  private async finishStage() {
    const s = this.state.session;
    if (!s) return;
    const stage = s.stage;
    this.set({ phase: "loading", cursor: null });
    await this.chain.catch(() => {});
    try {
      if (stage === "passport" && s.activeCategory) {
        const profile = await this.api.completePassport(s.activeCategory);
        this.analytics.track("passport_category_completed", {
          category: s.activeCategory,
          completeness_pct: profile.completeness_pct,
        });
        const session = await this.api.getSession();
        this.set({ session, lastProfile: profile, phase: "result2" });
        this.events.onCategoryCompleted?.(profile);
      } else {
        const profile = await this.api.completeBase();
        this.analytics.track("quiz_base_completed", {
          psychotype: profile.psychotype.code,
          category: profile.primary_category,
        });
        const session = await this.api.getSession();
        this.set({ session, lastProfile: profile, phase: "result1", postponed: false });
        this.analytics.track("passport_announce_shown", { psychotype: profile.psychotype.code });
        this.events.onBaseCompleted?.(profile);
      }
      this.shownKey = null;
      this.scrollTop();
    } catch (e) {
      // Не все ответы дошли (409) — возвращаемся к первому неотвеченному.
      const session = await this.api.getSession().catch(() => null);
      if (session) this.set({ session });
      this.set({ phase: "question", cursor: null, saveError: (e as Error).message });
      if (!this.current) {
        this.set({ phase: "error", fatalError: (e as Error).message });
        return;
      }
      this.afterQueueChange();
    }
  }

  track(name: EventName, params?: Record<string, unknown>) {
    this.analytics.track(name, params);
  }

  private scrollTop() {
    try {
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* jsdom */
    }
  }

  destroy() {
    this.analytics.destroy();
    this.events.onClosed?.();
  }
}
