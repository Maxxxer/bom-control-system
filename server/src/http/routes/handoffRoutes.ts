/**
 * Маршруты передачи материала производству и возврата из архива.
 *
 *   POST /api/handoff               — передать позиции производству
 *   POST /api/return-from-archive   — вернуть позиции в работу (с причиной)
 *   GET  /api/handoff/readiness     — какие из выбранных строк можно передать
 *
 * Передаётся СПИСОК позиций: в прежней системе отборщик отмечал строки и отправлял
 * их одним нажатием, поэтому операция сразу принимает набор.
 *
 * Ответ содержит результат по каждой позиции — заблокированные строки не мешают
 * передать остальные, а пользователь видит причину по каждой.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import { SOURCE_UI } from '../../domain/constants.js';
import { ValidationError } from '../../errors.js';
import { findPositionByPositionId } from '../../repositories/positions.js';
import { getArchive } from '../../services/auditService.js';
import { handoffReadiness, markReceivedByProduction, returnFromArchive } from '../../services/handoffService.js';
import { authenticate, authenticateWithContext, requireBody } from '../requestAuth.js';

/** Прочитать список позиций из тела запроса. */
function positionIdsOf(body: { positionIds?: unknown; positionId?: unknown }): string[] {
  const raw = Array.isArray(body.positionIds)
    ? body.positionIds
    : body.positionId !== undefined
      ? [body.positionId]
      : [];
  const ids = raw.map((value) => String(value ?? '').trim()).filter((value) => value.length > 0);
  if (!ids.length) {
    throw new ValidationError('Не выбрано ни одной позиции');
  }
  return ids;
}

export function registerHandoffRoutes(
  app: FastifyInstance,
  db: Database,
  _config: AppConfig,
): void {
  app.post('/api/handoff', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ positionIds?: unknown; positionId?: unknown; source?: string }>(request);
    const result = await markReceivedByProduction(db, ctx, {
      positionIds: positionIdsOf(body),
      source: body.source === SOURCE_UI.WORKING_BOM ? SOURCE_UI.WORKING_BOM : SOURCE_UI.PICKING,
    });
    // Если ничего не передано и что-то заблокировано — отвечаем 409, чтобы
    // интерфейс показал причины, а не «успех без изменений».
    if (result.handedOff === 0 && result.blocked > 0) {
      return reply.code(409).send(result);
    }
    return reply.send(result);
  });

  app.post('/api/return-from-archive', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ positionIds?: unknown; positionId?: unknown; reason?: string }>(request);
    const result = await returnFromArchive(db, ctx, {
      positionIds: positionIdsOf(body),
      reason: String(body.reason ?? ''),
    });
    if (result.returned === 0) {
      return reply.code(409).send(result);
    }
    return reply.send(result);
  });

  // Архив передач нужен и производству (посмотреть, что и когда ушло в цех), а не
  // только администратору, поэтому список доступен любому вошедшему.
  app.get('/api/archive', async (request) => {
    await authenticate(db, request);
    const query = (request.query ?? {}) as { limit?: unknown; positionId?: unknown };
    const limit = Number(query.limit);
    const positionId = query.positionId === undefined ? undefined : String(query.positionId);
    const rows = await getArchive(db, {
      limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined,
      positionId,
    });
    return { rows };
  });

  app.post('/api/handoff/readiness', async (request) => {
    await authenticate(db, request);
    const body = requireBody<{ positionIds?: unknown; positionId?: unknown }>(request);
    const ids = positionIdsOf(body);
    const checks: Array<{ positionId: string; allowed: boolean; reason: string; state: string }> = [];
    for (const positionId of ids) {
      const position = await findPositionByPositionId(db, positionId);
      if (!position) {
        checks.push({
          positionId,
          allowed: false,
          reason: 'Позиция не найдена',
          state: 'NOT_FOUND',
        });
        continue;
      }
      const readiness = handoffReadiness(position);
      checks.push({
        positionId,
        allowed: readiness.allowed,
        reason: readiness.reason,
        state: readiness.state,
      });
    }
    return { checks, canHandoff: checks.filter((check) => check.allowed).length };
  });
}
