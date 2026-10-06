import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import { EditorPage } from "./components/EditorPage.jsx";
import { VersionsPage } from "./components/VersionsPage.jsx";
import { Text, Toast } from "./components/ui.jsx";

type Route = { page: "versions" } | { page: "editor"; version: string };

function parseRoute(): Route {
  const m = location.hash.match(/^#\/v\/([^/]+)/);
  return m ? { page: "editor", version: decodeURIComponent(m[1]!) } : { page: "versions" };
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [token, setTok] = useState(getToken());
  const [route, setRoute] = useState<Route>(parseRoute());
  const [toastText, setToastText] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const toast = useCallback((t: string) => {
    setToastText(t);
    setTimeout(() => setToastText(null), 3500);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setAuthed(false);
      return;
    }
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => {
        setToken("");
        setAuthed(false);
      });
  }, []);

  const login = async () => {
    setToken(token.trim());
    try {
      await api.me();
      setAuthed(true);
      setLoginError(null);
    } catch (e) {
      setToken("");
      setLoginError(
        (e as Error).message.includes("ADMIN_TOKEN")
          ? "Конструктор выключен на сервере (нет ADMIN_TOKEN)"
          : "Неверный токен",
      );
    }
  };
  const logout = () => {
    setToken("");
    setTok("");
    setAuthed(false);
  };

  if (authed === null) return <div className="empty">…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">
          ИЛЬ <b>ДЕ</b> БОТЭ
        </span>
        <span className="muted">Конструктор опросника ЛК</span>
        <span className="spacer" />
        {authed ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Выйти
          </button>
        ) : null}
      </header>
      <div className="content">
        {!authed ? (
          <div className="card login">
            <h1>Вход</h1>
            <p className="lock">Введите токен конструктора (ADMIN_TOKEN из настроек сервиса).</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void login();
              }}
            >
              <Text label="Токен" value={token} mono onChange={setTok} />
              {loginError ? <p className="status-line error">{loginError}</p> : null}
              <button type="submit" className="btn btn-primary" disabled={!token.trim()}>
                Войти
              </button>
            </form>
          </div>
        ) : route.page === "versions" ? (
          <VersionsPage
            toast={toast}
            onOpen={(v) => {
              location.hash = `#/v/${encodeURIComponent(v)}`;
            }}
          />
        ) : (
          <EditorPage
            key={route.version}
            version={route.version}
            toast={toast}
            onBack={() => {
              location.hash = "#/";
            }}
          />
        )}
      </div>
      <Toast text={toastText} />
    </div>
  );
}
