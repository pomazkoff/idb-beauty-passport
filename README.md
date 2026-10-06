# ИЛЬ ДЕ БОТЭ · Опросник ЛК / Паспорт красоты

Веб-сервис двухэтапного опросника для личного кабинета: база (психотип + набор виджетов ЛК) → Паспорт красоты (профиль по категориям). Профиль передаётся в ENSI через адаптер с гарантией доставки.

Полное ТЗ — [`docs/TZ.md`](docs/TZ.md). Журнал решений — [`docs/DECISIONS.md`](docs/DECISIONS.md). Эксплуатация — [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Интеграция — [`docs/ENSI.md`](docs/ENSI.md).

## Быстрый старт (только Node, без Docker и PostgreSQL)

```bash
corepack enable && pnpm install
pnpm demo
# опросник     → http://localhost:5173/?customer=demo
# конструктор  → http://localhost:5174          (токен: dev-admin-token-change-me)
# API/Swagger  → http://localhost:3000/docs
# ENSI-API     → GET http://localhost:3000/api/v1/integration/surveys/current  (X-Api-Key: dev-integration-key-change-me)
# профили «в ENSI» → ./.ensi-out/*.json;  база → ./.pgdata (встроенная PGlite);  pnpm demo --reset — начать заново
```

Нужен Node ≥ 22. База — встроенный PostgreSQL ([PGlite](https://pglite.dev)) в файлах `./.pgdata`, воркер доставки в ENSI в этом режиме работает внутри API. Тесты (`pnpm test`) тоже идут на PGlite в памяти, если не задан `TEST_DATABASE_URL`.

## Запуск в Docker

```bash
docker compose up --build
# web      → http://localhost:8080          опросник (эталон / предпросмотр)
# admin    → http://localhost:8081          конструктор (токен: dev-admin-token-change-me)
# api      → http://localhost:3000/api/v1  (Swagger: http://localhost:3000/docs)
# ENSI     → GET http://localhost:3000/api/v1/integration/surveys/current  (X-Api-Key: dev-integration-key-change-me)
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

Сервис — источник правды по опроснику и результатам: продакт собирает опросник в **конструкторе** и публикует версию;
**ENSI** и фронты ЛК забирают опубликованный опросник по сервисному API (`X-Api-Key`) и рисуют его сами (или встраивают
эталонный web-компонент); ответы приходят в API сервиса, он считает психотип/виджеты/заполненность и **пушит профиль в ENSI**
через outbox. Подробнее: `docs/ENSI.md`.

## Что внутри

- 63 вопроса в 10 ветках (3 общие для обоих полов) со стабильными кодами — `docs/content-map.md`
- Тесты: 99 (контент) + 42 (движок, 100 % строк) + 29 (API, живой PostgreSQL) + 11 (воркер) + 9 (ENSI-адаптер) + 7 (контроллер UI) + e2e (Playwright + axe)
- Встраиваемый web-компонент `<idb-beauty-quiz>` — 18–20 KB gzip

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
