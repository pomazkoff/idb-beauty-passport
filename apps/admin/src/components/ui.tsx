import { type ReactNode, useEffect, useId } from "react";

export function Text({
  label,
  value,
  onChange,
  disabled,
  hint,
  mono,
  placeholder,
  multiline,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
  mono?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const cls = mono ? "mono" : undefined;
  const id = useId();
  return (
    <div className="field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      {multiline ? (
        <textarea
          id={id}
          className={cls}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className={cls}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Num({
  label,
  value,
  onChange,
  disabled,
}: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  disabled,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: закрытие по клику на фон; Escape обрабатывается в useEffect
    <div className="modal-bg" onClick={onClose}>
      <dialog
        open
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={title}
        style={{ border: "none", position: "static", margin: 0 }}
      >
        <h2>{title}</h2>
        {children}
      </dialog>
    </div>
  );
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

export const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
