/**
 * Реализация базы на PostgreSQL (драйвер `pg`). Используется в продакшене,
 * когда задан `DATABASE_URL`.
 *
 * Транзакция выполняется на ВЫДЕЛЕННОМ соединении из пула: иначе операторы
 * транзакции могли бы уйти на разные соединения и часть работы осталась бы
 * незафиксированной. Соединение всегда возвращается в пул.
 */

import pg from 'pg';
import type { Database, QueryRow } from './Database.js';

/** Обёртка над пулом соединений PostgreSQL. */
export class PgDatabase implements Database {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /** Подключиться по строке соединения. */
  static create(connectionString: string): PgDatabase {
    const pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    return new PgDatabase(pool);
  }

  async query<Row = QueryRow>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
    const result = await this.pool.query(sql, params as unknown[]);
    return result.rows as Row[];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    await this.pool.query(sql, params as unknown[]);
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const wrapped: Database = {
      query: async <Row = QueryRow>(
        sql: string,
        params: readonly unknown[] = [],
      ): Promise<Row[]> => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as Row[];
      },
      execute: async (sql: string, params: readonly unknown[] = []): Promise<void> => {
        await client.query(sql, params as unknown[]);
      },
      transaction: async <Inner>(inner: (innerTx: Database) => Promise<Inner>): Promise<Inner> =>
        inner(wrapped),
      close: async (): Promise<void> => undefined,
    };

    try {
      await client.query('begin');
      const result = await fn(wrapped);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // Откат уже не важен: соединение вернётся в пул, ошибка уйдёт наверх.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
