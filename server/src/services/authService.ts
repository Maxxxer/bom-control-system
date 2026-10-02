/**
 * Вход в систему, сессии и смена пароля.
 *
 * Как устроено: при успешном входе создаётся НЕПРЕДСКАЗУЕМЫЙ токен, он
 * возвращается браузеру в защищённой cookie и одновременно сохраняется в базе —
 * но только в виде хеша. Проверка сессии идёт по хешу, а сам токен нигде, кроме
 * cookie пользователя, не хранится. Потеря доступа отключается удалением сессии.
 *
 * Все ошибки входа одинаковы по тексту: нельзя подсказывать, существует ли
 * логин в системе.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Database } from '../db/Database.js';
import { AuthenticationError, ValidationError } from '../errors.js';
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findSession,
} from '../repositories/sessions.js';
import { findUserById, findUserByLogin, updatePassword, type UserRecord } from '../repositories/users.js';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password.js';

/** Длина токена сессии в байтах (в строке — больше из-за base64url). */
const TOKEN_BYTES = 32;

/** Результат успешного входа. */
export interface LoginResult {
  token: string;
  user: UserRecord;
  expiresAt: Date;
}

/** Хеш токена для хранения и поиска в базе. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Создать новый токен сессии. */
function createToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Войти по логину и паролю.
 *
 * Учётная запись должна быть активной: отключённого пользователя система не
 * пускает даже с верным паролем.
 */
export async function login(
  db: Database,
  params: { login: string; password: string; ttlDays: number },
): Promise<LoginResult> {
  const login = String(params.login ?? '').trim();
  const password = String(params.password ?? '');
  if (!login || !password) {
    throw new ValidationError('Укажите логин и пароль');
  }

  const found = await findUserByLogin(db, login);
  if (!found) {
    throw new AuthenticationError('Неверный логин или пароль');
  }
  const ok = await verifyPassword(password, found.passwordHash);
  if (!ok) {
    throw new AuthenticationError('Неверный логин или пароль');
  }
  if (!found.isActive) {
    throw new AuthenticationError('Учётная запись отключена. Обратитесь к администратору');
  }

  const token = createToken();
  const expiresAt = new Date(Date.now() + params.ttlDays * 24 * 60 * 60 * 1000);
  await createSession(db, { tokenHash: hashToken(token), userId: found.id, expiresAt });

  const { passwordHash: _ignored, ...user } = found;
  return { token, user, expiresAt };
}

/**
 * Определить пользователя по токену сессии.
 *
 * Если сессия истекла или пользователь отключён — сессия удаляется, а вызывающая
 * сторона получает ошибку входа.
 */
export async function requireUser(db: Database, token: string | null): Promise<UserRecord> {
  if (!token) {
    throw new AuthenticationError();
  }
  const session = await findSession(db, hashToken(token));
  if (!session) {
    throw new AuthenticationError('Сессия истекла, войдите заново');
  }
  const user = await findUserById(db, session.userId);
  if (!user || !user.isActive) {
    await deleteSession(db, hashToken(token));
    throw new AuthenticationError('Учётная запись недоступна, войдите заново');
  }
  return user;
}

/** Выйти: сессия удаляется, токен больше не действует. */
export async function logout(db: Database, token: string | null): Promise<void> {
  if (!token) {
    return;
  }
  await deleteSession(db, hashToken(token));
}

/**
 * Смена своего пароля.
 *
 * Требуется текущий пароль — иначе чужой доступ к открытому рабочему месту
 * позволил бы сменить пароль владельца. Все прочие сессии пользователя при этом
 * сохраняются: смена пароля не выбрасывает человека с других устройств.
 */
export async function changeOwnPassword(
  db: Database,
  userId: number,
  params: { currentPassword: string; newPassword: string },
): Promise<void> {
  const newPassword = String(params.newPassword ?? '');
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Пароль должен содержать не меньше ${MIN_PASSWORD_LENGTH} символов`);
  }
  const found = await findUserById(db, userId);
  if (!found) {
    throw new AuthenticationError();
  }
  const current = await findUserByLogin(db, found.login);
  if (!current || !(await verifyPassword(String(params.currentPassword ?? ''), current.passwordHash))) {
    throw new ValidationError('Текущий пароль указан неверно');
  }
  if (await verifyPassword(newPassword, current.passwordHash)) {
    throw new ValidationError('Новый пароль совпадает с текущим');
  }
  await updatePassword(db, userId, await hashPassword(newPassword));
}

/** Удалить истёкшие сессии (вызывается при старте и по расписанию). */
export async function purgeExpiredSessions(db: Database): Promise<number> {
  return deleteExpiredSessions(db);
}
