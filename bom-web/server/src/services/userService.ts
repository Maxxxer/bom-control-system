/**
 * Управление учётными записями (рабочее место администратора).
 *
 * Здесь два правила безопасности, которые нельзя обойти:
 *
 * 1. Нельзя отключить или лишить прав последнего действующего администратора —
 *    иначе в систему больше некому будет войти.
 * 2. Нельзя отключить собственную учётную запись: администратор, отключивший
 *    себя, теряет доступ немедленно.
 *
 * Смена роли или пароля удаляет сессии пользователя: изменения прав должны
 * вступать в силу сразу, а не после того, как истекут старые cookie.
 */

import type { Database } from '../db/Database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { Role } from '../domain/types.js';
import { ROLE_LABEL } from '../domain/constants.js';
import { permissionsOf } from '../domain/permissions.js';
import {
  createUser,
  findUserByLogin,
  listUsers,
  updatePassword,
  updateUser,
  type UserRecord,
} from '../repositories/users.js';
import { deleteUserSessions } from '../repositories/sessions.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password.js';

/** Учётная запись глазами администратора: данные + набор прав. */
export interface UserView extends UserRecord {
  roleLabel: string;
  permissions: string[];
}

function toView(user: UserRecord): UserView {
  return {
    ...user,
    roleLabel: ROLE_LABEL[user.role] ?? user.role,
    permissions: permissionsOf(user.role),
  };
}

/** Все учётные записи с расшифровкой прав. */
export async function listUsersWithAccess(db: Database): Promise<UserView[]> {
  const users = await listUsers(db);
  return users.map(toView);
}

/** Проверить, что логин пригоден: без пробелов и служебных символов. */
function normalizeLogin(login: string): string {
  const value = String(login ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(value)) {
    throw new ValidationError(
      'Логин: 3–32 символа, разрешены латинские буквы, цифры, точка, дефис и подчёркивание',
    );
  }
  return value;
}

/** Сколько действующих администраторов в системе. */
async function countActiveAdmins(db: Database, excludeUserId: number | null): Promise<number> {
  const users = await listUsers(db);
  return users.filter(
    (user) => user.role === 'admin' && user.isActive && user.id !== excludeUserId,
  ).length;
}

/** Создать учётную запись. */
export async function createUserByAdmin(
  db: Database,
  params: { login: string; fullName: string; role: Role; password: string },
): Promise<UserView> {
  const login = normalizeLogin(params.login);
  const fullName = String(params.fullName ?? '').trim();
  if (!fullName) {
    throw new ValidationError('Укажите ФИО сотрудника');
  }
  if (!isKnownRole(params.role)) {
    throw new ValidationError('Неизвестная роль');
  }
  if (String(params.password ?? '').length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Пароль должен содержать не меньше ${MIN_PASSWORD_LENGTH} символов`);
  }

  const existing = await findUserByLogin(db, login);
  if (existing) {
    throw new ConflictError(`Пользователь с логином «${login}» уже существует`);
  }

  const created = await createUser(db, {
    login,
    fullName,
    role: params.role,
    passwordHash: await hashPassword(params.password),
  });
  return toView(created);
}

/** Изменить роль, имя, активность и (при необходимости) пароль. */
export async function updateUserByAdmin(
  db: Database,
  params: {
    userId: number;
    actorId: number;
    fullName?: string;
    role?: Role;
    isActive?: boolean;
    password?: string;
  },
): Promise<UserView> {
  const users = await listUsers(db);
  const target = users.find((user) => user.id === params.userId);
  if (!target) {
    throw new NotFoundError('Пользователь не найден');
  }

  if (params.role !== undefined && !isKnownRole(params.role)) {
    throw new ValidationError('Неизвестная роль');
  }
  if (params.fullName !== undefined && !String(params.fullName).trim()) {
    throw new ValidationError('Укажите ФИО сотрудника');
  }
  if (params.password !== undefined && params.password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Пароль должен содержать не меньше ${MIN_PASSWORD_LENGTH} символов`);
  }

  const losesAdminRights =
    target.role === 'admin' &&
    (params.role !== undefined && params.role !== 'admin' ? true : false);

  const becomesInactive =
    target.isActive && params.isActive === false;

  if (target.isActive && target.role === 'admin' && (losesAdminRights || becomesInactive)) {
    const others = await countActiveAdmins(db, target.id);
    if (others === 0) {
      throw new ConflictError(
        'Это единственный действующий администратор: сначала назначьте другого',
      );
    }
  }

  if (target.id === params.actorId && becomesInactive) {
    throw new ConflictError('Нельзя отключить собственную учётную запись');
  }

  const updated = await updateUser(db, target.id, {
    fullName: params.fullName === undefined ? undefined : String(params.fullName).trim(),
    role: params.role,
    isActive: params.isActive,
  });
  if (!updated) {
    throw new NotFoundError('Пользователь не найден');
  }

  if (params.password !== undefined) {
    await updatePassword(db, target.id, await hashPassword(params.password));
  }

  // Изменение прав или пароля должно действовать немедленно, поэтому все
  // действующие сессии этого пользователя закрываются.
  const rightsChanged =
    params.password !== undefined ||
    (params.role !== undefined && params.role !== target.role) ||
    (params.isActive !== undefined && params.isActive !== target.isActive);
  if (rightsChanged) {
    await deleteUserSessions(db, target.id);
  }

  return toView(updated);
}

/** Роли, которые система знает и умеет проверять. */
function isKnownRole(role: unknown): role is Role {
  return typeof role === 'string' && Object.prototype.hasOwnProperty.call(ROLE_LABEL, role);
}
