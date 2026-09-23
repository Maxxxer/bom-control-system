/**
 * Реализация базы на PGlite — настоящий PostgreSQL, собранный в WebAssembly.
 *
 * Зачем: локальная разработка и автотесты не должны требовать установленного
 * сервера PostgreSQL, но SQL и типы обязаны совпадать с продакшеном. PGlite даёт
 * именно это. Данные хранятся в каталоге (`dataDir`), то есть переживают
 * перезапуск; в тестах используется режим в памяти.
 */

import { PGlite } from '@electric-sql/pglite';
import type { Database, QueryRow } from './Database.js';

/** Обёртка над клиентом PGlite. */
export class PgliteDatabase implements Database {
  private readonly client: PGlite;

  constructor(client: PGlite) {
    this.client = client;
  }

  /** Открыть базу в каталоге (локальный запуск) — данные сохраняются. */
  static async open(dataDir: string): Promise<PgliteDatabase> {
    const client = new PGlite(dataDir);
    await client.waitReady;
    return new PgliteDatabase(client);
  }

  /** Открыть базу в памяти (тесты) — данные исчезают после закрытия. */
  static async openInMemory(): Promise<PgliteDatabase> {
    const client = new PGlite();
    await client.waitReady;
    return new PgliteDatabase(client);
  }

  async query<Row = QueryRow>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
    const result = await this.client.query(sql, params as unknown[]);
    return result.rows as Row[];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    await this.client.query(sql, params as unknown[]);
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    const result = await this.client.transaction(async (tx) => {
      const wrapped: Database = {
        query: async <Row = QueryRow>(
          sql: string,
          params: readonly unknown[] = [],
        ): Promise<Row[]> => {
          const res = await tx.query(sql, params as unknown[]);
          return res.rows as Row[];
        },
        execute: async (sql: string, params: readonly unknown[] = []): Promise<void> => {
          await tx.query(sql, params as unknown[]);
        },
        transaction: async <Inner>(inner: (innerTx: Database) => Promise<Inner>): Promise<Inner> =>
          inner(wrapped),
        close: async (): Promise<void> => undefined,
      };
      return fn(wrapped);
    });
    return result;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
