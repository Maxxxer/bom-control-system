/**
 * Единая фиксация изменений: журнал действий + история позиции.
 *
 * Зачем объединено: любая правка обязана оставить след в обоих местах, и делать
 * это двумя независимыми вызовами из каждого сервиса — верный способ рано или
 * поздно забыть один из них. Здесь одна функция записывает и запись журнала, и
 * запись истории позиции, причём внутри той же транзакции, что и саму правку.
 *
 * `operationId` — идентификатор команды: если пользователь одной кнопкой передал
 * десять позиций, все десять записей журнала получат один и тот же идентификатор,
 * и по журналу будет видно, что это одно нажатие.
 */

import { randomUUID } from 'node:crypto';

import type { Database } from '../db/Database.js';
import type { Role } from '../domain/types.js';
import { formatLogValue, insertAudit, type AuditEntry } from '../repositories/auditLog.js';
import { insertHistory, type HistoryEntry } from '../repositories/positionHistory.js';

/** Кто и в рамках какой команды выполняет изменения. */
export interface OperationContext {
  /** Логин пользователя (для аудита используется логин, а не id). */
  actor: string;
  /** Роль на момент операции: роль может измениться, а журнал должен помнить. */
  role: Role;
  /** Идентификатор команды. */
  operationId: string;
}

/** Создать контекст операции (одна команда = один идентификатор). */
export function createOperationContext(actor: string, role: Role): OperationContext {
  return { actor, role, operationId: randomUUID() };
}

/** Описание одного изменения для журнала и истории. */
export interface ChangeRecord {
  action: string;
  positionId?: string;
  bomId?: string;
  field?: string;
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
  reason?: string;
  /** Событие истории позиции. Если не задано, история не пишется. */
  historyEvent?: string;
  /** Комментарий истории (по умолчанию совпадает с причиной). */
  historyComment?: string;
}

/**
 * Записать изменения в журнал и (при необходимости) в историю позиции.
 *
 * Все записи идут одним запросом на таблицу, поэтому фиксация целой команды не
 * превращается в сотни отдельных обращений к базе.
 */
export async function recordChanges(
  tx: Database,
  ctx: OperationContext,
  changes: readonly ChangeRecord[],
): Promise<void> {
  if (!changes.length) {
    return;
  }

  const auditEntries: AuditEntry[] = changes.map((change) => ({
    operationId: ctx.operationId,
    actor: ctx.actor,
    action: change.action,
    bomId: change.bomId,
    positionId: change.positionId,
    field: change.field,
    oldValue: change.oldValue,
    newValue: change.newValue,
    reason: change.reason ?? '',
  }));
  await insertAudit(tx, auditEntries);

  const historyEntries: HistoryEntry[] = changes
    .filter((change) => Boolean(change.historyEvent) && Boolean(change.positionId))
    .map((change) => ({
      positionId: change.positionId as string,
      event: change.historyEvent as string,
      oldValue: formatLogValue(change.oldValue),
      newValue: formatLogValue(change.newValue),
      actor: ctx.actor,
      comment: change.historyComment ?? change.reason ?? '',
    }));
  await insertHistory(tx, historyEntries);
}

/** Человекочитаемые названия действий для журнала (совпадают с прежней системой). */
export const AUDIT_ACTION = {
  ORDERED_QTY: 'ORDERED_QTY_CHANGED',
  EXPECTED_DATE: 'EXPECTED_DATE_CHANGED',
  REAL_DELIVERY: 'REAL_DELIVERY_RECORDED',
  DEADLINE: 'DEADLINE_CHANGED',
  SPEC_FIELD: 'SPECIFICATION_FIELD_CHANGED',
  RESERVED_QTY: 'RESERVED_QTY_CHANGED',
  WAREHOUSE_QTY: 'WAREHOUSE_QTY_CHANGED',
  HANDOFF: 'PRODUCTION_HANDOFF',
  RETURN_FROM_ARCHIVE: 'RETURN_FROM_ARCHIVE',
  BOM_IMPORT: 'BOM_IMPORTED',
  BOM_DONE: 'BOM_MARKED_DONE',
  BOM_RETURNED: 'BOM_RETURNED_TO_WORK',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_PASSWORD: 'USER_PASSWORD_CHANGED',
  LOGIN: 'LOGIN',
} as const;

/** События истории позиции. */
export const HISTORY_EVENT = {
  ORDERED_QTY: 'ORDERED_QTY',
  EXPECTED_DATE: 'EXPECTED_DATE',
  REAL_DELIVERY: 'REAL_DELIVERY',
  DEADLINE: 'DEADLINE',
  SPEC_FIELD: 'SPEC_FIELD',
  RESERVED_QTY: 'RESERVED_QTY',
  HANDOFF: 'PRODUCTION_HANDOFF',
  RETURN_FROM_ARCHIVE: 'RETURN_FROM_ARCHIVE',
} as const;
