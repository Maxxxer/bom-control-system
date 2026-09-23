/**
 * Маршруты обслуживания журнала: откат ранее выполненной команды.
 *
 *   POST /api/operations/:operationId/rollback — вернуть значения, записанные командой
 *
 * Почему отдельный модуль, а не маршрут в `adminRoutes.ts`. Вернуть свою правку
 * должен уметь тот, кто её сделал: снабженец — заказ, экономист — поставку и срок.
 * Права проверяются ПО ПОЛЯМ записи журнала (`rollbackService`), а не по роли
 * целиком, поэтому здесь достаточно действующей сессии, а отказ по конкретному
 * полю приходит причиной в ответе — как в массовой правке.
 *
 * Причина обязательна: возврат меняет данные, которыми уже пользуются другие роли,
 * и по журналу должно быть понятно, почему это сделано.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import { rollbackOperation } from '../../services/rollbackService.js';
import { sendRollbackReply } from '../operationReply.js';
import { authenticateWithContext, requireBody } from '../requestAuth.js';

export function registerOperationRoutes(
  app: FastifyInstance,
  db: Database,
  _config: AppConfig,
): void {
  app.post('/api/operations/:operationId/rollback', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ reason?: unknown }>(request);
    const params = (request.params ?? {}) as { operationId?: unknown };
    const result = await rollbackOperation(db, ctx, {
      operationId: String(params.operationId ?? '').trim(),
      reason: String(body.reason ?? ''),
    });
    return sendRollbackReply(reply, result);
  });
}
