/**
 * Откат ранее выполненной команды по журналу действий.
 *
 * Зачем это возможно без отдельной схемы хранения «снимков состояния». Журнал
 * (`audit_log`) уже хранит по каждой правке: поле, прежнее значение, новое
 * значение и идентификатор команды. Значит, чтобы вернуть состояние, достаточно
 * прочитать записи команды и записать обратно ПРЕЖНИЕ значения — ничего
 * дополнительно хранить не нужно.
 *
 * Что важно и почему так:
 *
 *   * пишем через тот же путь, что и обычная правка (`applyChangeToPosition` из
 *     `bulkService.ts`): иначе откат «Поставлено» не вернул бы склад, а откат
 *     крайнего срока — не прошёл бы проверку формата;
 *   * записи отката помечаются ДРУГИМ действием (`OPERATION_ROLLBACK`) и получают
 *     СВОЙ идентификатор команды: по журналу видно и то, что значение вернули, и по
 *     какой команде это сделано. Сам откат тоже оказывается одной командой — и,
 *     если понадобится, его тоже можно откатить;
 *   * причина обязательна: возврат меняет данные, которыми уже пользуются другие
 *     роли, и по журналу должно быть понятно, почему это сделано;
 *   * строка, значение которой изменили ПОСЛЕ откатываемой команды, не трогается:
 *     молча затирать чужую более позднюю работу нельзя. Такая ячейка получает
 *     отказ с причиной, остальные возвращаются;
 *   * записи, для которых правила возврата нет (передача производству, складской
 *     остаток, отметка «Выполнено»), не откатываются — они получают отказ с
 *     объяснением. Делать вид, что откат возможен, было бы хуже отказа.
 */

import type { Database } from '../db/Database.js';
import {
  auditFieldToBulkField,
  BULK_FIELD_LABEL,
  bulkPermission,
  normalizeBulkValue,
} from '../domain/bulkFields.js';
import { LIMITS } from '../domain/constants.js';
import { can } from '../domain/permissions.js';
import type { Position } from '../domain/position.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { formatLogValue, listAuditByOperation } from '../repositories/auditLog.js';
import {
  findPositionByPositionId,
  listPositionsByPositionIds,
} from '../repositories/positions.js';
import { applyChangeToPosition, currentBulkValueOf } from './bulkService.js';
import {
  AUDIT_ACTION,
  recordChanges,
  type ChangeRecord,
  type OperationContext,
} from './operationLog.js';

/** Результат возврата одной записи команды. */
export interface RollbackItemResult {
  positionId: string;
  /** Поле в том виде, как оно записано в журнале (`ORDERED_QTY`, `SPEC.MODEL`). */
  field: string;
  status: 'applied' | 'already' | 'blocked';
  reason: string;
  /** Прежнее значение (его и возвращаем). */
  restoredValue: string;
}

/** Итог отката команды. */
export interface RollbackResult {
  /** Команда, которую откатывали. */
  sourceOperationId: string;
  /** Идентификатор команды отката — его получили новые записи журнала. */
  operationId: string;
  applied: number;
  already: number;
  blocked: number;
  results: RollbackItemResult[];
  positions: Position[];
}

/** Короткая ссылка на команду для текста причины (полный UUID в сообщении — шум). */
function shortId(operationId: string): string {
  return operationId.slice(0, 8);
}

/**
 * Вернуть значения, записанные указанной командой.
 *
 * Порядок: чтение записей журнала → проверка причины и размера → одна транзакция
 * (проверка поля, права, «не изменили ли после», возврат значения) → один
 * `recordChanges` → чтение обновлённых позиций.
 */
export async function rollbackOperation(
  db: Database,
  ctx: OperationContext,
  params: { operationId: string; reason: string },
): Promise<RollbackResult> {
  const sourceOperationId = String(params.operationId ?? '').trim();
  if (!sourceOperationId) {
    throw new ValidationError('Не указана операция для отката');
  }
  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new ConflictError('Не указана причина отката');
  }

  const entries = await listAuditByOperation(db, sourceOperationId);
  if (!entries.length) {
    throw new NotFoundError('В журнале нет записей этой операции');
  }
  if (entries.length > LIMITS.MAX_BULK_CHANGES) {
    throw new ValidationError(
      `Операция содержит ${entries.length} изменений — это больше, чем можно откатить ` +
        `одной командой (${LIMITS.MAX_BULK_CHANGES}). Верните строки по частям.`,
    );
  }

  const outcome = await db.transaction(async (tx) => {
    const results: RollbackItemResult[] = [];
    const records: ChangeRecord[] = [];

    for (const entry of entries) {
      const journalField = String(entry.field ?? '').trim();
      const entryPositionId = String(entry.positionId ?? '').trim();
      const refuse = (text: string): void => {
        results.push({
          positionId: entryPositionId,
          field: journalField,
          status: 'blocked',
          reason: text,
          restoredValue: entry.oldValue,
        });
      };

      const field = auditFieldToBulkField(journalField);
      if (!field || !entryPositionId) {
        refuse(
          'Эту запись вернуть нельзя: для неё нет правила отката ' +
            '(передача производству, складской остаток и отметка «Выполнено» откатываются вручную)',
        );
        continue;
      }

      if (!can(ctx.role, bulkPermission(field))) {
        refuse(`Ваша роль не может вернуть «${BULK_FIELD_LABEL[field]}»`);
        continue;
      }

      const checked = normalizeBulkValue(field, entry.oldValue);
      if (!checked.ok) {
        refuse(`Прежнее значение не разбирается: ${checked.error}`);
        continue;
      }

      const position = await findPositionByPositionId(tx, entryPositionId);
      if (!position) {
        refuse(`Позиция не найдена: ${entryPositionId}`);
        continue;
      }
      if (position.lifecycle === 'REMOVED') {
        refuse('Позиция удалена из спецификации');
        continue;
      }

      // Защита от затирания более поздней работы: возвращаем только ту строку,
      // которая всё ещё хранит то, что записала откатываемая команда.
      if (formatLogValue(currentBulkValueOf(position, field)) !== formatLogValue(entry.newValue)) {
        refuse('Значение изменили после этой операции — строка пропущена');
        continue;
      }

      const applied = await applyChangeToPosition(tx, position, field, checked.value, records);
      results.push({
        positionId: entryPositionId,
        field: journalField,
        status: applied.status,
        reason: '',
        restoredValue: entry.oldValue,
      });
    }

    // Записи возврата помечаются своим действием и своей причиной, но остаются
    // ТЕМИ ЖЕ записями полей: видно, какое поле и что в нём было/стало.
    for (const record of records) {
      record.action = AUDIT_ACTION.ROLLBACK;
      record.reason = `Откат операции ${shortId(sourceOperationId)}: ${reason}`;
      record.historyComment = `Откат операции ${shortId(sourceOperationId)}: ${reason}`;
    }
    await recordChanges(tx, ctx, records);

    const touched = [
      ...new Set(
        results.filter((item) => item.status !== 'blocked').map((item) => item.positionId),
      ),
    ];
    const positions = await listPositionsByPositionIds(tx, touched);

    return { results, positions };
  });

  return {
    sourceOperationId,
    operationId: ctx.operationId,
    applied: outcome.results.filter((item) => item.status === 'applied').length,
    already: outcome.results.filter((item) => item.status === 'already').length,
    blocked: outcome.results.filter((item) => item.status === 'blocked').length,
    results: outcome.results,
    positions: outcome.positions,
  };
}
