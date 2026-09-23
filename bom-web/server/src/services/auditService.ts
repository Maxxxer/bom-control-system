/**
 * Просмотр следов работы: журнал действий, история позиции и архив передач.
 *
 * Это «расследовательский» контур системы. Он нужен, чтобы ответить на вопросы
 * «кто изменил заказ», «почему позиция снова активна» и «когда материал ушёл в
 * производство». Ничего не изменяется: только чтение.
 */

import type { Database } from '../db/Database.js';
import type { AuditRecord } from '../repositories/auditLog.js';
import { listAudit } from '../repositories/auditLog.js';
import { listArchive, listArchiveByPosition, type ArchiveRecord } from '../repositories/archive.js';
import { listHistory, type HistoryRecord } from '../repositories/positionHistory.js';
import { LIMITS } from '../domain/constants.js';

/** Ограничение количества строк в ответе. */
function clampLimit(limit: number | undefined, fallback: number): number {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), LIMITS.MAX_LIST_LIMIT);
}

/** Последние события журнала действий. */
export async function getAuditLog(
  db: Database,
  params: { limit?: number; positionId?: string; bomId?: string } = {},
): Promise<AuditRecord[]> {
  return listAudit(db, {
    limit: clampLimit(params.limit, 200),
    positionId: params.positionId,
    bomId: params.bomId,
  });
}

/** История одной позиции (что происходило с материалом). */
export async function getPositionHistory(
  db: Database,
  params: { positionId: string; limit?: number },
): Promise<HistoryRecord[]> {
  return listHistory(db, params.positionId, clampLimit(params.limit, 100));
}

/** Последние записи архива переданных материалов. */
export async function getArchive(
  db: Database,
  params: { limit?: number; positionId?: string } = {},
): Promise<ArchiveRecord[]> {
  if (params.positionId) {
    return listArchiveByPosition(db, params.positionId);
  }
  return listArchive(db, clampLimit(params.limit, 200));
}
