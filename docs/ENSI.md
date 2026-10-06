# Интеграция с ENSI

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
| `http` | `PUT ENSI_BASE_URL + ENSI_PROFILE_PATH` с заголовками авторизации, `Idempotency-Key`, `traceparent` | production |

Переменные для `http`:

```
ENSI_SINK=http
ENSI_BASE_URL=https://ensi.internal
ENSI_PROFILE_PATH=/api/v1/customers/{customer_id}/beauty-profile   # шаблон; {customer_id}, {revision}
ENSI_PROFILE_METHOD=PUT                                             # PUT | POST | PATCH
ENSI_AUTH_HEADER=Authorization
ENSI_AUTH_VALUE=Bearer <service-token>
ENSI_TIMEOUT_MS=10000
ENSI_FETCH_PATH=/api/v1/customers/{customer_id}/beauty-profile      # опционально, входящий поток
```

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

## Что нужно получить от команды ENSI (блокирует только переключение на `http`)

1. **Сервис и эндпоинт**, принимающий профиль клиента: Customers (атрибуты/кастомные поля) или отдельный сервис.
   Нужен OpenAPI-контракт → положить в `packages/ensi-client/openapi/ensi.yaml`, выполнить
   `pnpm --filter @idb/ensi-client generate`, подправить `mapping.ts` под реальные поля (тесты там же).
2. **Авторизация сервис-сервис**: имя заголовка и значение/способ получения токена (`ENSI_AUTH_HEADER` / `ENSI_AUTH_VALUE`).
3. **Идентификатор клиента**: совпадает ли `sub` JWT ЛК с id клиента в ENSI; если нет — нужен эндпоинт маппинга
   (добавляется в `HttpEnsiSink` перед отправкой).
4. **Идемпотентность**: поддерживает ли эндпоинт `Idempotency-Key`; если нет — опираемся на `beauty_profile_revision`
   (ENSI должен игнорировать ревизию ≤ сохранённой).
5. **Обратный поток** (опционально): нужно ли читать профиль из ENSI при первом входе клиента (`ENSI_FETCH_PATH`).
6. **Сеть**: доступ воркера к ENSI (allowlist, mTLS), допустимая частота запросов (для `OUTBOX_BATCH_SIZE`).

## Эксплуатация

```bash
pnpm ensi:resync                       # статистика очереди
pnpm ensi:resync -- --customer <id>    # перепоставить последнюю ревизию клиента
pnpm ensi:resync -- --dead             # перепоставить всех dead
pnpm ensi:resync -- --all --since 2026-10-01
```

Разбор `dead`: `SELECT customer_id, revision, attempts, last_error FROM ensi_outbox WHERE status='dead'` → причина в
`last_error` (тело ответа ENSI обрезано до 2000 символов) → исправить на стороне ENSI/маппинга → `--dead`.
