/**
 * Права доступа — перенос `v12CanEditField`, `v12RequireRole` (`v12_roles.js`).
 *
 * Отличие от прежней системы принципиальное: там роль определялась по e-mail из
 * таблицы в коде и права проверялись «в момент применения» из-за ограничений
 * триггеров Google. Здесь пользователь аутентифицирован, его роль известна
 * серверу, и каждая операция проверяется на входе — двойная проверка не нужна.
 */

import {
  PERMISSION_LABEL,
  PERMISSION_WILDCARD,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  type PermissionAction,
} from './constants.js';
import type { Role } from './types.js';

/** Список разрешённых действий роли (без административной «звёздочки»). */
export function permissionsOf(role: Role): PermissionAction[] {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  if (granted.includes(PERMISSION_WILDCARD)) {
    return Object.keys(PERMISSION_LABEL) as PermissionAction[];
  }
  return granted.filter((action): action is PermissionAction => action !== PERMISSION_WILDCARD);
}

/** Есть ли у роли право на действие. Неизвестная роль не имеет прав. */
export function can(role: Role, action: PermissionAction): boolean {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  return granted.includes(PERMISSION_WILDCARD) || granted.includes(action);
}

/** Ошибка «нет права»: HTTP-слой превращает её в ответ 403. */
export class PermissionDeniedError extends Error {
  readonly action: PermissionAction;
  readonly role: Role;

  constructor(action: PermissionAction, role: Role) {
    super(
      `Недостаточно прав: роль «${ROLE_LABEL[role] ?? role}» не может ${
        PERMISSION_LABEL[action] ?? action
      }`,
    );
    this.name = 'PermissionDeniedError';
    this.action = action;
    this.role = role;
  }
}

/** Проверить право или выбросить `PermissionDeniedError`. */
export function requirePermission(role: Role, action: PermissionAction): void {
  if (!can(role, action)) {
    throw new PermissionDeniedError(action, role);
  }
}

/** Описание доступа пользователя (для экрана «Мой доступ»). */
export interface AccessDescription {
  role: Role;
  roleLabel: string;
  allowed: Array<{ action: PermissionAction; label: string }>;
}

export function describeAccess(role: Role): AccessDescription {
  return {
    role,
    roleLabel: ROLE_LABEL[role] ?? role,
    allowed: permissionsOf(role).map((action) => ({ action, label: PERMISSION_LABEL[action] })),
  };
}
