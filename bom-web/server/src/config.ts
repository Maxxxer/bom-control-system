/**
 * Конфигурация сервера. Читается из переменных окружения при запуске.
 *
 * Значения по умолчанию рассчитаны на локальный запуск «из коробки»: сервер
 * поднимается без установленного PostgreSQL (используется PGlite) и создаёт
 * администратора, если пользователей ещё нет.
 *
 * Пути по умолчанию считаются от каталога сервера, а не от текущего каталога
 * процесса: тогда и `npm start`, и запуск из корня репозитория, и запуск тестов
 * находят одну и ту же базу и одну и ту же сборку интерфейса.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Учётная запись администратора, создаваемая при первом запуске. */
export interface SeedConfig {
  login: string;
  password: string;
  fullName: string;
}

export interface AppConfig {
  host: string;
  port: number;
  /** Строка подключения к PostgreSQL. Если не задана — используется PGlite. */
  databaseUrl: string | null;
  /** Каталог данных PGlite (для локального запуска). */
  pgliteDir: string;
  /** Каталог со собранным фронтендом (если существует — раздаётся сервером). */
  staticDir: string;
  /** Срок жизни сессии в днях. */
  sessionTtlDays: number;
  /** Ставить ли cookie с флагом Secure (нужно при работе по HTTPS). */
  cookieSecure: boolean;
  seed: SeedConfig;
}

/** Каталог пакета сервера: `…/bom-web/server` (и из `src`, и из `dist`). */
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Каталог с собранным интерфейсом внутри репозитория (`bom-web/web/dist`). */
const builtWebDir = path.resolve(serverRoot, '..', 'web', 'dist');

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Собрать конфигурацию из окружения.
 *
 * `env` передаётся параметром, чтобы тесты могли задавать свои значения без
 * изменения процесса.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = String(env.DATABASE_URL ?? '').trim();
  const pgliteDir = String(env.PGLITE_DIR ?? '').trim();
  const staticDir = String(env.STATIC_DIR ?? '').trim();

  return {
    host: String(env.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
    port: readInt(env.PORT, 8080),
    databaseUrl: databaseUrl || null,
    pgliteDir: pgliteDir ? path.resolve(pgliteDir) : path.resolve(serverRoot, 'data'),
    staticDir: staticDir ? path.resolve(staticDir) : builtWebDir,
    sessionTtlDays: readInt(env.SESSION_TTL_DAYS, 14),
    cookieSecure: String(env.COOKIE_SECURE ?? '').toLowerCase() === 'true',
    seed: {
      login: String(env.ADMIN_LOGIN ?? 'admin').trim() || 'admin',
      password: String(env.ADMIN_PASSWORD ?? 'admin12345'),
      fullName: String(env.ADMIN_NAME ?? 'Администратор системы').trim(),
    },
  };
}
