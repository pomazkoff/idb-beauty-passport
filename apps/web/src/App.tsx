import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Analytics, type AnalyticsEvent } from "./analytics.js";
import { ApiClient, type Auth } from "./api/client.js";
import { Intro, Question, Result1, Result2 } from "./components/screens.jsx";
import { QuizController, type QuizEvents } from "./state/controller.js";

export type AppProps = {
  apiBase: string;
  auth: Auth;
  inheritFonts?: boolean;
  events?: QuizEvents & { onAnalytics?: (e: AnalyticsEvent) => void };
  /** Для тестов: готовый контроллер. */
  controller?: QuizController;
};

export function createController(props: AppProps): QuizController {
  const api = new ApiClient(props.apiBase, props.auth);
  const analytics = new Analytics(api, props.events?.onAnalytics);
  return new QuizController(api, analytics, props.events);
}

export function App(props: AppProps) {
  const ctrl = useMemo(() => props.controller ?? createController(props), [props.controller]);
  const state = useSyncExternalStore(ctrl.subscribe, ctrl.getState, ctrl.getState);

  useEffect(() => {
    void ctrl.init();
    return () => ctrl.destroy();
  }, [ctrl]);

  const { survey, session } = state;
  const q = ctrl.current;
  const index = ctrl.index;
  const total = ctrl.queue.length;
  const showBar = state.phase === "question" && q;

  return (
    <div className="idbq" data-inherit-fonts={props.inheritFonts ? "true" : "false"} data-phase={state.phase}>
      <header>
        <div className="hdr">
          <span className="logo">
            ИЛЬ <b>ДЕ</b> БОТЭ
          </span>
          <span className="hdr-tag">{survey?.ui.headerTag ?? "Опросник ЛК"}</span>
        </div>
      </header>
      <div className="wrap">
        {showBar ? (
          <div id="bar">
            <div className="progress">
              <div className="progress-fill" style={{ width: `${(index / Math.max(total, 1)) * 100}%` }} />
            </div>
            <div className="stepmeta">
              <span id="stepName">{q.block}</span>
              <span id="stepNum">
                {index + 1} / {total}
              </span>
            </div>
          </div>
        ) : null}

        {state.phase === "loading" ? <div className="loading">Загружаем…</div> : null}

        {state.phase === "error" ? (
          <div className="screen">
            <div className="error-inline" role="alert">
              Не удалось загрузить опросник: {state.fatalError}
            </div>
            <div className="nav">
              <button type="button" className="btn btn-primary" onClick={() => void ctrl.init()}>
                Повторить
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void ctrl.reset()}>
                Пройти заново
              </button>
            </div>
          </div>
        ) : null}

        {state.phase === "intro" && survey ? <Intro survey={survey} onStart={() => ctrl.start()} /> : null}

        {state.phase === "question" && survey && session && q ? (
          <Question
            survey={survey}
            question={q}
            index={index}
            total={total}
            saved={session.answers[q.key]}
            multiSel={state.multiSel}
            onSingle={(c) => ctrl.selectSingle(c)}
            onToggle={(c) => ctrl.toggleMulti(c)}
            onNext={() => ctrl.next()}
            onSkip={() => ctrl.skip()}
            onBack={() => ctrl.back()}
          />
        ) : null}

        {state.phase === "result1" && survey && session ? (
          <Result1
            survey={survey}
            session={session}
            profile={state.lastProfile}
            postponed={state.postponed}
            onStartPassport={(c) => ctrl.startPassport(c)}
            onPostpone={() => ctrl.postpone()}
            onAgain={() => void ctrl.reset()}
          />
        ) : null}

        {state.phase === "result2" && survey && session ? (
          <Result2
            survey={survey}
            session={session}
            onAddCategory={(c) => ctrl.startPassport(c, true)}
            onAgain={() => void ctrl.reset()}
          />
        ) : null}

        {state.saveError && state.phase === "question" ? (
          <div className="error-inline" role="alert">
            Не удалось сохранить ответ: {state.saveError}. Ответы продолжат отправляться автоматически.
          </div>
        ) : null}
      </div>

      {state.pending > 0 ? (
        <div className="sync" aria-live="polite">
          Сохраняем…
        </div>
      ) : state.saveError ? (
        <div className="sync err">Нет связи с сервером</div>
      ) : null}
    </div>
  );
}
