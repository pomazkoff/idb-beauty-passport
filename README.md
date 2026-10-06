# ИЛЬ ДЕ БОТЭ · Опросник ЛК / Паспорт красоты

Веб-сервис двухэтапного опросника для личного кабинета: база (психотип + набор виджетов ЛК) → Паспорт красоты (профиль по категориям). Профиль передаётся в ENSI через адаптер с гарантией доставки.

Полное ТЗ — [`docs/TZ.md`](docs/TZ.md). Журнал решений — [`docs/DECISIONS.md`](docs/DECISIONS.md). Эксплуатация — [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Интеграция — [`docs/ENSI.md`](docs/ENSI.md).

## Быстрый старт (Docker)

```bash
docker compose up --build
# web      → http://localhost:8080
# api      → http://localhost:3000/api/v1  (Swagger: http://localhost:3000/docs)
# профили, ушедшие «в ENSI» (FileEnsiSink) → ./.ensi-out/*.json
```

## Локальная разработка

```bash
pnpm install
cp .env.example .env            # DATABASE_URL, AUTH_MODE=dev
pnpm --filter "./packages/*" build
pnpm db:migrate && pnpm db:seed
pnpm dev                        # api :3000, worker, web :5173
```

В dev-режиме (`AUTH_MODE=dev`) пользователь задаётся заголовком `X-Customer-Id`; фронт берёт его из `?customer=` в URL (по умолчанию `demo`).

## Структура

```
apps/api            Fastify REST API, Prisma, auth, outbox
apps/worker         доставка профилей в ENSI
apps/web            React: standalone-страница и web-компонент <idb-beauty-quiz>
packages/core       чистый движок: ветвление, психотип, заполненность, виджеты, профиль
packages/survey-config  survey.v1.json + Zod-схема + валидатор + генератор content-map
packages/db         Prisma-схема и клиент
packages/ensi-client    EnsiSink (mock | file | http) + маппинг профиля
docs/source         прототип и исходное ТЗ логики
```

## Команды

| Команда | Что делает |
|---|---|
| `pnpm test` | unit + contract тесты всех пакетов |
| `pnpm test:e2e` | Playwright-сценарии (нужны поднятые api и postgres) |
| `pnpm survey:validate` | валидация `survey.v1.json` по схеме и контрольным числам |
| `pnpm survey:content-map` | перегенерировать `docs/content-map.md` |
| `pnpm survey:extract` | снапшот контента из прототипа → `docs/source/prototype-content.snapshot.json` |
| `pnpm ensi:resync -- --customer <id>` | ручной ресинк профиля в ENSI |
