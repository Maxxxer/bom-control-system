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
