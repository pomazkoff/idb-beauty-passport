import type { Option, Question } from "@idb/survey-config";
import { Check, Select, Text } from "../components/ui.jsx";
import type { Frozen } from "../model.js";
import { nextOptionCode } from "../model.js";

const VOTES = [
  { value: "E", label: "E · Эмоциональный" },
  { value: "P", label: "P · Прагматичный" },
  { value: "L", label: "L · Премиальный" },
  { value: "M", label: "M · Не подходит / несколько" },
] as const;

/**
 * Список вариантов одного вопроса (для одного пола, если варианты раздельные).
 * Коды генерируются из текста и замораживаются после публикации.
 */
export function OptionsEditor({
  question,
  options,
  onChange,
  frozen,
  readOnly,
  kind,
}: {
  question: Question;
  options: Option[];
  onChange: (next: Option[]) => void;
  frozen: Frozen;
  readOnly: boolean;
  kind: "plain" | "psycho" | "category";
}) {
  const frozenCodes = frozen.options.get(question.key) ?? new Set<string>();
  const isMulti = question.type === "multi";

  const update = (i: number, patch: Partial<Option>) => {
    const next = options.map((o, j) => (j === i ? { ...o, ...patch } : o));
    onChange(next);
  };
  const setTitle = (i: number, title: string) => {
    const o = options[i]!;
    const patch: Partial<Option> = { title };
    // код следует за текстом, пока вариант не опубликован
    if (!frozenCodes.has(o.code))
      patch.code = nextOptionCode(title, { ...question, options: options.filter((_, j) => j !== i) });
    update(i, patch);
  };
  const add = () =>
    onChange([...options, { code: nextOptionCode(`option ${options.length + 1}`, question), title: "" }]);
  const remove = (i: number) => onChange(options.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div>
      {options.map((o, i) => {
        const locked = frozenCodes.has(o.code);
        return (
          <div className={`opt-row ${o.deprecated ? "deprecated" : ""}`} key={`${o.code}-${i}`}>
            <div className="num">{i + 1}</div>
            <Text
              value={o.title}
              placeholder="Текст варианта"
              disabled={readOnly}
              onChange={(v) => setTitle(i, v)}
            />
            <Text
              value={o.subtitle ?? ""}
              placeholder="Подзаголовок (необязательно)"
              disabled={readOnly}
              onChange={(v) => update(i, { subtitle: v || undefined })}
            />
            <div>
              {kind === "psycho" ? (
                <Select
                  value={(o.vote ?? "E") as "E" | "P" | "L" | "M"}
                  options={[...VOTES]}
                  disabled={readOnly || locked}
                  onChange={(v) => update(i, { vote: v, code: v })}
                />
              ) : kind === "category" ? (
                <Text value={o.categoryCode ?? ""} mono disabled onChange={() => {}} />
              ) : (
                <Text
                  value={o.code}
                  mono
                  disabled={readOnly || locked}
                  hint={locked ? "код опубликован" : "код для ENSI"}
                  onChange={(v) => update(i, { code: v })}
                />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
              {isMulti ? (
                <Check
                  label="исключает остальные"
                  checked={Boolean(o.exclusive)}
                  disabled={readOnly}
                  onChange={(v) => update(i, { exclusive: v || undefined })}
                />
              ) : null}
              {locked ? (
                <Check
                  label="скрыт (deprecated)"
                  checked={Boolean(o.deprecated)}
                  disabled={readOnly}
                  onChange={(v) => update(i, { deprecated: v || undefined })}
                />
              ) : kind === "plain" && !readOnly ? (
                <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(i)}>
                  удалить
                </button>
              ) : null}
              {!readOnly ? (
                <span className="inline">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title="выше"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => move(i, 1)}
                    disabled={i === options.length - 1}
                    title="ниже"
                  >
                    ↓
                  </button>
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      {kind === "plain" && !readOnly ? (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={add}>
          + Вариант
        </button>
      ) : null}
    </div>
  );
}
