import type { BeautyProfile } from "@idb/core";
import type { ApiQuestion, Category, SessionView, SurveyConfig } from "../api/types.js";

/** Безопасная вставка размеченных текстов из конфига (только наши <em>/<b>). */
const Html = ({
  html,
  as: Tag = "span",
  className,
}: { html: string; as?: "span" | "h1" | "div" | "p"; className?: string }) => (
  // biome-ignore lint/security/noDangerouslySetInnerHtml: разметка только из нашего конфига (<em>/<b>), не из пользовательского ввода
  <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />
);

// ── Intro ────────────────────────────────────────────────────────────
export function Intro({ survey, onStart }: { survey: SurveyConfig; onStart: () => void }) {
  const s = survey.screens.intro;
  return (
    <div className="screen">
      <div className="eyebrow">{s.eyebrow}</div>
      <Html as="h1" html={s.titleHtml} />
      <p className="lead">{s.lead}</p>
      <div className="rcard" style={{ padding: "18px 20px" }}>
        <div className="rlabel">{s.cardLabel}</div>
        <div className="intro-card-text">{s.cardText}</div>
      </div>
      <div className="nav">
        <button type="button" className="btn btn-primary" id="go" onClick={onStart}>
          {s.startLabel}
        </button>
      </div>
    </div>
  );
}

// ── Question ─────────────────────────────────────────────────────────
export function Question({
  survey,
  question,
  index,
  total,
  saved,
  multiSel,
  onSingle,
  onToggle,
  onNext,
  onSkip,
  onBack,
}: {
  survey: SurveyConfig;
  question: ApiQuestion;
  index: number;
  total: number;
  saved?: { optionCodes: string[]; skipped: boolean };
  multiSel: string[];
  onSingle: (code: string) => void;
  onToggle: (code: string) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const ui = survey.ui;
  const isMulti = question.type === "multi";
  const selected = (code: string) =>
    isMulti ? multiSel.includes(code) : !saved?.skipped && saved?.optionCodes[0] === code;
  const role = isMulti ? "checkbox" : "radio";

  // Навигация стрелками внутри группы (ТЗ 8.4)
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(".opt"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div className="screen" key={question.key}>
      {question.draft && survey.flags.showDraftBadge ? <div className="draft">{ui.draftBadge}</div> : null}
      <div className="qtext" id={`q-${question.key}`}>
        {question.text}
      </div>
      <div className="qhint" id={`h-${question.key}`}>
        {isMulti ? ui.hintMulti : ui.hintSingle}
      </div>
      <div
        className={`opts ${isMulti ? "multi" : ""}`}
        role={isMulti ? "group" : "radiogroup"}
        aria-labelledby={`q-${question.key}`}
        aria-describedby={`h-${question.key}`}
        onKeyDown={onKey}
      >
        {question.options.map((o) => (
          <button
            type="button"
            key={o.code}
            className={`opt ${selected(o.code) ? "on" : ""}`}
            role={role}
            aria-checked={selected(o.code)}
            data-code={o.code}
            onClick={() => (isMulti ? onToggle(o.code) : onSingle(o.code))}
          >
            <span className="mark" aria-hidden="true" />
            <span className="olabel">
              <span className="otitle">{o.title}</span>
              {o.subtitle ? <span className="osub">{o.subtitle}</span> : null}
            </span>
          </button>
        ))}
      </div>
      <div className="nav">
        {index > 0 ? (
          <button type="button" className="btn btn-ghost" id="back" onClick={onBack}>
            {ui.backLabel}
          </button>
        ) : null}
        {isMulti ? (
          <button
            type="button"
            className="btn btn-primary"
            id="next"
            disabled={!multiSel.length}
            onClick={onNext}
          >
            {ui.nextLabel}
          </button>
        ) : (
          <span className="single-hint">{ui.singleHint}</span>
        )}
        {isMulti && question.skippable ? (
          <button type="button" className="skip" id="skip" onClick={onSkip}>
            {ui.skipLabel}
          </button>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        Вопрос {index + 1} из {total}
      </span>
    </div>
  );
}

// ── Общие блоки результата ───────────────────────────────────────────
export function Meter({ survey, pct }: { survey: SurveyConfig; pct: number }) {
  const m = survey.screens.meter;
  const next = pct >= 100 ? m.full : pct === survey.completeness.basePct ? m.nextAt40 : m.nextPartial;
  return (
    <div className="meter" data-testid="meter">
      <div className="meter-row">
        <span className="meter-label">{m.label}</span>
        <span className="meter-val" data-testid="meter-val">
          {pct}%
        </span>
      </div>
      {/* biome-ignore lint/a11y/useFocusableInteractive: индикатор только для чтения, фокус не нужен */}
      <div
        className="meter-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={m.label}
      >
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-next">{next}</div>
    </div>
  );
}

export function TypeCard({ survey, code }: { survey: SurveyConfig; code: "E" | "P" | "L" | "M" }) {
  const t = survey.psychotypes[code];
  return (
    <div className="rcard rtype" data-testid="psychotype">
      <div className="rlabel">{survey.screens.result1.typeLabel}</div>
      <div className="rtype-name">{t.name}</div>
      <div className="rtype-desc">{t.description}</div>
    </div>
  );
}

export function Widgets({
  survey,
  priority,
  base,
}: { survey: SurveyConfig; priority: string[]; base: string[] }) {
  const byCode = new Map(survey.widgets.map((w) => [w.code, w]));
  const row = (code: string, prio: boolean) => {
    const w = byCode.get(code);
    if (!w) return null;
    return (
      <div className={`w ${prio ? "prio" : ""}`} key={code} data-widget={code}>
        <div className="wnum">{w.n}</div>
        <div>
          <div className="wname">{w.name}</div>
          <div className="wwhy">{w.why}</div>
        </div>
      </div>
    );
  };
  return (
    <>
      <div className="sect">{survey.screens.widgets.prioritySection}</div>
      <div className="wgrid" data-testid="widgets-priority">
        {priority.map((c) => row(c, true))}
      </div>
      <div className="sect">{survey.screens.widgets.baseSection}</div>
      <div className="wgrid" data-testid="widgets-base">
        {base.map((c) => row(c, false))}
      </div>
    </>
  );
}

/** Таблица «Паспорт · категория»: topic → выбранные варианты через « · », подзаголовок в скобках. */
export function ProfileRows({
  survey,
  session,
  category,
}: { survey: SurveyConfig; session: SessionView; category: Category }) {
  const branch = survey.branches.find((b) => b.category === category);
  if (!branch) return null;
  const rows = branch.questions
    .map((q) => {
      const a = session.answers[q.key];
      if (!a || a.skipped || !a.optionCodes.length) return null;
      const vals = a.optionCodes.map((c) => q.options.find((o) => o.code === c)).filter(Boolean);
      return [
        q.topic ?? q.key,
        vals.map((o) => (o!.subtitle ? `${o!.title} (${o!.subtitle})` : o!.title)).join(" · "),
      ] as const;
    })
    .filter(Boolean) as (readonly [string, string])[];
  if (!rows.length) return null;
  return (
    <>
      <div className="sect">
        {survey.ui.passportBlockPrefix}
        {branch.name}
      </div>
      <div className="rcard prof" data-testid={`profile-${category}`}>
        {rows.map(([k, v]) => (
          <div className="prow" key={k}>
            <div className="pk">{k}</div>
            <div className="pv">{v}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Result 1 ─────────────────────────────────────────────────────────
export function Result1({
  survey,
  session,
  postponed,
  onStartPassport,
  onPostpone,
  onAgain,
}: {
  survey: SurveyConfig;
  session: SessionView;
  profile: BeautyProfile | null;
  postponed: boolean;
  onStartPassport: (c: Category) => void;
  onPostpone: () => void;
  onAgain: () => void;
}) {
  const r = survey.screens.result1;
  const d = session.derived;
  const cat = d.primaryCategory;
  const catName = cat
    ? (survey.categories.find((c) => c.code === cat)?.label[d.gender ?? "female"] ?? cat)
    : "";
  return (
    <div className="screen">
      <div className="eyebrow">{r.eyebrow}</div>
      <Html as="h1" html={r.titleHtml} />
      <p className="lead">{r.lead}</p>
      <Meter survey={survey} pct={d.completenessPct} />
      <TypeCard survey={survey} code={d.psychotype} />
      <Widgets survey={survey} priority={d.widgets.priority} base={d.widgets.base} />

      <div className="announce" data-testid="announce">
        {postponed ? (
          <>
            <div className="ann-title" style={{ margin: 0 }}>
              {r.postponedTitle}
            </div>
            <div className="ann-text" style={{ marginTop: 6 }}>
              {r.postponedText}
            </div>
            <div className="nav" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-primary"
                id="pass2"
                onClick={() => cat && onStartPassport(cat)}
              >
                {r.postponedButton}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ann-eyebrow">{r.announceEyebrow}</div>
            <div className="ann-title">{r.announceTitle}</div>
            <div className="ann-text">{r.announceText}</div>
            <div className="ann-bullets">
              {r.announceBullets.map((b) => (
                <div className="ann-b" key={b}>
                  <span className="ann-dot" />
                  {b}
                </div>
              ))}
            </div>
            <div className="nav" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn btn-primary"
                id="pass"
                onClick={() => cat && onStartPassport(cat)}
                disabled={!cat}
              >
                {r.passportButtonPrefix} {catName}
              </button>
              <button type="button" className="btn btn-ghost" id="later" onClick={onPostpone}>
                {r.laterLabel}
              </button>
            </div>
            <div className="ann-foot">{r.announceFoot}</div>
          </>
        )}
      </div>

      <Html as="div" className="note" html={r.howTypeHtml} />
      <div className="nav">
        <button type="button" className="btn btn-ghost" id="again" onClick={onAgain}>
          {r.againLabel}
        </button>
      </div>
    </div>
  );
}

// ── Result 2 ─────────────────────────────────────────────────────────
export function Result2({
  survey,
  session,
  onAddCategory,
  onAgain,
}: {
  survey: SurveyConfig;
  session: SessionView;
  onAddCategory: (c: Category) => void;
  onAgain: () => void;
}) {
  const r = survey.screens.result2;
  const d = session.derived;
  const gender = d.gender ?? "female";
  const rest = survey.categories.filter((c) => c.label[gender] && !d.completedCategories.includes(c.code));
  return (
    <div className="screen">
      <div className="eyebrow">{r.eyebrow}</div>
      <Html as="h1" html={r.titleHtml} />
      <p className="lead">{r.lead}</p>
      <Meter survey={survey} pct={d.completenessPct} />
      <TypeCard survey={survey} code={d.psychotype} />
      {d.completedCategories.map((c) => (
        <ProfileRows key={c} survey={survey} session={session} category={c} />
      ))}
      <Widgets survey={survey} priority={d.widgets.priority} base={d.widgets.base} />
      {rest.length ? (
        <div className="announce" data-testid="add-category">
          <div className="ann-eyebrow">{r.addEyebrow}</div>
          <div className="ann-title">{r.addTitle}</div>
          <div className="ann-text">{r.addTextTemplate.replace("{count}", String(rest.length))}</div>
          <div className="opts" style={{ marginTop: 14 }}>
            {rest.map((c) => (
              <button
                type="button"
                className="opt"
                key={c.code}
                data-c={c.code}
                onClick={() => onAddCategory(c.code)}
              >
                <span className="mark" aria-hidden="true" />
                <span className="olabel">
                  <span className="otitle">{c.label[gender]}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="nav">
        <button type="button" className="btn btn-ghost" id="again" onClick={onAgain}>
          {survey.screens.result1.againLabel}
        </button>
      </div>
    </div>
  );
}
