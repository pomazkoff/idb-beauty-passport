import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Загружает .env (Node ≥ 21.7, process.loadEnvFile) из cwd или ближайшего родителя —
 * pnpm --filter запускает скрипты из каталога пакета, а .env лежит в корне монорепо.
 * Уже заданные переменные окружения не перезаписываются. В production .env обычно нет — это не ошибка.
 */
export function loadDotenv(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    const f = join(dir, ".env");
    if (existsSync(f)) {
      const before = { ...process.env };
      try {
        process.loadEnvFile(f);
      } catch {
        return null;
      }
      // loadEnvFile не перезаписывает существующие — но на всякий случай восстановим явно заданные
      for (const [k, v] of Object.entries(before)) process.env[k] = v;
      return f;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
