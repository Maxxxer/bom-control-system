/**
 * Маршруты администратора: пользователи, журнал, архив.
 *
 *   GET   /api/admin/users        — список учётных записей с их правами
 *   POST  /api/admin/users        — создать учётную запись
 *   PATCH /api/admin/users/:id    — изменить роль, ФИО, доступ или пароль
 *   GET   /api/admin/audit        — журнал действий
 *   GET   /api/admin/summary      — сводка «сколько чего в системе»
 *
 * Архив переданных материалов выдаётся общим маршрутом `GET /api/archive`: он
 * нужен и производству, а не только администратору.
 *
 * Доступ ко всем маршрутам требует права «управление пользователями и доступами»
 * (администратор). Право проверяется на сервере, даже если интерфейс и не показал
 * раздел: скрытая кнопка защитой не является.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import type { Role } from '../../domain/types.js';
import { requirePermission } from '../../domain/permissions.js';
import { ValidationError } from '../../errors.js';
import { countUsers, listUsers } from '../../repositories/users.js';
import { getAuditLog } from '../../services/auditService.js';
import { createUserByAdmin, listUsersWithAccess, updateUserByAdmin } from '../../services/userService.js';
import { authenticate, requireBody } from '../requestAuth.js';

/** Идентификатор пользователя из адреса запроса. */
function userIdOf(request: { params: unknown }): number {
  const value = (request.params as { id?: unknown })?.id;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError('Некорректный идентификатор пользователя');
  }
  return id;
}

/** Необязательный строковый параметр запроса. */
function queryString(query: unknown, name: string): string | undefined {
  const value = (query as Record<string, unknown> | undefined)?.[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

/** Необязательное числовое ограничение количества строк. */
function queryLimit(query: unknown): number | undefined {
  const value = (query as Record<string, unknown> | undefined)?.limit;
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
}

export function registerAdminRoutes(app: FastifyInstance, db: Database, _config: AppConfig): void {
  app.get('/api/admin/users', async (request) => {
    const user = await authenticate(db, request);
    requirePermission(user.role, 'USER_ADMIN');
    const users = await listUsersWithAccess(db);
    return { users };
  });

  app.post('/api/admin/users', async (request, reply) => {
    const actor = await authenticate(db, request);
    requirePermission(actor.role, 'USER_ADMIN');

    const body = requireBody<{ login?: string; fullName?: string; role?: Role; password?: string }>(
      request,
    );
    const created = await createUserByAdmin(db, {
      login: String(body.login ?? ''),
      fullName: String(body.fullName ?? ''),
      role: body.role as Role,
      password: String(body.password ?? ''),
    });
    return reply.code(201).send({ user: created });
  });

  app.patch('/api/admin/users/:id', async (request, reply) => {
    const actor = await authenticate(db, request);
    requirePermission(actor.role, 'USER_ADMIN');

    const body = requireBody<{
      fullName?: string;
      role?: Role;
      isActive?: boolean;
      password?: string;
    }>(request);
    const updated = await updateUserByAdmin(db, {
      userId: userIdOf(request),
      actorId: actor.id,
      fullName: body.fullName === undefined ? undefined : String(body.fullName),
      role: body.role,
      isActive: body.isActive === undefined ? undefined : body.isActive === true,
      password: body.password === undefined ? undefined : String(body.password),
    });
    return reply.send({ user: updated });
  });

  app.get('/api/admin/audit', async (request) => {
    const user = await authenticate(db, request);
    requirePermission(user.role, 'USER_ADMIN');
    const events = await getAuditLog(db, {
      limit: queryLimit(request.query),
      bomId: queryString(request.query, 'bomId'),
      positionId: queryString(request.query, 'positionId'),
    });
    return { events };
  });

  app.get('/api/admin/summary', async (request) => {
    const user = await authenticate(db, request);
    requirePermission(user.role, 'USER_ADMIN');
    const [users, totalUsers] = await Promise.all([listUsers(db), countUsers(db)]);
    return {
      users: {
        total: totalUsers,
        active: users.filter((item) => item.isActive).length,
        admins: users.filter((item) => item.role === 'admin').length,
      },
    };
  });
}
