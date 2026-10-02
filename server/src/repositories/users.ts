/**
 * Репозиторий пользователей.
 *
 * Пользователь — учётная запись с ролью. Пароль хранится только в виде хеша
 * (см. `services/password.ts`); репозиторий о паролях ничего не знает и работает
 * с уже готовым хешем.
 *
 * Функции без состояния: первым аргументом идёт соединение с базой, поэтому один
 * и тот же репозиторий используется и в приложении, и внутри транзакций.
 */

import type { Database } from '../db/Database.js';
import type { Role } from '../domain/types.js';

/** Пользователь без секретов (то, что можно отдавать в интерфейс). */
export interface UserRecord {
  id: number;
  login: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

/** Пользователь вместе с хешем пароля (только для проверки входа). */
export interface UserWithPassword extends UserRecord {
  passwordHash: string;
}

interface UserRow {
  id: string | number;
  login: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: Date | string;
  password_hash?: string;
}

const USER_COLUMNS = 'id, login, full_name, role, is_active, created_at';

function mapUser(row: UserRow): UserRecord {
  return {
    id: Number(row.id),
    login: row.login,
    fullName: row.full_name,
    role: row.role as Role,
    isActive: row.is_active === true,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Список пользователей (для админки). */
export async function listUsers(db: Database): Promise<UserRecord[]> {
  const rows = await db.query<UserRow>(`select ${USER_COLUMNS} from users order by login asc`);
  return rows.map(mapUser);
}

/** Найти пользователя по логину (вход в систему). */
export async function findUserByLogin(
  db: Database,
  login: string,
): Promise<UserWithPassword | null> {
  const rows = await db.query<UserRow>(
    `select ${USER_COLUMNS}, password_hash from users where lower(login) = lower($1)`,
    [login],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { ...mapUser(row), passwordHash: row.password_hash ?? '' };
}

/** Найти пользователя по идентификатору (проверка сессии). */
export async function findUserById(db: Database, id: number): Promise<UserRecord | null> {
  const rows = await db.query<UserRow>(`select ${USER_COLUMNS} from users where id = $1`, [id]);
  const row = rows[0];
  return row ? mapUser(row) : null;
}

/** Создать пользователя. Логин уникален — повтор даст ошибку базы. */
export async function createUser(
  db: Database,
  params: { login: string; fullName: string; role: Role; passwordHash: string },
): Promise<UserRecord> {
  const rows = await db.query<UserRow>(
    `insert into users (login, full_name, role, password_hash)
     values ($1, $2, $3, $4)
     returning ${USER_COLUMNS}`,
    [params.login, params.fullName, params.role, params.passwordHash],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Не удалось создать пользователя');
  }
  return mapUser(row);
}

/** Изменить профиль пользователя (роль, имя, активность). */
export async function updateUser(
  db: Database,
  id: number,
  changes: { fullName?: string; role?: Role; isActive?: boolean },
): Promise<UserRecord | null> {
  const rows = await db.query<UserRow>(
    `update users set
       full_name  = coalesce($2, full_name),
       role       = coalesce($3, role),
       is_active  = coalesce($4, is_active),
       updated_at = now()
     where id = $1
     returning ${USER_COLUMNS}`,
    [
      id,
      changes.fullName === undefined ? null : changes.fullName,
      changes.role === undefined ? null : changes.role,
      changes.isActive === undefined ? null : changes.isActive,
    ],
  );
  const row = rows[0];
  return row ? mapUser(row) : null;
}

/** Заменить хеш пароля. */
export async function updatePassword(
  db: Database,
  id: number,
  passwordHash: string,
): Promise<void> {
  await db.execute(`update users set password_hash = $2, updated_at = now() where id = $1`, [
    id,
    passwordHash,
  ]);
}

/** Сколько пользователей в системе (нужно для создания первого администратора). */
export async function countUsers(db: Database): Promise<number> {
  const rows = await db.query<{ total: number | string }>(
    `select count(*)::int as total from users`,
  );
  return Number(rows[0]?.total ?? 0);
}
