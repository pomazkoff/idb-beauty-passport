# RUNBOOK · Опросник ЛК / Паспорт красоты

## Компоненты

| Процесс | Команда | Порт | Зависимости |
|---|---|---|---|
| api | `node apps/api/dist/main.js` | 3000 | PostgreSQL |
| worker | `node apps/worker/dist/main.js` | — | PostgreSQL, ENSI (или file/mock) |
| web | статика `apps/web/dist` (nginx) + `apps/web/dist/embed/idb-beauty-quiz.js` для ЛК | 80 | api (CORS) |

API stateless — масштабируется горизонтально. Воркер можно запускать в нескольких экземплярах (`FOR UPDATE SKIP LOCKED`).

## Запуск

```bash
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
- `CORS_ORIGINS` — домены ЛК через запятую. Пусто = CORS выключен (только same-origin).
- `SWAGGER_ENABLED=false` в production (или за внутренним ingress).
- `ENSI_SINK=http` + `ENSI_*` — см. `docs/ENSI.md`.
- `SHOW_DRAFT_BADGE=false` в production (плашка «вопрос дописан» — для приёмки контента).
- `RETENTION_DAYS` — архивные сессии и события старше N дней удаляются раз в сутки (api).

## Встраивание в ЛК

```html
<script type="module" src="https://quiz.iledebeaute.ru/embed/idb-beauty-quiz.js"></script>
<idb-beauty-quiz api-base="https://quiz.iledebeaute.ru" token="<JWT пользователя ЛК>"></idb-beauty-quiz>
<script>
  document.addEventListener("quiz:base-completed", (e) => rebuildWidgets(e.detail.widgets));
  document.addEventListener("quiz:category-completed", (e) => refreshRecommendations(e.detail));
</script>
```

Атрибуты: `inherit-fonts` (шрифты хоста), `no-fonts` (не подключать Google Fonts). Аналитика: события уходят в `window.dataLayer`, если он есть на хосте, и в `POST /api/v1/events`.

## Обновление контента опросника

1. Правка `packages/survey-config/survey.v1.json` (или регенерация из прототипа: `pnpm survey:extract` → правка карты кодов `src/build/codes.ts` → `tsx src/build/generate.ts`).
2. **Коды вариантов не переименовывать**; удаление — `deprecated: true`. Новая версия — bump `version` (semver).
3. `pnpm survey:validate && pnpm --filter @idb/survey-config test` — контрольные числа в `src/survey.test.ts` править вместе с контентом.
4. `pnpm survey:content-map` → сверка `docs/content-map.md` с заказчиком.
5. Деплой api: новая версия регистрируется в `survey_versions` при старте. Активные сессии на старой версии получают 409 `SURVEY_VERSION_MISMATCH` на изменяющих запросах; клиент предлагает «Пройти заново». Их ответы остаются в БД.

## Наблюдаемость

- Логи JSON (pino): `x-request-id` в каждом ответе; `traceparent` пробрасывается.
- `/metrics` (Prometheus): `http_requests_total{route,status}`, `http_request_duration_seconds`, `ensi_outbox_size{status}`, `ensi_sent_total`, `ensi_failed_total`, `ensi_outbox_dead_total`.
- Алерты (рекомендуемые): `ensi_outbox_size{status="dead"} > 0`; `ensi_outbox_size{status="pending"}` растёт > 10 мин; `/ready` ≠ 200.

## Типовые ситуации

| Симптом | Что проверить | Действие |
|---|---|---|
| 401 на всех запросах | `AUTH_MODE`, JWKS доступен, `iss/aud` совпадают с токеном ЛК | `curl -H "Authorization: Bearer …" /api/v1/me/session` — тело ошибки содержит `meta.reason` |
| CORS-ошибка в браузере | `CORS_ORIGINS` содержит origin ЛК (схема+хост+порт) | перезапустить api |
| Профили не уходят в ENSI | `pnpm ensi:resync` (статистика), `ensi_outbox.last_error`, логи воркера | 5xx — ждём ретраев; 4xx — чинить маппинг/контракт → `pnpm ensi:resync -- --dead` |
| `dead` в outbox | `SELECT customer_id, revision, last_error FROM ensi_outbox WHERE status='dead'` | после исправления `pnpm ensi:resync -- --dead` |
| 409 `SURVEY_VERSION_MISMATCH` у пользователя | задеплоена новая версия конфига | ожидаемо; пользователь жмёт «Пройти заново» |
| Пользователь просит удалить данные | `customer_id` | `DELETE FROM sessions WHERE customer_id = $1` (каскадно удалит ответы, профили, outbox); события — `DELETE FROM analytics_events WHERE customer_id = $1` |

## Тесты

```bash
pnpm test                                  # unit + contract (нужен TEST_DATABASE_URL или postgres на localhost: beauty_passport_test)
pnpm test:e2e                              # Playwright; сам поднимает api и vite (DATABASE_URL)
PW_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e   # если браузеры Playwright не установлены
```
