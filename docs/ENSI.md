# Доставка профиля в ENSI

Этот файл — исходящий контур: воркер опросника отправляет `BeautyProfile` в ENSI. Встройка опросника в личный кабинет сюда не входит, она в [`INTEGRATION.md`](INTEGRATION.md). Методы, которыми web-компонент ходит в свой API, и сервисное чтение опросника по `X-Api-Key` — в [`API.md`](API.md).

ENSI профиль не запрашивает у страницы ЛК. Страница получает коды виджетов событием `quiz:base-completed` / `quiz:category-completed`.

## Как это устроено

```
base:complete / passport:complete
        │  одна транзакция
        ▼
 profiles (ревизия N)  +  ensi_outbox (pending)      ← старые pending/failed того же клиента → superseded
        │
        ▼  apps/worker: poll каждые OUTBOX_POLL_INTERVAL_MS, FOR UPDATE SKIP LOCKED
 EnsiSink.upsertProfile(BeautyProfile, { idempotencyKey: "<customer_id>:<revision>", traceId })
        │
        ├─ 2xx                → sent (external_id из data.id, если есть)
        ├─ 5xx / 429 / сеть   → failed, повтор через 1 мин → 2 → 4 … ≤ 24 ч; после OUTBOX_MAX_ATTEMPTS → dead
        └─ 4xx (кроме 429)    → failed, без повторов (тело ответа в last_error)
```

Статус доставки виден в `GET /api/v1/me/profile` (`ensi.status`), в `/metrics` (`ensi_outbox_size{status=…}`,
`ensi_sent_total`, `ensi_failed_total`, `ensi_outbox_dead_total`) и в логах воркера (`traceId`, `customerId`, `revision`).

## Реализации адаптера (`ENSI_SINK`)

| Значение | Что делает | Когда |
|---|---|---|
| `mock` | хранит в памяти | тесты |
| `file` | пишет `ENSI_FILE_DIR/<customer_id>/rev-N.json` и `latest.json` — ровно тот JSON, что ушёл бы в ENSI | локальная демонстрация, приёмка контракта (по умолчанию) |
| `http` | `ENSI_PROFILE_METHOD` на `ENSI_BASE_URL + ENSI_PROFILE_PATH`, заголовки авторизации, `Idempotency-Key`, `traceparent` | когда есть контракт ENSI |

Переменные для `http`:

```
ENSI_SINK=http
ENSI_BASE_URL=https://ensi.internal
ENSI_PROFILE_PATH=/api/v1/customers/{customer_id}/beauty-profile   # шаблон; {customer_id}, {revision}
ENSI_PROFILE_METHOD=PUT                                             # PUT | POST | PATCH
ENSI_AUTH_HEADER=Authorization
ENSI_AUTH_VALUE=Bearer <service-token>
ENSI_TIMEOUT_MS=10000
ENSI_FETCH_PATH=/api/v1/customers/{customer_id}/beauty-profile      # GET при пустом входе, см. ниже
```

## Чтение опросника по ключу

`GET /api/v1/integration/...` с заголовком `X-Api-Key` — отдельный контур. Web-компонент ЛК его не использует: вопросы он берёт из `GET /api/v1/survey`, ответы сдаёт методами сессии. Состав, лимит и отличие от `GET /me/profile` — в [`API.md`](API.md).

`ENSI_FETCH_PATH` и `fetchProfile` — чтение профиля при пустом входе. Его вызывает `GET /api/v1/me/session`, не воркер. Подробности и диаграмма — в [`API.md`](API.md). File-sink читает `latest.json` и при отсутствии файла возвращает `null`.

## Что отправляем

Тело запроса — `toEnsiPayload(BeautyProfile)` (`packages/ensi-client/src/http/mapping.ts`):

```json
{
  "customer_id": "…",
  "attributes": {
    "beauty_gender": "female",
    "beauty_psychotype": "E",
    "beauty_psychotype_name": "Эмоциональный",
    "beauty_primary_category": "face",
    "beauty_completed_categories": ["face"],
    "beauty_completeness_pct": 60,
    "beauty_widgets_priority": ["news_blog", "…"],
    "beauty_widgets_base": ["favorites", "…"],
    "beauty_profile_revision": 2,
    "beauty_survey_version": "1.0.0",
    "beauty_updated_at": "2026-10-06T07:30:00Z",
    "beauty_tags": ["skin_type:combination"],
    "beauty_trait_face_skin_type": ["combination"],
    "beauty_trait_face_concerns": ["dehydrated", "dull"]
  },
  "beauty_profile": { "…полный BeautyProfile по ТЗ 10.2…" }
}
```

`attributes` — плоские поля для сегментации/CRM; `beauty_profile` — полный контракт для хранения как JSON.
Коды вариантов и ключи вопросов — в `docs/content-map.md`.

## Зависимость от команды ENSI

Контракт приёма профиля принадлежит ENSI. Пока он не передан, `ENSI_SINK` остаётся `file`, а чтение при входе для file-sink — это `latest.json` в `ENSI_FILE_DIR`.

1. **Сервис и эндпоинт**, принимающий профиль клиента: Customers (атрибуты/кастомные поля) или отдельный сервис.
   Нужен OpenAPI-контракт → положить в `packages/ensi-client/openapi/ensi.yaml`, выполнить
   `pnpm --filter @idb/ensi-client generate`, подправить `mapping.ts` под реальные поля (тесты там же).
2. **Авторизация сервис-сервис**: имя заголовка и значение/способ получения токена (`ENSI_AUTH_HEADER` / `ENSI_AUTH_VALUE`).
3. **Идентификатор клиента**: id из клейма JWT ЛК совпадает с id клиента в ENSI. Отдельный эндпоинт маппинга не предусмотрен.
4. **Идемпотентность**: поддерживает ли эндпоинт `Idempotency-Key`; если нет — опираемся на `beauty_profile_revision`
   (ENSI должен игнорировать ревизию ≤ сохранённой).
5. **Чтение при входе**: `GET` по `ENSI_FETCH_PATH`. Тело — `BeautyProfile` либо `{ "data": { "beauty_profile": … } }`. 404 — профиля нет. Импортированная ревизия в outbox пишется как `sent` и повторно не отправляется.
6. **Сеть**: доступ воркера и API к ENSI (allowlist, mTLS), допустимая частота запросов (для `OUTBOX_BATCH_SIZE`).

## Эксплуатация

```bash
pnpm ensi:resync                       # статистика очереди
pnpm ensi:resync -- --customer <id>    # перепоставить последнюю ревизию клиента
pnpm ensi:resync -- --dead             # перепоставить всех dead
pnpm ensi:resync -- --all --since 2026-10-01
```

Разбор `dead`: `SELECT customer_id, revision, attempts, last_error FROM ensi_outbox WHERE status='dead'` → причина в
`last_error` (тело ответа ENSI обрезано до 2000 символов) → исправить на стороне ENSI/маппинга → `--dead`.
Прочий 4xx в `dead` не переходит: статус остаётся `failed`, `next_attempt_at` уезжает в 9999 год. Такую ревизию возвращает `--customer`.
