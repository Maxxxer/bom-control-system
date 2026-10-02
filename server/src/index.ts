/**
 * Точка входа сервера.
 *
 * Порядок запуска:
 *   1. прочитать настройки окружения;
 *   2. подключиться к базе (PostgreSQL при заданном `DATABASE_URL`, иначе PGlite);
 *   3. привести схему к актуальному виду (идемпотентно);
 *   4. создать первого администратора, если учётных записей ещё нет;
 *   5. убрать истёкшие сессии;
 *   6. поднять HTTP-сервер.
 *
 * При остановке (Ctrl+C или сигнал от системы) сервер закрывается аккуратно:
 * сначала перестаёт принимать запросы, затем закрывается соединение с базой.
 */

import { loadConfig } from './config.js';
import { createDatabase, migrateSchema } from './db/createDatabase.js';
import { buildServer } from './http/server.js';
import { purgeExpiredSessions } from './services/authService.js';
import { ensureInitialAdmin } from './services/seedService.js';

/** Запустить сервер. */
async function main(): Promise<void> {
  const config = loadConfig();
  const db = await createDatabase(config);
  await migrateSchema(db);

  const seed = await ensureInitialAdmin(db, config.seed);
  if (seed.created) {
    console.log(`Создан администратор: ${seed.login}`);
    if (seed.usesDefaultPassword) {
      console.warn(
        'ВНИМАНИЕ: используется пароль администратора по умолчанию. ' +
          'Смените его сразу после входа (раздел «Мой доступ»).',
      );
    }
  }

  const purged = await purgeExpiredSessions(db);
  if (purged > 0) {
    console.log(`Удалено истёкших сессий: ${purged}`);
  }

  const app = await buildServer(config, db);
  await app.listen({ host: config.host, port: config.port });

  const storage = config.databaseUrl ? 'PostgreSQL' : `PGlite (${config.pgliteDir})`;
  console.log(`BOM CONTROL SYSTEM: сервер запущен на http://localhost:${config.port}`);
  console.log(`Хранилище данных: ${storage}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Получен сигнал ${signal}: останавливаю сервер…`);
    try {
      await app.close();
      await db.close();
      console.log('Сервер остановлен');
      process.exit(0);
    } catch (error) {
      console.error('Ошибка при остановке сервера:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Не удалось запустить сервер:', error);
  process.exit(1);
});
