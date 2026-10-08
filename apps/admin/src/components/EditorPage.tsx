import type { Survey } from "@idb/survey-config";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Report, type VersionDetail, api } from "../api.js";
import { openContentMap } from "../content-map.js";
import {
  BaseEditor,
  BranchEditor,
  CategoriesEditor,
  NewBranch,
  PsychotypesEditor,
  ScreensEditor,
  UiEditor,
  WidgetsEditor,
} from "../editors/SectionEditors.jsx";
import { GENDER_LABEL, frozenOf } from "../model.js";
import { Modal, fmtDate } from "./ui.jsx";

type Section = { id: string; label: string };

export function EditorPage({
  version,
  onBack,
  toast,
}: { version: string; onBack: () => void; toast: (t: string) => void }) {
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [published, setPublished] = useState<Survey | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [section, setSection] = useState("base");
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Survey | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { detail: d, report: r } = await api.get(version);
        setDetail(d);
        latest.current = d.config;
        setReport(r);
        const list = await api.list();
        const pub = list.find((v) => v.status === "published");
        if (pub && pub.version !== version) setPublished((await api.get(pub.version)).detail.config);
        else if (pub) setPublished(d.config);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [version]);

  const readOnly = detail?.status !== "draft";
  const frozen = useMemo(() => frozenOf(readOnly ? null : published), [published, readOnly]);

  const save = useCallback(async () => {
    if (!latest.current) return;
    setStatus("saving");
    try {
      const r = await api.save(version, latest.current);
      setReport(r.report);
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      toast(`Не сохранилось: ${(e as Error).message}`);
    }
  }, [version, toast]);

  const onChange = (s: Survey) => {
    if (!detail) return;
    latest.current = s;
    setDetail({ ...detail, config: s });
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1200);
  };

  // сохранить при уходе со страницы
  useEffect(() => {
    const flush = () => {
      if (status === "dirty") void save();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [status, save]);

  const publish = async () => {
    if (timer.current) clearTimeout(timer.current);
    await save();
    try {
      await api.publish(version);
      toast(`Версия ${version} опубликована`);
      onBack();
    } catch (e) {
      toast((e as Error).message);
      setConfirmPublish(false);
    }
  };

  const goTo = (path: string) => {
    // путь замечания: "female.face_skin_type.oily" | "base[2].options.female[1]" | "branches.female_face" | "widgets.x" | "completeness"
    const m =
      path.match(/^(female|male)\.([a-z0-9_]+)/) ?? path.match(/^questions\.(female|male)\.([a-z0-9_]+)/);
    const key =
      m?.[2] ?? path.match(/^(psycho\d|category|gender)/)?.[1] ?? path.match(/^([a-z0-9_]+)\./)?.[1];
    if (!detail) return;
    if (
      path.startsWith("base") ||
      ["psycho1", "psycho2", "psycho3", "category", "gender"].includes(key ?? "")
    )
      setSection("base");
    else if (path.startsWith("widgets")) setSection("widgets");
    else if (path.startsWith("completeness")) setSection("ui");
    else if (path.startsWith("category.")) setSection("categories");
    else if (path.startsWith("branches.")) setSection(`branch:${path.split(".")[1]}`);
    else if (key) {
      const b = detail.config.branches.find((br) => br.questions.some((q) => q.key === key));
      if (b) setSection(`branch:${b.id}`);
    }
    setTimeout(
      () => document.getElementById(`q-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
      50,
    );
  };

  if (error) return <div className="card">Ошибка: {error}</div>;
  if (!detail) return <div className="empty">Загружаем…</div>;
  const s = detail.config;

  const sections: Section[] = [
    { id: "base", label: "Этап 1 · База" },
    { id: "categories", label: "Категории" },
    { id: "psychotypes", label: "Психотипы" },
    { id: "widgets", label: "Виджеты ЛК" },
    { id: "screens", label: "Тексты экранов" },
    { id: "ui", label: "Интерфейс и проценты" },
  ];
  const issues = report
    ? [
        ...report.schema.map((i) => ({ ...i, kind: "schema" })),
        ...report.frozen.map((i) => ({ ...i, kind: "frozen" })),
        ...report.semantic.map((i) => ({ ...i, kind: "semantic" })),
      ]
    : [];

  return (
    <div>
      <div className="inline" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="inline">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            ← Версии
          </button>
          <h1 style={{ margin: 0 }}>
            <span className="mono">{version}</span>{" "}
            <span className={`badge ${detail.status}`}>
              {detail.status === "draft"
                ? "черновик"
                : detail.status === "published"
                  ? "опубликована"
                  : "архив"}
            </span>
          </h1>
          <span
            className={`status-line ${status === "saving" ? "saving" : status === "error" ? "error" : ""}`}
          >
            {readOnly
              ? `только чтение · ${fmtDate(detail.publishedAt ?? detail.updatedAt)}`
              : status === "saving"
                ? "сохраняем…"
                : status === "dirty"
                  ? "есть несохранённые правки"
                  : status === "error"
                    ? "ошибка сохранения"
                    : "сохранено"}
          </span>
        </div>
        <div className="inline">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void openContentMap({
                version,
                open: () => window.open("", "_blank"),
                load: (v) => api.contentMap(v),
                onError: toast,
              })
            }
          >
            Карта контента
          </button>
          <a className="btn" href={api.previewUrl(version)} target="_blank" rel="noreferrer">
            Предпросмотр
          </a>
          {!readOnly ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!report?.ok || status === "dirty" || status === "saving"}
              onClick={() => setConfirmPublish(true)}
              title={!report?.ok ? "Сначала исправьте замечания" : ""}
            >
              Опубликовать
            </button>
          ) : null}
        </div>
      </div>

      <div className="layout">
        <nav className="nav card" style={{ padding: 8 }}>
          {sections.map((x) => (
            <button
              type="button"
              key={x.id}
              className={section === x.id ? "active" : ""}
              onClick={() => setSection(x.id)}
            >
              {x.label}
            </button>
          ))}
          <div className="group">Этап 2 · Паспорт</div>
          {s.branches.map((b) => (
            <button
              type="button"
              key={b.id}
              className={section === `branch:${b.id}` ? "active" : ""}
              onClick={() => setSection(`branch:${b.id}`)}
            >
              {b.name}{" "}
              <span className="lock">
                · {b.genders.map((g) => GENDER_LABEL[g][0]).join("+")} · {b.questions.length}
              </span>
            </button>
          ))}
          {!readOnly ? (
            <button
              type="button"
              className={section === "newbranch" ? "active" : ""}
              onClick={() => setSection("newbranch")}
            >
              + Ветка
            </button>
          ) : null}
        </nav>

        <main className="card">
          {section === "base" ? (
            <BaseEditor survey={s} onChange={onChange} frozen={frozen} readOnly={readOnly} />
          ) : null}
          {section === "categories" ? (
            <CategoriesEditor survey={s} onChange={onChange} frozen={frozen} readOnly={readOnly} />
          ) : null}
          {section === "psychotypes" ? (
            <PsychotypesEditor survey={s} onChange={onChange} frozen={frozen} readOnly={readOnly} />
          ) : null}
          {section === "widgets" ? (
            <WidgetsEditor survey={s} onChange={onChange} frozen={frozen} readOnly={readOnly} />
          ) : null}
          {section === "screens" ? (
            <ScreensEditor survey={s} onChange={onChange} frozen={frozen} readOnly={readOnly} />
          ) : null}
          {section === "ui" ? (
            <UiEditor survey={s} onChange={onChange} frozen={frozen} readOnly={readOnly} />
          ) : null}
          {section.startsWith("branch:") ? (
            <BranchEditor
              survey={s}
              onChange={onChange}
              frozen={frozen}
              readOnly={readOnly}
              branchId={section.slice(7)}
            />
          ) : null}
          {section === "newbranch" ? (
            <NewBranch survey={s} onChange={onChange} onCreated={(id) => setSection(`branch:${id}`)} />
          ) : null}
        </main>

        <aside className="side card">
          <h2>Проверка</h2>
          {!report ? (
            <span className="lock">…</span>
          ) : report.ok ? (
            <span className="badge published">замечаний нет — можно публиковать</span>
          ) : (
            <>
              <span className="badge err">{issues.length} замечаний</span>
              <p className="lock">
                Красные — структура, фирменные — замороженные коды опубликованной версии, жёлтые — правила
                опросника. Клик — перейти.
              </p>
              <div className="issues">
                {issues.map((i, n) => (
                  <button
                    type="button"
                    key={`${i.kind}-${i.path}-${n}`}
                    className={`issue ${i.kind}`}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      background: "none",
                    }}
                    onClick={() => goTo(i.path)}
                  >
                    <span className="path">{i.path}</span>
                    {i.message}
                  </button>
                ))}
              </div>
            </>
          )}
          <h3>Подсказки</h3>
          <ul className="lock" style={{ paddingLeft: 16, margin: 0 }}>
            <li>
              Коды вариантов и ключи вопросов — идентификаторы для ENSI. После публикации они замораживаются:
              вариант можно скрыть, но не удалить.
            </li>
            <li>Тексты правятся свободно, в том числе в опубликованных кодах.</li>
            <li>Новые вопросы и варианты можно добавлять в любую ветку.</li>
            <li>Предпросмотр открывает опросник на этом черновике; ссылка содержит ваш токен.</li>
          </ul>
        </aside>
      </div>

      {confirmPublish ? (
        <Modal title={`Опубликовать ${version}?`} onClose={() => setConfirmPublish(false)}>
          <p>
            Новые пользователи сразу начнут получать эту версию; ENSI увидит её в сервисном API. Текущая
            опубликованная уйдёт в архив.
          </p>
          <div className="inline" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setConfirmPublish(false)}>
              Отмена
            </button>
            <button type="button" className="btn btn-primary" onClick={publish}>
              Опубликовать
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
