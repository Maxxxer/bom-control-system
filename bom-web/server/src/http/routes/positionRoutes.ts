/**
 * Маршруты работы с позицией (сводка дефицитов и карточка материала).
 *
 *   GET  /api/positions/:positionId         — карточка позиции со статусом
 *   GET  /api/positions/:positionId/history — история изменений позиции
 *   POST /api/positions/:positionId/ordered        — «Заказано»
 *   POST /api/positions/:positionId/expected-date  — «Ожидаемая поставка»
 *   POST /api/positions/:positionId/real-delivery  — «Реальная поставка»
 *   POST /api/positions/:positionId/deadline       — «Крайний срок поставки»
 *   POST /api/positions/:positionId/spec           — правка поля спецификации
 *                                                    (исправление «Ошибки данных»)
 *
 * Идентификатор позиции содержит двоеточие и символ `#` (например,
 * `1234.АБВ:AB-12|Bosch#2`), поэтому клиент обязан кодировать его через
 * `encodeURIComponent` — иначе символ `#` обрежет адрес.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import { ValidationError } from '../../errors.js';
import { getPositionHistory } from '../../services/auditService.js';
import {
  getPositionDetail,
  setDeadline,
  setExpectedDate,
  setOrderedQty,
  setRealDeliveryChecked,
  setRealDeliveryQty,
  setSpecField,
} from '../../services/positionService.js';
import { sendOperation } from '../operationReply.js';
import { authenticate, authenticateWithContext, requireBody } from '../requestAuth.js';

/** Идентификатор позиции из адреса запроса. */
function positionIdOf(request: { params: unknown }): string {
  const value = (request.params as { positionId?: unknown })?.positionId;
  const positionId = String(value ?? '').trim();
  if (!positionId) {
    throw new ValidationError('Не указана позиция');
  }
  return positionId;
}

export function registerPositionRoutes(
  app: FastifyInstance,
  db: Database,
  _config: AppConfig,
): void {
  app.get('/api/positions/:positionId', async (request) => {
    await authenticate(db, request);
    return getPositionDetail(db, positionIdOf(request));
  });

  app.get('/api/positions/:positionId/history', async (request) => {
    await authenticate(db, request);
    const history = await getPositionHistory(db, { positionId: positionIdOf(request) });
    return { history };
  });

  app.post('/api/positions/:positionId/ordered', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ qty?: number | string }>(request);
    const result = await setOrderedQty(db, ctx, {
      positionId: positionIdOf(request),
      qty: Number(body.qty ?? 0),
    });
    return sendOperation(reply, result);
  });

  app.post('/api/positions/:positionId/expected-date', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ expectedDate?: string | null }>(request);
    const raw = body.expectedDate;
    const result = await setExpectedDate(db, ctx, {
      positionId: positionIdOf(request),
      expectedDate: raw === undefined || raw === null || String(raw).trim() === ''
        ? null
        : String(raw),
    });
    return sendOperation(reply, result);
  });

  app.post('/api/positions/:positionId/real-delivery', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ qty?: number | string; checked?: boolean }>(request);

    // Интерфейс может прислать либо количество, либо галочку «поставлено» —
    // оба пути ведут к одной операции, поэтому обрабатываются здесь вместе.
    const result =
      body.qty === undefined
        ? await setRealDeliveryChecked(db, ctx, {
            positionId: positionIdOf(request),
            checked: body.checked === true,
          })
        : await setRealDeliveryQty(db, ctx, {
            positionId: positionIdOf(request),
            qty: Number(body.qty),
          });
    return sendOperation(reply, result);
  });

  app.post('/api/positions/:positionId/deadline', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ deadline?: string | null }>(request);
    const result = await setDeadline(db, ctx, {
      positionId: positionIdOf(request),
      deadline: body.deadline === undefined || body.deadline === null ? null : String(body.deadline),
    });
    return sendOperation(reply, result);
  });

  /**
   * Правка одного поля спецификации — исправление «Ошибки данных» после импорта.
   *
   * Значение передаётся как есть (`value`), а проверяет и приводит его сервер:
   * интерфейс не должен угадывать формат даты или допустимость количества.
   */
  app.post('/api/positions/:positionId/spec', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ field?: string; value?: unknown }>(request);
    const result = await setSpecField(db, ctx, {
      positionId: positionIdOf(request),
      field: String(body.field ?? ''),
      value: body.value ?? null,
    });
    return sendOperation(reply, result);
  });
}
