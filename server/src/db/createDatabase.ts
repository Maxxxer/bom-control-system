/**
 * Создание подключения к базе и приведение схемы к актуальному виду.
 *
 * Выбор драйвера по конфигурации: если задан `DATABASE_URL` — рабочий
 * PostgreSQL; иначе локальный PGlite (тот же PostgreSQL в WebAssembly), чтобы
 * проект запускался без установки сервера.
 */

import type { AppConfig } from '../config.js';
import type { Database } from './Database.js';
import { PgDatabase } from './pgDatabase.js';
import { PgliteDatabase } from './pgliteDatabase.js';
import { SCHEMA_STATEMENTS } from './schema.js';

/** Открыть базу данных согласно конфигурации. */
export async function createDatabase(config: AppConfig): Promise<Database> {
  if (config.databaseUrl) {
    return PgDatabase.create(config.databaseUrl);
  }
  return PgliteDatabase.open(config.pgliteDir);
}

/** Создать отсутствующие таблицы и индексы. Идемпотентно. */
export async function migrateSchema(db: Database): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execute(statement);
  }
}
