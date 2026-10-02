/**
 * Массовая правка позиций одной командой (вставка блока ячеек из Excel).
 *
 * Устройство повторяет передачу материала производству (`handoffService.ts`) —
 * это уже проверенный в системе образец массовой операции:
 *
 *   * на входе СПИСОК изменений, а не одно;
 *   * дедупликация «одна позиция — одно поле»: если ячейка попала в пачку дважды,
 *     побеждает последнее значение;
 *   * ОДНА транзакция на всю команду: либо применяется вся пачка, либо ничего;
 *   * по каждому изменению СВОЙ результат — запрещённая или неразбираемая ячейка не
 *     отменяет остальные (частичный успех);
 *   * ОДИН `recordChanges` в конце: в журнале действий вся вставка выглядит как одна
 *     операция с одним идентификатором, а не как сотня независимых правок;
 *   * повторное значение («уже так») в журнал не пишется — иначе шум от повторных
 *     вставок заполнил бы журнал.
 *
 * Почему права проверяются ЗДЕСЬ построчно, а не `requirePermission` на входе.
 * Одиночная операция бросает `PermissionDeniedError` (HTTP 403) и отменяет запрос
 * целиком — для одной ячейки это правильно. При вставке блока в нём легко
 * оказывается колонка, которую роль не ведёт (снабженец скопировал вместе с
 * «Крайним сроком»): отменять из-за этого всю вставку нельзя, поэтому такая
 * ячейка получает статус `blocked` с причиной, а остальные применяются.
 */

import type { Database } from '../db/Database.js';
import {
  BULK_FIELD_LABEL,
  bulkPermission,
  isBulkField,
  normalizeBulkValue,
  type BulkField,
  type BulkValue,
} from '../domain/bulkFields.js';
import { LIMITS } from '../domain/constants.js';
import { can } from '../domain/permissions.js';
import type { Position } from '../domain/position.js';
import { describeKeyNote, type SpecField } from '../domain/specFields.js';
import { isChecked, toQty } from '../domain/values.js';
import { ConflictError, ValidationError } from '../errors.js';
import { adjustWarehouseQty } from '../repositories/materials.js';
import {
  findPositionByPositionId,
  listPositionsByPositionIds,
  updateOperatingFields,
  updatePositionSpec,
} from '../repositories/positions.js';
import {
  AUDIT_ACTION,
  HISTORY_EVENT,
  recordChanges,
  type ChangeRecord,
  type OperationContext,
} from './operationLog.js';
import { currentSpecValue, materialIdentity, specWithField } from './positionService.js';

/** Одно изменение: какую позицию, какое поле и на какое значение. */
export interface BulkChangeInput {
  positionId: string;
  field: string;
  value: unknown;
}

/** Результат по одному изменению (для показа пользователю построчно). */
export interface BulkItemResult {
  positionId: string;
  field: string;
  status: 'applied' | 'already' | 'blocked';
  /** Причина отказа (пусто у применённых). */
  reason: string;
  /** Пояснение к применённому изменению (например, про ключ материала). */
  notice: string;
}

/** Итог команды массовой правки. */
export interface BulkResult {
  results: BulkItemResult[];
  applied: number;
  already: number;
  blocked: number;
  /** Идентификатор команды: по нему вся пачка видна в журнале как одно действие. */
  operationId: string;
  /**
   * Обновлённые позиции.
   *
   * Возвращаются, чтобы интерфейс мог обновить строки, не перечитывая витрину
   * целиком: при вставке блока перезагрузка экрана на каждую ячейку была бы
   * отдельной проблемой.
   */
  positions: Position[];
}

/** Итог применения одного изменения к позиции. */
export interface AppliedChange {
  status: 'applied' | 'already';
  notice: string;
}

/** Значение поля позиции в том виде, в каком оно хранится. */
export function currentBulkValueOf(position: Position, field: BulkField): BulkValue {
  switch (field) {
    case 'orderedQty':
      return position.quantities.orderedQty;
    case 'realDeliveryQty':
      return position.quantities.realDeliveryQty;
    case 'realDeliveryChecked':
      return position.quantities.realDeliveryQty > 0;
    case 'expectedDate':
      return position.expectedDate;
    default:
      return currentSpecValue(position, field);
  }
}

/** Записать «Поставлено» количеством: склад меняется на дельту. */
async function applyRealDelivery(
  tx: Database,
  position: Position,
  nextQty: number,
  records: ChangeRecord[],
): Promise<AppliedChange> {
  const previousQty = position.quantities.realDeliveryQty;
  if (previousQty === nextQty) {
    return { status: 'already', notice: '' };
  }

  const delta = nextQty - previousQty;
  const today = new Date().toISOString().slice(0, 10);
  const nextDate = nextQty > 0 ? position.realDeliveryDate ?? today : null;

  await updateOperatingFields(tx, position.positionId, {
    realDeliveryQty: nextQty,
    realDeliveryDate: nextDate,
  });
  if (delta !== 0) {
    // Приём тот же, что при одиночной поставке: описание материала пишется в
    // складскую запись, а остаток меняется НА ДЕЛЬТУ. Несколько позиций одного
    // материала в одной пачке дают суммарную дельту — `adjustWarehouseQty`
    // складывает её с текущим остатком.
    await adjustWarehouseQty(tx, position.materialKey, delta, materialIdentity(position));
  }

  records.push({
    action: AUDIT_ACTION.REAL_DELIVERY,
    bomId: position.bomId,
    positionId: position.positionId,
    field: 'REAL_DELIVERY_QTY',
    oldValue: previousQty,
    newValue: nextQty,
    historyEvent: HISTORY_EVENT.REAL_DELIVERY,
    reason: `${nextDate ? `Дата поставки: ${nextDate}. ` : ''}Склад изменён на ${delta}`,
  });
  return { status: 'applied', notice: '' };
}

/** Записать поле спецификации (включая крайний срок). */
async function applySpecChange(
  tx: Database,
  position: Position,
  field: SpecField,
  value: string | number | null,
  records: ChangeRecord[],
): Promise<AppliedChange> {
  const previousValue = currentSpecValue(position, field);
  if (previousValue === value) {
    return { status: 'already', notice: '' };
  }

  const nextSpec = specWithField(position, field, value);
  // Ключ материала не пересчитывается: правка описания не должна отвязывать
  // позицию от склада, архива и истории. Пользователю об этом сообщают один раз
  // на всю пачку (см. `GridApplyReport.notices` в интерфейсе).
  const notice = describeKeyNote({
    field,
    currentKey: position.materialKey,
    nextIdentity: nextSpec,
  });

  await updatePositionSpec(tx, position.positionId, nextSpec);
  records.push({
    action: AUDIT_ACTION.SPEC_FIELD,
    bomId: position.bomId,
    positionId: position.positionId,
    field: `SPEC.${field.toUpperCase()}`,
    oldValue: previousValue,
    newValue: value,
    historyEvent: HISTORY_EVENT.SPEC_FIELD,
    reason: `Массовая правка спецификации: «${BULK_FIELD_LABEL[field]}»`,
  });
  return { status: 'applied', notice };
}

/**
 * Применить одно изменение к уже загруженной позиции.
 *
 * Вынесено отдельно, потому что этим же путём пользуется откат операции
 * (`rollbackService.ts`): правила записи поля обязаны быть одни и те же и при
 * обычной правке, и при возврате прежнего значения — иначе откат «вернул» бы не
 * то, что было.
 */
export async function applyChangeToPosition(
  tx: Database,
  position: Position,
  field: BulkField,
  value: BulkValue,
  records: ChangeRecord[],
): Promise<AppliedChange> {
  switch (field) {
    case 'orderedQty': {
      const nextQty = toQty(value);
      const previousQty = position.quantities.orderedQty;
      if (previousQty === nextQty) {
        return { status: 'already', notice: '' };
      }
      await updateOperatingFields(tx, position.positionId, { orderedQty: nextQty });
      records.push({
        action: AUDIT_ACTION.ORDERED_QTY,
        bomId: position.bomId,
        positionId: position.positionId,
        field: 'ORDERED_QTY',
        oldValue: previousQty,
        newValue: nextQty,
        historyEvent: HISTORY_EVENT.ORDERED_QTY,
      });
      return { status: 'applied', notice: '' };
    }
    case 'expectedDate': {
      // Проверка значения уже прошла: здесь дата либо `ГГГГ-ММ-ДД`, либо «снять».
      const nextDate = value === null ? null : String(value);
      if (position.expectedDate === nextDate) {
        return { status: 'already', notice: '' };
      }
      await updateOperatingFields(tx, position.positionId, { expectedDate: nextDate });
      records.push({
        action: AUDIT_ACTION.EXPECTED_DATE,
        bomId: position.bomId,
        positionId: position.positionId,
        field: 'EXPECTED_DATE',
        oldValue: position.expectedDate,
        newValue: nextDate,
        historyEvent: HISTORY_EVENT.EXPECTED_DATE,
      });
      return { status: 'applied', notice: '' };
    }
    case 'realDeliveryQty':
      return applyRealDelivery(tx, position, toQty(value), records);
    case 'realDeliveryChecked': {
      // Галочка — та же операция, что и количество: полный объём потребности или
      // ноль. Объём знает только позиция, поэтому подстановка происходит здесь.
      const target = isChecked(value) ? position.quantities.requiredQty : 0;
      return applyRealDelivery(tx, position, target, records);
    }
    default:
      return applySpecChange(tx, position, field, asSpecValue(value), records);
  }
}

/**
 * Значение для поля спецификации: текст, число или «пусто».
 *
 * Проверка нужна, чтобы невозможность логического значения была видна и
 * компилятору, и читателю: `normalizeBulkValue` возвращает `true`/`false` только
 * для отметки «Поставлено», у которой своя ветвь обработки. Молча записать `true`
 * в «Наименование» было бы куда хуже явной ошибки.
 */
function asSpecValue(value: BulkValue): string | number | null {
  if (typeof value === 'boolean') {
    throw new ValidationError('Логическое значение допустимо только для отметки «Поставлено»');
  }
  return value;
}

/** Свести пачку к одному изменению на пару «позиция + поле». */
function dedupeChanges(changes: readonly BulkChangeInput[]): BulkChangeInput[] {
  const byCell = new Map<string, BulkChangeInput>();
  for (const change of changes) {
    const positionId = String(change?.positionId ?? '').trim();
    const field = String(change?.field ?? '').trim();
    byCell.set(`${positionId}\u0000${field}`, {
      positionId,
      field,
      value: change?.value ?? null,
    });
  }
  return [...byCell.values()];
}

/** Отказ с причиной: результат изменения, которое не применено. */
function blocked(positionId: string, field: string, reason: string): BulkItemResult {
  return { positionId, field, status: 'blocked', reason, notice: '' };
}

/** Сколько результатов с указанным статусом. */
function countOf(results: readonly BulkItemResult[], status: BulkItemResult['status']): number {
  return results.filter((item) => item.status === status).length;
}

/**
 * Применить пачку изменений одной командой.
 *
 * Порядок: проверка размера → дедупликация → одна транзакция (проверка поля,
 * права, значения, загрузка позиции, запись) → один `recordChanges` → чтение
 * обновлённых позиций. Отказы не бросают исключение: они становятся результатом
 * `blocked`, чтобы одна плохая ячейка не отменяла вставку целиком.
 */
export async function applyBulkChanges(
  db: Database,
  ctx: OperationContext,
  params: { changes: readonly BulkChangeInput[] },
): Promise<BulkResult> {
  const requested = params.changes ?? [];
  if (!requested.length) {
    throw new ConflictError('Не выбрано ни одного изменения');
  }
  if (requested.length > LIMITS.MAX_BULK_CHANGES) {
    throw new ValidationError(
      `За одну команду можно изменить не больше ${LIMITS.MAX_BULK_CHANGES} значений, ` +
        `получено ${requested.length}. Разделите вставку на части.`,
    );
  }

  const ordered = dedupeChanges(requested);

  const outcome = await db.transaction(async (tx) => {
    const results: BulkItemResult[] = [];
    const records: ChangeRecord[] = [];

    for (const change of ordered) {
      if (!isBulkField(change.field)) {
        results.push(
          blocked(change.positionId, change.field, `Неизвестное поле: ${change.field || '—'}`),
        );
        continue;
      }
      const field = change.field;

      if (!can(ctx.role, bulkPermission(field))) {
        results.push(
          blocked(
            change.positionId,
            field,
            `Ваша роль не меняет «${BULK_FIELD_LABEL[field]}»`,
          ),
        );
        continue;
      }

      const checked = normalizeBulkValue(field, change.value);
      if (!checked.ok) {
        results.push(blocked(change.positionId, field, checked.error));
        continue;
      }

      const position = await findPositionByPositionId(tx, change.positionId);
      if (!position) {
        results.push(
          blocked(change.positionId, field, `Позиция не найдена: ${change.positionId}`),
        );
        continue;
      }
      if (position.lifecycle === 'REMOVED') {
        results.push(blocked(change.positionId, field, 'Позиция удалена из спецификации'));
        continue;
      }

      const applied = await applyChangeToPosition(tx, position, field, checked.value, records);
      results.push({
        positionId: change.positionId,
        field,
        status: applied.status,
        reason: '',
        notice: applied.notice,
      });
    }

    // Одна запись операции на всю пачку: и журнал, и история — одним набором
    // запросов (см. `recordChanges`).
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
    results: outcome.results,
    applied: countOf(outcome.results, 'applied'),
    already: countOf(outcome.results, 'already'),
    blocked: countOf(outcome.results, 'blocked'),
    operationId: ctx.operationId,
    positions: outcome.positions,
  };
}
