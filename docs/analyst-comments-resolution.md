# Разбор комментариев аналитика

Документ, который комментировали: «IDB-Опросник · техническая документация для аналитика», сборка 2026-10-06. Генератора этой сборки в репозитории не было: это компиляция `docs/TZ.md`, `docs/API.md`, `docs/ENSI.md` и соседних файлов на ту дату. Актуальная сборка — [`ANALYST.md`](ANALYST.md) от 2026-10-08.

Чётные номера в выгрузке — ответы владельца, не отдельные замечания аналитика. Они включены, потому что по ним менялись документы.

| id | Цитата | Что изменено и где |
|---|---|---|
| ch1 | «в данной задаче встраиваем web компонент?» | Интеграция только по API: фронт ЛК рисует опросник и вызывает методы. Поставка кода — в [`analyst-response.md`](analyst-response.md) и [`ANALYST.md`](ANALYST.md). [`INTEGRATION.md`](INTEGRATION.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`API.md`](API.md), [`README.md`](../README.md) |
| PI2 | «Нет, нативная интеграция по апи» | Применено: интеграция только по API. Журнал: [`DECISIONS.md`](DECISIONS.md), 2026-10-08 |
| ch3 | «будет ли пускать без токенов?» | Только токены пользователей ИЛЬ ДЕ БОТЭ, без токена 401. [`INTEGRATION.md`](INTEGRATION.md), [`ANALYST.md`](ANALYST.md) |
| PI4 | «пускать только по токенам нашей авторизации пользователей» | Применено в тех же разделах авторизации. Режим `AUTH_MODE=dev` в коде оставлен для стенда и в production не стартует |
| ch5 | как проверяется токен, если написано «доверяет JWT ЛК» | Порядок проверки: Bearer, подпись RS256, `iss`, `aud`, `exp`, клейм id = id ENSI. [`INTEGRATION.md`](INTEGRATION.md), [`ANALYST.md`](ANALYST.md) |
| PI6 | «будет, во второй версии ТЗ поправлю» | Закрыто разделом авторизации в [`INTEGRATION.md`](INTEGRATION.md) и [`ANALYST.md`](ANALYST.md) |
| ch7 | зачем фронту `ADMIN_TOKEN` на `GET /api/v1/me/session` | Фронт ЛК шлёт только JWT и не передаёт `version`. Админ-токен нужен только для предпросмотра черновика. [`session.ts`](../apps/api/src/routes/session.ts), [`INTEGRATION.md`](INTEGRATION.md), [`API.md`](API.md) |
| PI8 | «поправлю во второй версии ТЗ» | Закрыто вместе с ch7 |
| ch9 | «в yaml данный параметр просто apiKey называется» | Схема и заголовок названы `X-Api-Key`, значение — `INTEGRATION_API_KEY`. [`app.ts`](../apps/api/src/app.ts), [`integration.ts`](../apps/api/src/routes/integration.ts), [`API.md`](API.md), [`ANALYST.md`](ANALYST.md) |
| ch10 | «эксплуатация это роль?» | Роль убрана. Методы `health` / `ready` / `metrics` названы служебными. Заголовок очереди в ENSI — «Команды очереди». [`API.md`](API.md), [`ENSI.md`](ENSI.md) |
| PI11 | «Невалидно, уберу» | Закрыто вместе с ch10 |
| ch12 | результат уходит push (Kafka, webhook) или только pull API | Push после записи профиля и pull `GET /integration/customers/{id}/profile`. Webhook не реализован. [`ENSI.md`](ENSI.md), [`API.md`](API.md), [`INTEGRATION.md`](INTEGRATION.md) |
| PI13 | «можно будет настроить веб-хук, но нас API не устраивает?» | Webhook не реализован. Действующие каналы — push воркера и pull |
| ch14 | объект `answers` в yaml пустой | Форма: `optionCodes`, `skipped`, `timeMs`, `answeredAt`. [`session.ts`](../apps/api/src/routes/session.ts), [`API.md`](API.md), [`INTEGRATION.md`](INTEGRATION.md), [`ANALYST.md`](ANALYST.md) |
| PI15 | «уточню во второй версии» | Закрыто вместе с ch14 |
| ch16 | когда уходит вызов опросник → ENSI: целиком или частями | После `base:complete`, после каждого `passport:complete` и после завершения, которое следует за повторным прохождением. Не после ответа, не после reset, не при открытии. [`API.md`](API.md), [`ENSI.md`](ENSI.md), [`INTEGRATION.md`](INTEGRATION.md) |
| PI17 | «уточню во второй версии» | Закрыто вместе с ch16 |
| ch18 | список полей неполный, или дата показана как «…» | Все поля `BeautyProfile` и фиксированные ключи `attributes` перечислены. [`ENSI.md`](ENSI.md), [`API.md`](API.md), [`ANALYST.md`](ANALYST.md) |
| ch19 | это виджет → backend или ENSI → backend | Сессия — фронт ЛК → API. Push — воркер → ENSI. Pull — система с `X-Api-Key` → API. Чтение при входе — API → ENSI. [`ARCHITECTURE.md`](ARCHITECTURE.md), [`API.md`](API.md), [`ANALYST.md`](ANALYST.md) |
| ch20 | зачем хранить опросник | Публикация без деплоя, одна опубликованная версия, сессия живёт на своей версии, фронт и другие системы забирают текст отсюда. [`ARCHITECTURE.md`](ARCHITECTURE.md), [`API.md`](API.md), [`ANALYST.md`](ANALYST.md) |
| ch21 | «статус доставки» — доставка чего, это статус в meta? | Статус отправки профиля красоты в ENSI. `GET /me/profile` → `data.ensi.status`. Pull → `meta.ensi.status`. [`API.md`](API.md), [`ENSI.md`](ENSI.md), [`ANALYST.md`](ANALYST.md), [`session.ts`](../apps/api/src/routes/session.ts) |
