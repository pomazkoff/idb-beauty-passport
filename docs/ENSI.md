# Доставка профиля в ENSI

Этот файл — исходящий контур: воркер опросника отправляет `BeautyProfile` в ENSI. Как фронт ЛК вызывает API — [`INTEGRATION.md`](INTEGRATION.md). Сервисное чтение по заголовку `X-Api-Key` — [`API.md`](API.md).

ENSI профиль у фронта ЛК не запрашивает. Фронт берёт коды виджетов из ответа API (`data.widgets` у завершений этапа или `data.profile.widgets` у `GET /api/v1/me/profile`).

Доставка в очередь ставится в той же транзакции, что и запись профиля:

- после `POST /api/v1/me/session/base:complete`;
- после каждого `POST /api/v1/me/session/passport:complete`;
- после такого же завершения, если перед ним был `POST /api/v1/me/session:reset`.

Отдельный ответ, reset и открытие сессии очередь не пополняют. Импорт на пустом входе пишется как `sent`.

Webhook в ENSI не реализован. Позже его можно добавить отдельно. Сейчас результат выходит push воркера и pull `GET /api/v1/integration/customers/{customerId}/profile`.

## Как это устроено

```
base:complete / passport:complete / завершение после «Пройти заново»
        │  одна транзакция: UPDATE единственной строки profiles, revision + 1
        │  старые pending/failed этого клиента → superseded
        ▼
 profiles (одна строка на customer_id)  +  ensi_outbox (pending)
        │
        ▼  apps/worker: poll каждые OUTBOX_POLL_INTERVAL_MS, FOR UPDATE SKIP LOCKED
 EnsiSink.upsertProfile(BeautyProfile, { idempotencyKey: "<customer_id>:<revision>", traceId })
        │  тот же customer_id: в ENSI это обновление профиля, не второй профиль
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

`GET /api/v1/integration/...` с заголовком `X-Api-Key` — отдельный контур. В OpenAPI схема называется `X-Api-Key`. Фронт ЛК его не использует: вопросы он берёт из `GET /api/v1/survey`, ответы сдаёт методами сессии. Состав, лимит и отличие от `GET /me/profile` — в [`API.md`](API.md).

`ENSI_FETCH_PATH` и `fetchProfile` — чтение профиля при пустом входе. Его вызывает `GET /api/v1/me/session`, не воркер. Подробности и диаграмма — в [`API.md`](API.md). File-sink читает `latest.json` и при отсутствии файла возвращает `null`.

## Что отправляем

Тело запроса — `toEnsiPayload(BeautyProfile)` (`packages/ensi-client/src/http/mapping.ts`):

Фиксированные ключи `attributes` (их набор конечный, `packages/ensi-client/src/http/mapping.ts`):

| Ключ | Откуда |
|---|---|
| `beauty_gender` | `gender` |
| `beauty_psychotype` | `psychotype.code` |
| `beauty_psychotype_name` | `psychotype.name` |
| `beauty_primary_category` | `primary_category` или пустая строка |
| `beauty_completed_categories` | `completed_categories` |
| `beauty_completeness_pct` | `completeness_pct` |
| `beauty_widgets_priority` | `widgets.priority` |
| `beauty_widgets_base` | `widgets.base` |
| `beauty_profile_revision` | `profile_revision` |
| `beauty_survey_version` | `survey_version` |
| `beauty_updated_at` | `updated_at` |
| `beauty_tags` | `tags` |

Плюс по одному ключу на каждую пару в `traits`: `beauty_trait_` + ключ `traits`, в котором точка заменена на `_`. Пример: `traits["face.skin_type"]` становится `beauty_trait_face_skin_type`, значение — массив кодов. Других ключей `attributes` нет.

`beauty_profile` — тот же `BeautyProfile` целиком. Поля: `schema_version`, `customer_id`, `profile_revision`, `survey_version`, `updated_at`, `gender`, `psychotype.code`, `psychotype.name`, `psychotype.votes.E`, `psychotype.votes.P`, `psychotype.votes.L`, `psychotype.votes.M`, `primary_category`, `completed_categories`, `completeness_pct`, `widgets.priority`, `widgets.base`, `answers` (элемент: `stage`, `category`, `question_key`, `option_codes`, `skipped`, `answered_at`), `traits`, `tags`.

Пример тела:

```json
{
  "customer_id": "100500",
  "attributes": {
    "beauty_gender": "female",
    "beauty_psychotype": "E",
    "beauty_psychotype_name": "Эмоциональный",
    "beauty_primary_category": "face",
    "beauty_completed_categories": ["face"],
    "beauty_completeness_pct": 60,
    "beauty_widgets_priority": ["news_blog"],
    "beauty_widgets_base": ["favorites"],
    "beauty_profile_revision": 2,
    "beauty_survey_version": "1.0.0",
    "beauty_updated_at": "2026-10-08T12:00:00.000Z",
    "beauty_tags": ["skin_type:combination"],
    "beauty_trait_face_skin_type": ["combination"],
    "beauty_trait_face_concerns": ["dehydrated", "dull"]
  },
  "beauty_profile": {
    "schema_version": "1.0",
    "customer_id": "100500",
    "profile_revision": 2,
    "survey_version": "1.0.0",
    "updated_at": "2026-10-08T12:00:00.000Z",
    "gender": "female",
    "psychotype": {
      "code": "E",
      "name": "Эмоциональный",
      "votes": { "E": 3, "P": 1, "L": 0, "M": 0 }
    },
    "primary_category": "face",
    "completed_categories": ["face"],
    "completeness_pct": 60,
    "widgets": { "priority": ["news_blog"], "base": ["favorites"] },
    "answers": [
      {
        "stage": "base",
        "question_key": "gender",
        "option_codes": ["female"],
        "skipped": false,
        "answered_at": "2026-10-08T12:00:00.000Z"
      }
    ],
    "traits": { "face.skin_type": ["combination"], "face.concerns": ["dehydrated", "dull"] },
    "tags": ["skin_type:combination"]
  }
}
```

`attributes` — плоские поля для сегментации. `beauty_profile` — полный контракт для хранения как JSON. Коды вариантов и ключи вопросов — в `docs/content-map.md`. Массивы виджетов в примере короткие, потому что так устроен пример; в ответе сервера там полный набор кодов, который посчитал движок.

## Зависимость от команды ENSI

Контракт приёма профиля принадлежит ENSI. Пока он не передан, `ENSI_SINK` остаётся `file`, а чтение при входе для file-sink — это `latest.json` в `ENSI_FILE_DIR`.

1. **Сервис и эндпоинт**, принимающий профиль клиента: Customers (атрибуты/кастомные поля) или отдельный сервис.
   Нужен OpenAPI-контракт → положить в `packages/ensi-client/openapi/ensi.yaml`, выполнить
   `pnpm --filter @idb/ensi-client generate`, подправить `mapping.ts` под реальные поля (тесты там же).
2. **Авторизация сервис-сервис**: имя заголовка и значение/способ получения токена (`ENSI_AUTH_HEADER` / `ENSI_AUTH_VALUE`).
3. **Идентификатор клиента** подтверждён: id из клейма JWT ЛК равен id клиента в ENSI. Отдельный эндпоинт маппинга не нужен. Повторное прохождение обновляет профиль этого id (upsert), а не создаёт второй.
4. **Идемпотентность**: `Idempotency-Key` равен `<customer_id>:<profile_revision>`. Повтор той же ревизии не должен создавать второй профиль. Новая ревизия того же клиента — обновление (upsert). Если эндпоинт ключ не поддерживает, ENSI игнорирует ревизию ≤ сохранённой.
5. **Чтение при входе**: `GET` по `ENSI_FETCH_PATH`. Тело — `BeautyProfile` либо `{ "data": { "beauty_profile": … } }`. 404 — профиля нет. Импортированная ревизия в outbox пишется как `sent` и повторно не отправляется.
6. **Сеть**: доступ воркера и API к ENSI (allowlist, mTLS), допустимая частота запросов (для `OUTBOX_BATCH_SIZE`).

## Команды очереди

```bash
pnpm ensi:resync                       # статистика очереди
pnpm ensi:resync -- --customer <id>    # перепоставить последнюю ревизию клиента
pnpm ensi:resync -- --dead             # перепоставить всех dead
pnpm ensi:resync -- --all --since 2026-10-01
```

Разбор `dead`: `SELECT customer_id, revision, attempts, last_error FROM ensi_outbox WHERE status='dead'` → причина в
`last_error` (тело ответа ENSI обрезано до 2000 символов) → исправить на стороне ENSI/маппинга → `--dead`.
Прочий 4xx в `dead` не переходит: статус остаётся `failed`, `next_attempt_at` уезжает в 9999 год. Такую ревизию возвращает `--customer`.
