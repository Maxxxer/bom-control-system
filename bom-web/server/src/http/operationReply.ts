/**
 * Единый формат ответа на операцию.
 *
 * Операции возвращают `{ status, reason?, ... }`. Смысл статусов:
 *   * `applied` — изменение применено;
 *   * `already` — состояние уже такое (повторный щелчок, ничего не изменилось);
 *   * `blocked` — операция запрещена правилами (не хватает материала, позиция
 *     невалидна и т. п.). Это НЕ ошибка сервера: клиент получает код 409 и текст
 *     причины, чтобы показать его пользователю рядом со строкой.
 *
 * Один помощник на все маршруты гарантирует, что интерфейс всегда видит
 * одинаковую структуру ответа и может показать сообщение без разбора кодов.
 */

import type { FastifyReply } from 'fastify';

import type { OperationResult } from '../services/positionService.js';
import type { RollbackResult } from '../services/rollbackService.js';

/**
 * Общая часть ответа массовой операции.
 *
 * Тип СТРУКТУРНЫЙ, а не конкретный результат: у правки позиций и у правки склада
 * свои формы ответа (у склада нет обновлённых позиций), но правило выбора кода
 * ответа у них одно — «ничего не применилось и что-то отклонено → 409».
 */
interface BulkOutcome {
  applied: number;
  blocked: number;
}

/** Отправить результат операции в ответ. */
export function sendOperation(reply: FastifyReply, result: OperationResult): FastifyReply {
  if (result.status === 'blocked') {
    return reply.code(409).send({
      status: result.status,
      reason: result.reason ?? 'Операция не выполнена',
      notice: result.notice ?? '',
      position: result.position ?? null,
    });
  }
  return reply.send({
    status: result.status,
    reason: result.reason ?? '',
    notice: result.notice ?? '',
    position: result.position ?? null,
  });
}

/**
 * Отправить результат массовой операции (вставка блока ячеек).
 *
 * Форма ответа ДРУГАЯ, чем у одиночной операции, поэтому и помощник отдельный:
 * здесь на каждое изменение приходит свой результат, а не один статус. Код 409
 * используется только тогда, когда не применилось НИЧЕГО, а что-то отклонено —
 * ровно как в передаче производству: так интерфейс показывает причины, а не
 * «успех без изменений». Частичный успех — обычный ответ 200, иначе клиент принял
 * бы применённые строки за ошибку.
 */
export function sendBulkReply<Result extends BulkOutcome>(
  reply: FastifyReply,
  result: Result,
): FastifyReply {
  const body = { ...result };
  if (result.applied === 0 && result.blocked > 0) {
    return reply.code(409).send(body);
  }
  return reply.send(body);
}

/**
 * Отправить результат отката команды.
 *
 * Здесь, кроме отклонённых записей, есть ещё «уже так» (значение уже равно
 * прежнему — повторный откат): это тоже успешный исход, а не отказ.
 */
export function sendRollbackReply(reply: FastifyReply, result: RollbackResult): FastifyReply {
  const body = { ...result };
  if (result.applied === 0 && result.already === 0 && result.blocked > 0) {
    return reply.code(409).send(body);
  }
  return reply.send(body);
}
