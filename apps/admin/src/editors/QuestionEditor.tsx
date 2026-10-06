import type { GenderCode, Option, Question } from "@idb/survey-config";
import { useState } from "react";
import { Check, Select, Text } from "../components/ui.jsx";
import { type Frozen, GENDER_LABEL } from "../model.js";
import { OptionsEditor } from "./OptionsEditor.jsx";

export type QuestionKind = "plain" | "psycho" | "category" | "gender";

/** Редактор одного вопроса: текст (общий или по полу), тип, варианты (общие или по полу). */
export function QuestionEditor({
  question,
  onChange,
  frozen,
  readOnly,
  kind,
  canDelete,
  onDelete,
  onMove,
  index,
  keyEditable,
}: {
  question: Question;
  onChange: (q: Question) => void;
  frozen: Frozen;
  readOnly: boolean;
  kind: QuestionKind;
  canDelete?: boolean;
  onDelete?: () => void;
  onMove?: (d: -1 | 1) => void;
  index?: number;
  keyEditable?: boolean;
}) {
  // новые (пустые) вопросы открыты сразу
  const [open, setOpen] = useState(kind !== "plain" || !question.text);
  const byGender = typeof question.text !== "string" || !Array.isArray(question.options);
  const locked = frozen.questions.has(question.key);
  const title = typeof question.text === "string" ? question.text : question.text.female;

  const setText = (g: GenderCode | null, v: string) => {
    if (g === null) onChange({ ...question, text: v });
    else {
      const t =
        typeof question.text === "string" ? { female: question.text, male: question.text } : question.text;
      onChange({ ...question, text: { ...t, [g]: v } });
    }
  };
  const setOptions = (g: GenderCode | null, v: Option[]) => {
    if (g === null) onChange({ ...question, options: v });
    else {
      const o = Array.isArray(question.options)
        ? { female: question.options, male: question.options }
        : question.options;
      onChange({ ...question, options: { ...o, [g]: v } });
    }
  };
  const toggleByGender = (on: boolean) => {
    if (on) {
      const t = typeof question.text === "string" ? question.text : question.text.female;
      const o = Array.isArray(question.options) ? question.options : question.options.female;
      onChange({
        ...question,
        text: { female: t, male: t },
        options: { female: o, male: structuredClone(o) },
      });
    } else {
      const t = typeof question.text === "string" ? question.text : question.text.female;
      const o = Array.isArray(question.options) ? question.options : question.options.female;
      onChange({ ...question, text: t, options: o });
    }
  };
  const setType = (type: "single" | "multi") => onChange({ ...question, type, skippable: type === "multi" });

  return (
    <div className={`q-card ${open ? "open" : ""}`} id={`q-${question.key}`}>
      <button
        type="button"
        className="q-head"
        style={{ width: "100%", border: "none", background: "none", padding: 0, textAlign: "left" }}
        onClick={() => setOpen(!open)}
      >
        <span className="meta">{index !== undefined ? `${index + 1}.` : ""}</span>
        <span className="title">
          {question.topic ? `${question.topic} — ` : ""}
          {title || <i>без текста</i>}
        </span>
        <span className="meta">
          {question.type === "multi" ? "несколько" : "один"} · <span className="mono">{question.key}</span>
          {question.draft ? " · дописан" : ""}
        </span>
        <span className="meta">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div style={{ marginTop: 12 }}>
          <div className="row c4">
            {kind === "plain" ? (
              <Text
                label="Тема («что узнаём»)"
                value={question.topic ?? ""}
                disabled={readOnly}
                onChange={(v) => onChange({ ...question, topic: v || undefined })}
              />
            ) : (
              <div />
            )}
            <Text
              label="Ключ вопроса"
              value={question.key}
              mono
              disabled={readOnly || locked || !keyEditable}
              hint={locked ? "опубликован — менять нельзя" : "идентификатор для ENSI; генерируется из темы"}
              onChange={(v) => onChange({ ...question, key: v })}
            />
            <Select
              label="Тип"
              value={question.type}
              disabled={readOnly || locked || kind !== "plain"}
              options={[
                { value: "single", label: "Один ответ" },
                { value: "multi", label: "Несколько (можно пропустить)" },
              ]}
              onChange={setType}
            />
            <div className="field">
              <span className="hint" style={{ fontWeight: 600 }}>
                Флаги
              </span>
              <Check
                label="«вопрос дописан»"
                checked={Boolean(question.draft)}
                disabled={readOnly}
                onChange={(v) => onChange({ ...question, draft: v || undefined })}
              />
              {kind === "plain" || kind === "psycho" || kind === "category" ? (
                <Check
                  label="формулировки по полу"
                  checked={byGender}
                  disabled={readOnly || kind !== "plain"}
                  onChange={toggleByGender}
                />
              ) : null}
            </div>
          </div>

          {byGender ? (
            (["female", "male"] as GenderCode[]).map((g) => (
              <div key={g}>
                <h3>{GENDER_LABEL[g]}</h3>
                <Text
                  label="Текст вопроса"
                  value={typeof question.text === "string" ? question.text : question.text[g]}
                  disabled={readOnly}
                  multiline
                  onChange={(v) => setText(g, v)}
                />
                <OptionsEditor
                  question={question}
                  options={Array.isArray(question.options) ? question.options : question.options[g]}
                  onChange={(v) => setOptions(g, v)}
                  frozen={frozen}
                  readOnly={readOnly}
                  kind={kind === "gender" ? "plain" : kind}
                />
              </div>
            ))
          ) : (
            <>
              <Text
                label="Текст вопроса"
                value={question.text as string}
                disabled={readOnly}
                multiline
                onChange={(v) => setText(null, v)}
              />
              <OptionsEditor
                question={question}
                options={question.options as Option[]}
                onChange={(v) => setOptions(null, v)}
                frozen={frozen}
                readOnly={readOnly}
                kind={kind === "gender" ? "plain" : kind}
              />
            </>
          )}

          {!readOnly && (onMove || (canDelete && onDelete)) ? (
            <div className="inline" style={{ marginTop: 10, justifyContent: "flex-end" }}>
              {onMove ? (
                <>
                  <button type="button" className="btn btn-sm" onClick={() => onMove(-1)}>
                    ↑ выше
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => onMove(1)}>
                    ↓ ниже
                  </button>
                </>
              ) : null}
              {canDelete && onDelete ? (
                locked ? (
                  <span className="lock">вопрос опубликован — удалить нельзя, можно скрыть все варианты</span>
                ) : (
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onDelete}>
                    Удалить вопрос
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
