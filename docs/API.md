# API

OpenAPI 3.1 генерируется из Zod-схем: `GET /api/v1/openapi.json`, Swagger UI — `/docs` (при `SWAGGER_ENABLED=true`).
Конверт ответа — как в ENSI: `{ "data": …, "meta"?: …, "errors"?: [{ "code", "message", "meta"? }] }`.

Аутентификация: `Authorization: Bearer <JWT>` (prod) или `X-Customer-Id: <id>` (dev).

| Метод и путь | Назначение |
|---|---|
| `GET /api/v1/survey?gender=female\|male` | конфиг под пол (ETag/304) |
| `GET /api/v1/me/session` | текущая сессия + `derived` |
| `PUT /api/v1/me/session/answers/{questionKey}` | `{ optionCodes, skipped, timeMs? }` → сессия, `meta.genderReset` |
| `POST /api/v1/me/session/base:complete` | завершить этап 1 → `BeautyProfile` |
| `POST /api/v1/me/session/passport:start` | `{ category }` |
| `POST /api/v1/me/session/passport:complete` | `{ category }` → `BeautyProfile` |
| `POST /api/v1/me/session:reset` | пройти заново |
| `GET /api/v1/me/profile` | последний профиль + статус ENSI |
| `POST /api/v1/events` | `{ events: [{ name, params, ts? }] }` → 202 |
| `GET /api/v1/health`, `/ready`, `GET /metrics` | служебные |

Коды ошибок: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `VALIDATION_ERROR` 422, `QUESTION_NOT_FOUND` 404, `OPTION_NOT_ALLOWED` 422,
`STAGE_NOT_COMPLETE` 409, `BRANCH_NOT_AVAILABLE` 422, `SURVEY_VERSION_MISMATCH` 409, `RATE_LIMITED` 429, `NOT_FOUND` 404, `INTERNAL` 500.

## Примеры

```bash
H='-H X-Customer-Id:demo -H Content-Type:application/json'
curl -s $H localhost:3000/api/v1/me/session | jq .data.stage
curl -s $H -X PUT localhost:3000/api/v1/me/session/answers/gender -d '{"optionCodes":["female"]}' | jq .data.derived
for k in psycho1:E psycho2:E psycho3:P category:face; do
  curl -s $H -X PUT localhost:3000/api/v1/me/session/answers/${k%%:*} -d "{\"optionCodes\":[\"${k##*:}\"]}" > /dev/null; done
curl -s $H -X POST localhost:3000/api/v1/me/session/base:complete | jq '.data | {psychotype, completeness_pct, widgets}'
curl -s $H localhost:3000/api/v1/me/profile | jq .data.ensi
```
