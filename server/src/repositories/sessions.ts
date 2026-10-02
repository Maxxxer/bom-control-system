/**
 * Репозиторий сессий.
 *
 * В базе хранится только ХЕШ токена сессии: если база попадёт в чужие руки,
 * действующие сессии по ней восстановить нельзя. Сам токен живёт только в
 * cookie браузера пользователя.
 */

import type { Database } from '../db/Database.js';

/** Создать сессию. */
export async function createSession(
  db: Database,
  params: { tokenHash: string; userId: number; expiresAt: Date },
): Promise<void> {
  await db.execute(
    `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)`,
    [params.tokenHash, params.userId, params.expiresAt],
  );
}

/** Найти действующую сессию по хешу токена. */
export async function findSession(
  db: Database,
  tokenHash: string,
): Promise<{ userId: number; expiresAt: Date } | null> {
  const rows = await db.query<{ user_id: string | number; expires_at: Date | string }>(
    `select user_id, expires_at from sessions
      where token_hash = $1 and expires_at > now()`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { userId: Number(row.user_id), expiresAt: new Date(row.expires_at) };
}

/** Удалить сессию (выход из системы). */
export async function deleteSession(db: Database, tokenHash: string): Promise<void> {
  await db.execute(`delete from sessions where token_hash = $1`, [tokenHash]);
}

/** Удалить все сессии пользователя (смена пароля, отключение доступа). */
export async function deleteUserSessions(db: Database, userId: number): Promise<number> {
  const rows = await db.query<{ total: number | string }>(
    `with removed as (delete from sessions where user_id = $1 returning 1)
     select count(*)::int as total from removed`,
    [userId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Удалить истёкшие сессии. Вызывается при обслуживании. */
export async function deleteExpiredSessions(db: Database): Promise<number> {
  const rows = await db.query<{ total: number | string }>(
    `with removed as (delete from sessions where expires_at <= now() returning 1)
     select count(*)::int as total from removed`,
  );
  return Number(rows[0]?.total ?? 0);
}
