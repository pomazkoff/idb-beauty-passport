# ИЛЬ ДЕ БОТЭ · Опросник ЛК / Паспорт красоты

Веб-сервис двухэтапного опросника для личного кабинета: база (психотип + набор виджетов ЛК) → Паспорт красоты (профиль по категориям). Готовый web-компонент сам ходит в API этого сервиса. Профиль в ENSI отправляет воркер. При открытии опросника для залогиненного клиента API читает уже сохранённый профиль из ENSI.

| Кому | Документ |
|---|---|
| Команда ЛК: встройка | [`docs/INTEGRATION.md`](docs/INTEGRATION.md) |
| Где крутится сервис и что снаружи | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Все методы: кто вызывает и когда | [`docs/API.md`](docs/API.md) |
| Приём профиля в ENSI | [`docs/ENSI.md`](docs/ENSI.md) |
| Ответы аналитику | [`docs/analyst-response.md`](docs/analyst-response.md) |
| Эксплуатация | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| Журнал решений | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| Исходное ТЗ (есть расхождения с кодом) | [`docs/TZ.md`](docs/TZ.md) |

## Быстрый старт (только Node, без Docker и PostgreSQL)

```bash
corepack enable && pnpm install
pnpm demo
# опросник     → http://localhost:5173/?customer=demo
# конструктор  → http://localhost:5174          (токен: dev-admin-token-change-me)
# API/Swagger  → http://localhost:3000/docs
# чтение опросника ключом (web-компонент этот метод не вызывает) → GET http://localhost:3000/api/v1/integration/surveys/current  (X-Api-Key: dev-integration-key-change-me)
# профили «в ENSI» → ./.ensi-out/*.json;  база → ./.pgdata (встроенная PGlite);  pnpm demo --reset — начать заново
```

Нужен Node ≥ 22. База — встроенный PostgreSQL ([PGlite](https://pglite.dev)) в файлах `./.pgdata`, воркер доставки в ENSI в этом режиме работает внутри API. Тесты (`pnpm test`) тоже идут на PGlite в памяти, если не задан `TEST_DATABASE_URL`.

## Запуск в Docker

```bash
docker compose up --build
# web      → http://localhost:8080          опросник (эталон / предпросмотр)
# admin    → http://localhost:8081          конструктор (токен: dev-admin-token-change-me)
# api      → http://localhost:3000/api/v1  (Swagger: http://localhost:3000/docs)
# чтение опросника ключом → GET http://localhost:3000/api/v1/integration/surveys/current  (X-Api-Key: dev-integration-key-change-me)
# профили, ушедшие «в ENSI» (FileEnsiSink) → ./.ensi-out/*.json
```

## Локальная разработка

```bash
pnpm install
cp .env.example .env            # DATABASE_URL, AUTH_MODE=dev — .env подхватывается автоматически (из корня монорепо)
pnpm --filter "./packages/*" build
pnpm db:migrate && pnpm db:seed
pnpm dev                        # api :3000, worker, web :5173, admin :5174
```

В dev-режиме (`AUTH_MODE=dev`) пользователь задаётся заголовком `X-Customer-Id`; фронт берёт его из `?customer=` в URL (по умолчанию `demo`).

## Как это устроено

Production работает в инфраструктуре ИЛЬ ДЕ БОТЭ: статика `https://beauty-quiz.iledebeaute.ru`, API `https://beauty-api.iledebeaute.ru`. Сервис хранит опросник и считает результат. Продакт публикует версию в конструкторе. Личный кабинет встраивает web-компонент `<idb-beauty-quiz>` и передаёт JWT, который выпустил backend ЛК. Компонент сам забирает конфиг (`GET /api/v1/survey`) и сдаёт ответы методами сессии. API пишет профиль в outbox, воркер отправляет его в ENSI. Контракт приёма профиля принадлежит ENSI.

Сервисное чтение по `X-Api-Key` (`/api/v1/integration/...`) нужно системе, которая забирает текст опросника или профиль без JWT. Web-компонент эти маршруты не вызывает. Схема — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Что внутри

- 63 вопроса в 10 ветках конфига (3 общие для обоих полов: `shared_sun`, `shared_perfume`, `shared_home`) со стабильными кодами — `docs/content-map.md`
- Тесты: `pnpm test` (Vitest) и `pnpm test:e2e` (Playwright + axe)
- Встраиваемый web-компонент `<idb-beauty-quiz>` — сборка `apps/web/dist/embed/`

## Структура

```
apps/api            Fastify REST API, Drizzle, auth, outbox
apps/worker         доставка профилей в ENSI
apps/web            React: эталонный опросник (standalone, web-компонент, предпросмотр черновиков)
apps/admin          конструктор опросника для продакта (версии, редактор, проверка, публикация)
packages/core       чистый движок: ветвление, психотип, заполненность, виджеты, профиль
packages/survey-config  survey.v1.json + Zod-схема + валидатор + генератор content-map
packages/db         Drizzle-схема, SQL-миграции и клиент
packages/ensi-client    EnsiSink (mock | file | http) + маппинг профиля
docs/source         прототип и исходное ТЗ логики
```

## Команды

| Команда | Что делает |
|---|---|
| `pnpm demo` | всё разом на встроенной базе (PGlite): миграции, демо-данные, api, web, admin; `--reset` стирает базу |
| `pnpm test` | unit + contract тесты всех пакетов (PGlite в памяти; `TEST_DATABASE_URL` — чтобы гонять на настоящем PostgreSQL) |
| `pnpm test:e2e` | Playwright-сценарии; сам поднимает api и vite, нужен только postgres (`PW_CHROMIUM_PATH=…`, если браузеры Playwright не установлены) |
| `pnpm survey:validate` | валидация `survey.v1.json` по схеме и контрольным числам |
| `pnpm survey:content-map` | перегенерировать `docs/content-map.md` |
| `pnpm survey:extract` | снапшот контента из прототипа → `docs/source/prototype-content.snapshot.json` |
| `pnpm ensi:resync -- --customer <id>` | ручной ресинк профиля в ENSI |
