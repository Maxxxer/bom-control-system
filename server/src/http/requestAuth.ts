/**
 * Определение пользователя по cookie и работа с cookie сессии.
 *
 * Токен сессии живёт ТОЛЬКО в cookie и передаётся браузером автоматически.
 * Каждый защищённый обработчик вызывает `authenticate` (или
 * `authenticateWithContext`, если операция пишет в журнал) — то есть проверка
 * входа происходит до любого обращения к данным, а не «где-то в глубине».
 *
 * Cookie ставится `httpOnly` (недоступна скриптам на странице) и `sameSite=lax`
 * (не отправляется на чужие сайты), что закрывает и кражу токена через XSS, и
 * подделку запросов с постороннего сайта.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
// Импорт плагина необходим не только во время работы: он добавляет к типам
// Fastify методы `setCookie` / `clearCookie`, без него компилятор их не видит.
import '@fastify/cookie';

import type { AppConfig } from '../config.js';
import type { Database } from '../db/Database.js';
import { SESSION } from '../domain/constants.js';
import type { Role } from '../domain/types.js';
import { AuthenticationError } from '../errors.js';
import type { UserRecord } from '../repositories/users.js';
import { requireUser as requireUserByToken } from '../services/authService.js';
import { createOperationContext, type OperationContext } from '../services/operationLog.js';

/** Прочитать токен сессии из cookie запроса. */
export function readSessionToken(request: FastifyRequest): string | null {
  const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
  const token = cookies?.[SESSION.COOKIE_NAME];
  return token && token.trim() ? token : null;
}

/** Определить пользователя; без действующей сессии — ошибка 401. */
export async function authenticate(db: Database, request: FastifyRequest): Promise<UserRecord> {
  return requireUserByToken(db, readSessionToken(request));
}

/**
 * Определить пользователя и создать контекст операции.
 *
 * Контекст содержит логин (для журнала), роль (для проверки прав) и общий
 * идентификатор команды — он объединяет все записи журнала, сделанные одним
 * нажатием кнопки.
 */
export async function authenticateWithContext(
  db: Database,
  request: FastifyRequest,
): Promise<{ user: UserRecord; ctx: OperationContext }> {
  const user = await authenticate(db, request);
  return { user, ctx: createOperationContext(user.login, user.role) };
}

/** Поставить cookie сессии. */
export function setSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(SESSION.COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires: expiresAt,
  });
}

/** Удалить cookie сессии (выход из системы). */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION.COOKIE_NAME, { path: '/' });
}

/** Описание доступа текущего пользователя для интерфейса. */
export interface SessionUserView {
  id: number;
  login: string;
  fullName: string;
  role: Role;
  roleLabel: string;
  permissions: string[];
}

/**
 * Убедиться, что запрос пришёл с непустым телом-объектом.
 *
 * Fastify допускает пустое тело у POST; операции же ожидают параметры, поэтому
 * проверка делается здесь, чтобы каждый маршрут не повторял её по-своему.
 */
export function requireBody<Body>(request: FastifyRequest): Body {
  const body = request.body;
  if (!body || typeof body !== 'object') {
    throw new AuthenticationError('Не переданы данные запроса');
  }
  return body as Body;
}
