import { useCallback, useEffect, useState } from "react";
import { AdminApiError, type VersionSummary, api } from "../api.js";
import { bumpVersion } from "../model.js";
import { Modal, Text, fmtDate } from "./ui.jsx";

const STATUS: Record<VersionSummary["status"], string> = {
  draft: "черновик",
  published: "опубликована",
  archived: "архив",
};

export function VersionsPage({ onOpen, toast }: { onOpen: (v: string) => void; toast: (t: string) => void }) {
  const [rows, setRows] = useState<VersionSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "publish" | "delete"; version: string } | null>(null);
  const [form, setForm] = useState({ version: "", fromVersion: "", notes: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.list());
    } catch (e) {
      toast(`Не удалось загрузить версии: ${(e as Error).message}`);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const published = rows?.find((r) => r.status === "published");

  const openCreate = () => {
    setForm({
      version: published ? bumpVersion(published.version) : "1.0.0",
      fromVersion: published?.version ?? "",
      notes: "",
    });
    setCreating(true);
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.create({
        version: form.version.trim(),
        fromVersion: form.fromVersion || undefined,
        notes: form.notes || undefined,
      });
      setCreating(false);
      toast(`Черновик ${r.version} создан`);
      onOpen(r.version);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "publish") {
        await api.publish(confirm.version);
        toast(`Версия ${confirm.version} опубликована`);
      } else {
        await api.remove(confirm.version);
        toast(`Черновик ${confirm.version} удалён`);
      }
      setConfirm(null);
      await load();
    } catch (e) {
      const err = e as AdminApiError;
      toast(
        err instanceof AdminApiError && err.code === "VALIDATION_ERROR"
          ? "Черновик не проходит проверку — откройте его и исправьте замечания"
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="inline" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Версии опросника</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!rows}>
          + Новый черновик
        </button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {!rows ? (
          <div className="empty">Загружаем…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Версий нет</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Версия</th>
                <th>Статус</th>
                <th>Заметка</th>
                <th>Вопросов</th>
                <th>Замечаний</th>
                <th>Изменена</th>
                <th>Опубликована</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.version} data-version={r.version}>
                  <td className="mono">
                    <b>{r.version}</b>
                    {r.sourceVersion ? <div className="lock">из {r.sourceVersion}</div> : null}
                  </td>
                  <td>
                    <span className={`badge ${r.status}`}>{STATUS[r.status]}</span>
                  </td>
                  <td>{r.notes ?? ""}</td>
                  <td>
                    {r.questions} <span className="lock">/ {r.branches} веток</span>
                  </td>
                  <td>
                    {r.issues ? (
                      <span className="badge err">{r.issues}</span>
                    ) : (
                      <span className="badge published">0</span>
                    )}
                  </td>
                  <td>{fmtDate(r.updatedAt)}</td>
                  <td>{fmtDate(r.publishedAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-sm" onClick={() => onOpen(r.version)}>
                      {r.status === "draft" ? "Редактировать" : "Открыть"}
                    </button>{" "}
                    <a
                      className="btn btn-sm"
                      href={api.previewUrl(r.version)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Предпросмотр
                    </a>{" "}
                    {r.status === "draft" ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={r.issues > 0}
                          title={r.issues ? "Есть замечания" : ""}
                          onClick={() => setConfirm({ kind: "publish", version: r.version })}
                        >
                          Опубликовать
                        </button>{" "}
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-danger"
                          onClick={() => setConfirm({ kind: "delete", version: r.version })}
                        >
                          Удалить
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="lock" style={{ marginTop: 12 }}>
        Опубликована всегда ровно одна версия — её получают ЛК и ENSI. Пользователи, начавшие опросник на
        старой версии, дойдут до конца на ней. Черновик видно только через «Предпросмотр» (ссылка содержит ваш
        токен — не пересылайте её).
      </p>

      {creating ? (
        <Modal title="Новый черновик" onClose={() => setCreating(false)}>
          <Text
            label="Номер версии"
            value={form.version}
            mono
            onChange={(v) => setForm({ ...form, version: v })}
            hint="Формат 1.2.3. Увеличьте среднее число при изменении вопросов, последнее — при правке текстов."
          />
          <Text
            label="Скопировать из версии"
            value={form.fromVersion}
            mono
            onChange={(v) => setForm({ ...form, fromVersion: v })}
            hint="Пусто — из опубликованной"
          />
          <Text
            label="Заметка"
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
            placeholder="Что меняем и зачем"
          />
          <div className="inline" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={create}
              disabled={busy || !/^\d+\.\d+\.\d+$/.test(form.version.trim())}
            >
              Создать
            </button>
          </div>
        </Modal>
      ) : null}

      {confirm ? (
        <Modal
          title={
            confirm.kind === "publish"
              ? `Опубликовать ${confirm.version}?`
              : `Удалить черновик ${confirm.version}?`
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.kind === "publish"
              ? "Новые пользователи сразу начнут получать эту версию. Текущая опубликованная уйдёт в архив. Отменить публикацию можно, опубликовав другую версию."
              : "Черновик и его сессии предпросмотра будут удалены безвозвратно."}
          </p>
          <div className="inline" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>
              Отмена
            </button>
            <button
              type="button"
              className={`btn ${confirm.kind === "publish" ? "btn-primary" : "btn-danger"}`}
              onClick={doConfirm}
              disabled={busy}
            >
              {confirm.kind === "publish" ? "Опубликовать" : "Удалить"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
