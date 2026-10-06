import type { Branch, CategoryCode, GenderCode, Question, Survey, Widget } from "@idb/survey-config";
import { Check, Num, Text } from "../components/ui.jsx";
import {
  CATEGORY_CODES,
  type Frozen,
  GENDER_LABEL,
  emptyQuestion,
  nextQuestionKey,
  nextWidgetCode,
  setIn,
} from "../model.js";
import { QuestionEditor, type QuestionKind } from "./QuestionEditor.jsx";

type P = { survey: Survey; onChange: (s: Survey) => void; frozen: Frozen; readOnly: boolean };

// ── База ─────────────────────────────────────────────────────────────
export function BaseEditor({ survey, onChange, frozen, readOnly }: P) {
  const kinds: QuestionKind[] = ["gender", "psycho", "psycho", "psycho", "category"];
  return (
    <div>
      <h2>Этап 1 · Базовые вопросы</h2>
      <p className="lock">
        Пять вопросов фиксированы: пол, три вопроса психотипа (у каждого варианта — голос E/P/L/M), категория.
        Для психотипа и категории тексты и варианты задаются отдельно для женщин и мужчин. В третьем вопросе
        не должно быть варианта «не подходит» (M).
      </p>
      {survey.base.map((q, i) => (
        <QuestionEditor
          key={q.key}
          question={q}
          kind={kinds[i]!}
          frozen={frozen}
          readOnly={readOnly || kinds[i] === "gender"}
          onChange={(nq) => onChange(setIn(survey, ["base", i], nq))}
        />
      ))}
    </div>
  );
}

// ── Категории ────────────────────────────────────────────────────────
export function CategoriesEditor({ survey, onChange, readOnly }: P) {
  return (
    <div>
      <h2>Категории Паспорта</h2>
      <p className="lock">
        Подпись категории для каждого пола — как в вопросе 5. Пустая подпись = категория полу недоступна (так
        у мужчин нет макияжа).
      </p>
      <table>
        <thead>
          <tr>
            <th>Код</th>
            <th>Женщины</th>
            <th>Мужчины</th>
          </tr>
        </thead>
        <tbody>
          {survey.categories.map((c, i) => (
            <tr key={c.code}>
              <td className="mono">{c.code}</td>
              {(["female", "male"] as GenderCode[]).map((g) => (
                <td key={g}>
                  <Text
                    value={c.label[g] ?? ""}
                    disabled={readOnly}
                    placeholder="недоступна"
                    onChange={(v) => onChange(setIn(survey, ["categories", i, "label", g], v || undefined))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lock">
        Синхронизируйте с вариантами вопроса 5 в базе: для каждой доступной категории должен быть вариант с
        таким категорийным кодом.
      </p>
    </div>
  );
}

// ── Ветки ────────────────────────────────────────────────────────────
export function BranchEditor({ survey, onChange, frozen, readOnly, branchId }: P & { branchId: string }) {
  const bi = survey.branches.findIndex((b) => b.id === branchId);
  const b = survey.branches[bi];
  if (!b) return <div className="empty">Ветка не найдена</div>;
  const set = (patch: Partial<Branch>) => onChange(setIn(survey, ["branches", bi], { ...b, ...patch }));
  const setQ = (qi: number, q: Question) => set({ questions: b.questions.map((x, j) => (j === qi ? q : x)) });
  const move = (qi: number, d: -1 | 1) => {
    const j = qi + d;
    if (j < 0 || j >= b.questions.length) return;
    const qs = [...b.questions];
    [qs[qi], qs[j]] = [qs[j]!, qs[qi]!];
    set({ questions: qs });
  };
  const add = () => {
    const key = nextQuestionKey(b.category, `вопрос ${b.questions.length + 1}`, survey, b.genders[0]!);
    set({ questions: [...b.questions, emptyQuestion(key, `${survey.ui.passportBlockPrefix}${b.name}`, "")] });
  };
  const rename = (name: string) =>
    set({
      name,
      questions: b.questions.map((q) => ({ ...q, block: `${survey.ui.passportBlockPrefix}${name}` })),
    });
  const toggleGender = (g: GenderCode, on: boolean) => {
    const genders = on ? ([...new Set([...b.genders, g])] as GenderCode[]) : b.genders.filter((x) => x !== g);
    if (genders.length) set({ genders });
  };
  const onTopic = (qi: number, input: Question) => {
    let q = input;
    // ключ следует за темой, пока вопрос не опубликован
    if (!frozen.questions.has(b.questions[qi]!.key) && q.topic !== b.questions[qi]!.topic) {
      const others = {
        ...survey,
        branches: survey.branches.map((x, j) =>
          j === bi ? { ...x, questions: x.questions.filter((_, k) => k !== qi) } : x,
        ),
      };
      q = { ...q, key: nextQuestionKey(b.category, q.topic ?? "", others, b.genders[0]!) };
    }
    setQ(qi, q);
  };
  const removeBranch = () => onChange({ ...survey, branches: survey.branches.filter((_, j) => j !== bi) });
  const anyFrozen = b.questions.some((q) => frozen.questions.has(q.key));

  return (
    <div>
      <h2>
        Ветка <span className="mono">{b.id}</span>
      </h2>
      <div className="row c3">
        <Text
          label="Название (подпись в прогресс-баре)"
          value={b.name}
          disabled={readOnly}
          onChange={rename}
        />
        <div className="field">
          <span className="hint" style={{ fontWeight: 600 }}>
            Пол
          </span>
          <div className="inline">
            {(["female", "male"] as GenderCode[]).map((g) => (
              <Check
                key={g}
                label={GENDER_LABEL[g]}
                checked={b.genders.includes(g)}
                disabled={readOnly}
                onChange={(v) => toggleGender(g, v)}
              />
            ))}
          </div>
          <span className="hint">
            Категория: <span className="mono">{b.category}</span>. Одна ветка на пару пол × категория.
          </span>
        </div>
        <div className="field">
          <span className="hint" style={{ fontWeight: 600 }}>
            Флаги
          </span>
          <Check
            label="вопросы дописаны (плашка)"
            checked={Boolean(b.draft)}
            disabled={readOnly}
            onChange={(v) =>
              set({
                draft: v || undefined,
                questions: b.questions.map((q) => ({ ...q, draft: v || undefined })),
              })
            }
          />
        </div>
      </div>
      <h3>Вопросы · {b.questions.length}</h3>
      {b.questions.map((q, qi) => (
        <QuestionEditor
          // ключ по позиции: key вопроса меняется вместе с темой до публикации, а карточка должна остаться смонтированной
          key={`${b.id}-${qi}`}
          index={qi}
          question={q}
          kind="plain"
          frozen={frozen}
          readOnly={readOnly}
          keyEditable
          canDelete
          onDelete={() => set({ questions: b.questions.filter((_, j) => j !== qi) })}
          onMove={(d) => move(qi, d)}
          onChange={(nq) => onTopic(qi, nq)}
        />
      ))}
      {!readOnly ? (
        <div className="inline" style={{ justifyContent: "space-between", marginTop: 10 }}>
          <button type="button" className="btn" onClick={add}>
            + Вопрос
          </button>
          {anyFrozen ? (
            <span className="lock">ветка опубликована — удалить нельзя</span>
          ) : (
            <button type="button" className="btn btn-ghost btn-danger" onClick={removeBranch}>
              Удалить ветку
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function NewBranch({
  survey,
  onChange,
  onCreated,
}: { survey: Survey; onChange: (s: Survey) => void; onCreated: (id: string) => void }) {
  const free: { g: GenderCode; c: CategoryCode }[] = [];
  for (const g of ["female", "male"] as GenderCode[]) {
    for (const c of CATEGORY_CODES) {
      if (!survey.branches.some((b) => b.category === c && b.genders.includes(g))) free.push({ g, c });
    }
  }
  if (!free.length) return null;
  const create = (g: GenderCode, c: CategoryCode) => {
    const id = `${g}_${c}`;
    const name = survey.categories.find((x) => x.code === c)?.label[g] ?? c;
    const key = nextQuestionKey(c, "вопрос 1", survey, g);
    const branch: Branch = {
      id,
      genders: [g],
      category: c,
      name,
      questions: [emptyQuestion(key, `${survey.ui.passportBlockPrefix}${name}`, "")],
    };
    onChange({ ...survey, branches: [...survey.branches, branch] });
    onCreated(id);
  };
  return (
    <div className="card">
      <h2>Добавить ветку</h2>
      <div className="inline">
        {free.map(({ g, c }) => (
          <button type="button" key={`${g}_${c}`} className="btn btn-sm" onClick={() => create(g, c)}>
            {GENDER_LABEL[g]} · {c}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Психотипы ────────────────────────────────────────────────────────
export function PsychotypesEditor({ survey, onChange, readOnly }: P) {
  return (
    <div>
      <h2>Психотипы</h2>
      {(["E", "P", "L", "M"] as const).map((k) => (
        <div className="card" key={k}>
          <h3 style={{ marginTop: 0 }}>{k}</h3>
          <Text
            label="Название"
            value={survey.psychotypes[k].name}
            disabled={readOnly}
            onChange={(v) => onChange(setIn(survey, ["psychotypes", k, "name"], v))}
          />
          <Text
            label="Описание"
            value={survey.psychotypes[k].description}
            multiline
            disabled={readOnly}
            onChange={(v) => onChange(setIn(survey, ["psychotypes", k, "description"], v))}
          />
        </div>
      ))}
    </div>
  );
}

// ── Виджеты ──────────────────────────────────────────────────────────
export function WidgetsEditor({ survey, onChange, frozen, readOnly }: P) {
  const set = (i: number, patch: Partial<Widget>) =>
    onChange(setIn(survey, ["widgets", i], { ...survey.widgets[i]!, ...patch }));
  const seg = (w: Widget, t: "E" | "P" | "L") => w.segment !== "all" && w.segment.includes(t);
  const toggle = (i: number, t: "E" | "P" | "L", on: boolean) => {
    const w = survey.widgets[i]!;
    const cur = w.segment === "all" ? [] : [...w.segment];
    const next = on ? [...new Set([...cur, t])] : cur.filter((x) => x !== t);
    set(i, { segment: next.length ? (next as ("E" | "P" | "L")[]) : "all" });
  };
  const add = () => {
    const n = Math.max(0, ...survey.widgets.map((w) => w.n)) + 1;
    onChange({
      ...survey,
      widgets: [
        ...survey.widgets,
        { n, code: nextWidgetCode(`widget ${n}`, survey), name: "", segment: "all", why: "" },
      ],
    });
  };
  return (
    <div>
      <h2>Виджеты ЛК</h2>
      <p className="lock">
        «Для всех» — виджет показывается каждому. Иначе отметьте психотипы; смешанный (M) видит все
        неуниверсальные.
      </p>
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Название</th>
            <th>Зачем</th>
            <th>Код</th>
            <th>Сегмент</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {survey.widgets.map((w, i) => {
            const locked = frozen.widgets.has(w.code);
            return (
              <tr key={w.code}>
                <td style={{ width: 60 }}>
                  <Num label="" value={w.n} disabled={readOnly} onChange={(v) => set(i, { n: v })} />
                </td>
                <td>
                  <Text
                    value={w.name}
                    disabled={readOnly}
                    onChange={(v) =>
                      set(i, {
                        name: v,
                        ...(locked
                          ? {}
                          : {
                              code: nextWidgetCode(v, {
                                ...survey,
                                widgets: survey.widgets.filter((_, j) => j !== i),
                              }),
                            }),
                      })
                    }
                  />
                </td>
                <td>
                  <Text value={w.why} disabled={readOnly} onChange={(v) => set(i, { why: v })} />
                </td>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>
                  {w.code}
                  {locked ? <div className="lock">опубликован</div> : null}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Check
                    label="для всех"
                    checked={w.segment === "all"}
                    disabled={readOnly}
                    onChange={(v) => set(i, { segment: v ? "all" : ["E"] })}
                  />
                  <br />
                  {(["E", "P", "L"] as const).map((t) => (
                    <Check
                      key={t}
                      label={t}
                      checked={seg(w, t)}
                      disabled={readOnly || w.segment === "all"}
                      onChange={(v) => toggle(i, t, v)}
                    />
                  ))}
                </td>
                <td>
                  {!readOnly && !locked ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost btn-danger"
                      onClick={() =>
                        onChange({ ...survey, widgets: survey.widgets.filter((_, j) => j !== i) })
                      }
                    >
                      удалить
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly ? (
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={add}>
          + Виджет
        </button>
      ) : null}
    </div>
  );
}

// ── Экраны, интерфейс, заполненность ─────────────────────────────────
const SCREEN_LABELS: Record<string, string> = {
  intro: "Экран приветствия",
  result1: "Результат после базы",
  result2: "Результат после категории",
  meter: "Индикатор заполненности",
  widgets: "Заголовки списков виджетов",
};

export function ScreensEditor({ survey, onChange, readOnly }: P) {
  const screens = survey.screens as unknown as Record<string, Record<string, string | string[]>>;
  return (
    <div>
      <h2>Тексты экранов</h2>
      <p className="lock">
        В полях с суффиксом Html допустима разметка <code>&lt;em&gt;</code> (акцент фирменным цветом) и{" "}
        <code>&lt;b&gt;</code>. В шаблоне «Добавьте ещё категорию»
        {" {count}"} заменяется числом оставшихся категорий.
      </p>
      {Object.entries(screens).map(([sk, fields]) => (
        <div className="card" key={sk}>
          <h3 style={{ marginTop: 0 }}>{SCREEN_LABELS[sk] ?? sk}</h3>
          {Object.entries(fields).map(([fk, val]) =>
            Array.isArray(val) ? (
              <Text
                key={fk}
                label={`${fk} (по строке на пункт)`}
                value={val.join("\n")}
                multiline
                disabled={readOnly}
                onChange={(v) => onChange(setIn(survey, ["screens", sk, fk], v.split("\n").filter(Boolean)))}
              />
            ) : (
              <Text
                key={fk}
                label={fk}
                value={val}
                multiline={val.length > 80}
                disabled={readOnly}
                onChange={(v) => onChange(setIn(survey, ["screens", sk, fk], v))}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

export function UiEditor({ survey, onChange, readOnly }: P) {
  const ui = survey.ui as unknown as Record<string, string>;
  return (
    <div>
      <h2>Интерфейс</h2>
      <div className="card">
        {Object.entries(ui).map(([k, v]) => (
          <Text
            key={k}
            label={k}
            value={v}
            disabled={readOnly}
            onChange={(nv) => onChange(setIn(survey, ["ui", k], nv))}
          />
        ))}
      </div>
      <h2 style={{ marginTop: 20 }}>Заполненность</h2>
      <div className="card row c3">
        <Num
          label="База, %"
          value={survey.completeness.basePct}
          disabled={readOnly}
          onChange={(v) => onChange(setIn(survey, ["completeness", "basePct"], v))}
        />
        <Num
          label="За категорию, %"
          value={survey.completeness.perCategoryPct}
          disabled={readOnly}
          onChange={(v) => onChange(setIn(survey, ["completeness", "perCategoryPct"], v))}
        />
        <Num
          label="Категорий до 100 %"
          value={survey.completeness.maxCategories}
          disabled={readOnly}
          onChange={(v) => onChange(setIn(survey, ["completeness", "maxCategories"], v))}
        />
      </div>
      <p className="lock">База + за категорию × категорий должно давать ровно 100.</p>
    </div>
  );
}
