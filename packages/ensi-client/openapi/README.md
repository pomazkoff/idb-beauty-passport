# OpenAPI-контракт ENSI

Положите сюда файл `ensi.yaml` — OpenAPI-спецификацию целевого сервиса ENSI (Customers или
кастомный сервис, который принимает профиль клиента). Затем:

```bash
pnpm --filter @idb/ensi-client generate   # → src/http/generated/ensi.d.ts (openapi-typescript)
```

и типизируйте запрос в `src/http/http-sink.ts` через `openapi-fetch` (уже в зависимостях).
До этого адаптер работает по шаблону пути `ENSI_PROFILE_PATH` и конверту `{data, errors}`.
Список того, что нужно получить от команды ENSI, — в `docs/ENSI.md`.
