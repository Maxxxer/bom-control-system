/**
 * Маршруты входа и личного доступа.
 *
 *   POST /api/auth/login     — войти (ставит cookie сессии)
 *   POST /api/auth/logout    — выйти (удаляет cookie и сессию)
 *   GET  /api/auth/me        — кто я (данные и список прав)
 *   POST /api/auth/password  — сменить свой пароль
 *   GET  /api/meta           — справочники для интерфейса (роли и подписи прав)
 *
 * Права отдаются интерфейсу, чтобы он показывал только доступные действия. Это
 * удобство, а не защита: сервер проверяет права повторно на каждой операции.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import { PERMISSION_LABEL, ROLE_LABEL, ROLE_LIST, SESSION } from '../../domain/constants.js';
import { permissionsOf } from '../../domain/permissions.js';
import { requireUser, changeOwnPassword, login, logout } from '../../services/authService.js';
import {
  authenticate,
  clearSessionCookie,
  readSessionToken,
  requireBody,
  setSessionCookie,
} from '../requestAuth.js';

/** Описать пользователя для интерфейса: роль и её права. */
function toSessionUser(user: {
  id: number;
  login: string;
  fullName: string;
  role: keyof typeof ROLE_LABEL;
}) {
  return {
    id: user.id,
    login: user.login,
    fullName: user.fullName,
    role: user.role,
    roleLabel: ROLE_LABEL[user.role] ?? String(user.role),
    permissions: permissionsOf(user.role),
  };
}

export function registerAuthRoutes(app: FastifyInstance, db: Database, config: AppConfig): void {
  app.post('/api/auth/login', async (request, reply) => {
    const body = requireBody<{ login?: string; password?: string }>(request);
    const result = await login(db, {
      login: String(body.login ?? ''),
      password: String(body.password ?? ''),
      ttlDays: config.sessionTtlDays || SESSION.TTL_DAYS,
    });
    setSessionCookie(reply, config, result.token, result.expiresAt);
    return reply.send({ user: toSessionUser(result.user) });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await logout(db, readSessionToken(request));
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request) => {
    const user = await authenticate(db, request);
    return { user: toSessionUser(user) };
  });

  app.post('/api/auth/password', async (request, reply) => {
    const user = await authenticate(db, request);
    const body = requireBody<{ currentPassword?: string; newPassword?: string }>(request);
    await changeOwnPassword(db, user.id, {
      currentPassword: String(body.currentPassword ?? ''),
      newPassword: String(body.newPassword ?? ''),
    });
    // Проверяем, что сессия ещё действует после смены пароля.
    await requireUser(db, readSessionToken(request));
    return reply.code(204).send();
  });

  app.get('/api/meta', async () => ({
    roles: ROLE_LIST.map((role) => ({ role, label: ROLE_LABEL[role] })),
    permissions: PERMISSION_LABEL,
    sessionTtlDays: config.sessionTtlDays || SESSION.TTL_DAYS,
  }));
}
