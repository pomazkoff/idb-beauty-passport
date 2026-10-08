# RUNBOOK · Опросник ЛК / Паспорт красоты

## Компоненты

| Процесс | Команда | Порт | Зависимости |
|---|---|---|---|
| api | `node apps/api/dist/main.js` | 3000 | PostgreSQL |
| worker | `node apps/worker/dist/main.js` | — | PostgreSQL, ENSI (или file/mock) |
| web | статика `apps/web/dist` (nginx) + `apps/web/dist/embed/idb-beauty-quiz.js` для ЛК | 80 | api (CORS) |
| admin | конструктор, статика `apps/admin/dist` (nginx) | 80 (compose: 8081) | api (CORS, `ADMIN_TOKEN`) |

API stateless — масштабируется горизонтально. Воркер можно запускать в нескольких экземплярах (`FOR UPDATE SKIP LOCKED`).

## Запуск

```bash
# Демо/разработка без Docker и PostgreSQL: встроенная база PGlite (./.pgdata), воркер внутри API
pnpm demo                       # --reset — стереть базу

# Docker Compose (всё сразу: postgres → migrate → api, worker, web)
docker compose up --build

# Вручную
pnpm install && pnpm --filter "./packages/*" build
cp .env.example .env            # заполнить DATABASE_URL, AUTH_MODE, JWT_*, CORS_ORIGINS, ENSI_*
pnpm db:migrate                 # применить SQL-миграции (идемпотентно); либо AUTO_MIGRATE=true у api
pnpm --filter @idb/api build && pnpm --filter @idb/worker build && pnpm --filter @idb/web build
```

Проверка: `GET /api/v1/health` → `{data:{status:"ok",surveyVersion}}`, `GET /api/v1/ready` → 200 при живой БД.

## Переменные окружения

См. `.env.example`. Критичные:

- `AUTH_MODE=jwt` + `JWT_JWKS_URL` **или** `JWT_PUBLIC_KEY_PEM`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_CUSTOMER_CLAIM` (по умолчанию `sub`).
  `AUTH_MODE=dev` (заголовок `X-Customer-Id`) в `NODE_ENV=production` **не стартует**.
- `CORS_ORIGINS` — origin-ы через запятую. В production: origin страницы ЛК, с которой фронт вызывает API, и `https://beauty-quiz.iledebeaute.ru`, если поднимают эталон. Пусто = CORS выключен (только same-origin). `localhost` в `.env.example` и Docker Compose — локальный стенд.
- `SWAGGER_ENABLED=false` в production (или за внутренним ingress).
- `ENSI_SINK=http` + `ENSI_*` — см. `docs/ENSI.md`.
- `SHOW_DRAFT_BADGE=false` в production (плашка «вопрос дописан» — для приёмки контента).
- `RETENTION_DAYS` — раз в сутки api удаляет события старше N дней и архивные сессии старше N дней, на которые не ссылается профиль. Сессии с профилями остаются: каскад снёс бы ревизии ENSI.
- `ADMIN_TOKEN` (≥16 символов) — вход в конструктор; пусто = админ-API выключен. Выдавать продакту лично, менять при смене команды.
- `DATABASE_URL=pglite:<каталог>` (или `pglite:memory`) — встроенная база вместо PostgreSQL: один процесс, без конкурентного доступа; воркер outbox запускается внутри API (`OUTBOX_POLL_INTERVAL_MS`, по умолчанию 2000). **Только для демо, разработки и тестов** — в production нужен PostgreSQL.
- `INTEGRATION_API_KEY` (≥16 символов) — ключ для ENSI (`X-Api-Key`); пусто = интеграционный API выключен.

## Интеграция ЛК и эталон

Контракт для команды ЛК — нативные вызовы API, [`INTEGRATION.md`](INTEGRATION.md). API — `https://beauty-api.iledebeaute.ru`. Фронт ЛК сам шлёт `POST /api/v1/events`.

Эталонный компонент ниже необязателен. Статика эталона — `https://beauty-quiz.iledebeaute.ru`. `?customer=` и заголовок `X-Customer-Id` работают только при `AUTH_MODE=dev` и в production выключены.

```html
<script type="module" src="https://beauty-quiz.iledebeaute.ru/embed/idb-beauty-quiz.js"></script>
<idb-beauty-quiz api-base="https://beauty-api.iledebeaute.ru" token="<JWT пользователя ЛК>"></idb-beauty-quiz>
<script>
  document.addEventListener("quiz:base-completed", (e) => {
    const { priority, base } = e.detail.widgets;
    rebuildWidgets(priority, base);
  });
  document.addEventListener("quiz:category-completed", (e) => refreshRecommendations(e.detail));
</script>
```

Атрибуты: `inherit-fonts` (шрифты хоста), `no-fonts` (не подключать Google Fonts), на dev-стенде ещё `customer-id`. Рядом с ESM лежит `idb-beauty-quiz.iife.js`. Аналитика: при наличии `window.dataLayer` компонент пушит туда события и параллельно батчем вызывает `POST /api/v1/events`. Наружу ещё есть `quiz:closed` и `quiz:analytics`.

## Обновление контента опросника

Контент живёт в БД (`survey_versions`), редактируется в конструкторе (`admin`, вход по `ADMIN_TOKEN`):

1. «Новый черновик» — копия опубликованной версии с новым номером (semver).
2. Правки сохраняются автоматически; панель «Проверка» показывает замечания трёх видов: структура, замороженные коды (то, что уже опубликовано, нельзя удалить/переименовать — только скрыть), правила опросника.
3. «Предпросмотр» открывает эталонный опросник на черновике (ссылка содержит токен — не пересылать).
4. «Опубликовать» — доступно при нуле замечаний. Предыдущая версия уходит в архив; активные сессии пользователей доживают на своей версии, новые начинаются на опубликованной; ENSI видит новую версию в `GET /integration/surveys/current`.
5. «Карта контента» — markdown со всеми кодами. Конструктор запрашивает его с `X-Admin-Token` и открывает текст в новой вкладке. Токен в адрес не попадает. Без заголовка маршрут отвечает 401.

`packages/survey-config/survey.v1.json` — сид первой версии и источник для тестов контрольных чисел; после перехода на конструктор его менять не нужно. Откат = новый черновик из архивной версии (конструктор потребует пометить `deprecated` коды, появившиеся позже).

## Наблюдаемость

- Логи JSON (pino): `x-request-id` в каждом ответе; `traceparent` пробрасывается.
- `/metrics` (Prometheus): `http_requests_total{route,status}`, `http_request_duration_seconds`, `ensi_outbox_size{status}`, `ensi_sent_total`, `ensi_failed_total`, `ensi_outbox_dead_total`.
- Алерты (рекомендуемые): `ensi_outbox_size{status="dead"} > 0`; `ensi_outbox_size{status="pending"}` растёт > 10 мин; `/ready` ≠ 200.

## Типовые ситуации

| Симптом | Что проверить | Действие |
|---|---|---|
| 401 на всех запросах | `AUTH_MODE`, JWKS доступен, `iss/aud` совпадают с токеном ЛК | `curl -H "Authorization: Bearer …" /api/v1/me/session` — тело ошибки содержит `meta.reason` |
| CORS-ошибка в браузере | `CORS_ORIGINS` содержит origin ЛК (схема+хост+порт) | перезапустить api |
| Профили не уходят в ENSI | `pnpm ensi:resync` (статистика), `ensi_outbox.last_error`, логи воркера | 5xx — ждать ретраев; исчерпание попыток даёт `dead`. Прочий 4xx остаётся `failed` без повтора → после правки маппинга `pnpm ensi:resync -- --customer <id>` |
| `dead` в outbox | `SELECT customer_id, revision, last_error FROM ensi_outbox WHERE status='dead'` | после исправления `pnpm ensi:resync -- --dead` |
| 409 `SURVEY_VERSION_MISMATCH` у пользователя | версия опросника этой сессии удалена из `survey_versions` | публикация новой версии сессию не рвёт; «Пройти заново» создаёт сессию на опубликованной |
| Пользователь просит удалить данные | `customer_id` | `DELETE FROM sessions WHERE customer_id = $1` каскадом удалит ответы, профили и outbox (это сотрёт историю ревизий, в отличие от суточного retention); события — `DELETE FROM analytics_events WHERE customer_id = $1` |

## Тесты

```bash
pnpm test                                  # unit + contract; без TEST_DATABASE_URL — на PGlite в памяти, PostgreSQL не нужен
pnpm test:e2e                              # Playwright; сам поднимает api и vite (DATABASE_URL)
PW_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e   # если браузеры Playwright не установлены
```
