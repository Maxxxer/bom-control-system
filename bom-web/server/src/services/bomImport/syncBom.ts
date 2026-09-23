/**
 * Применение разобранной спецификации к базе.
 *
 * Ключевое правило повторного импорта: **операционные данные сохраняются**.
 * Если снабженец уже проставил заказ и ожидаемую дату, а кладовщик — поставку,
 * повторная загрузка того же файла (например, после правки количества) не должна
 * обнулять их работу. Поэтому при совпадении идентификатора позиции обновляются
 * только поля спецификации, а заказано / ожидаемая дата / поставка / передача
 * остаются как есть.
 *
 * Позиция, исчезнувшая из файла:
 *   * без операционных данных — удаляется (это была опечатка или лишняя строка);
 *   * с операционными данными — помечается жизненным циклом «удалена», то есть
 *     уходит из рабочих экранов, но её история и след в журнале сохраняются.
 */

import type { Database } from '../../db/Database.js';
import { LIFECYCLE_STATE } from '../../domain/constants.js';
import {
  deletePositionsByPositionIds,
  insertPositions,
  listPositionsByBom,
  updateOperatingFields,
  updatePositionSpec,
  type NewPosition,
  type PositionSpec,
} from '../../repositories/positions.js';
import { bumpRevision, findBomByCode, upsertBom, type BomRecord } from '../../repositories/boms.js';
import { AUDIT_ACTION, recordChanges, type OperationContext } from '../operationLog.js';
import type { ParsedBom, ParsedBomPosition } from './parseBomRows.js';

/** Итог импорта спецификации. */
export interface BomImportSummary {
  bom: BomRecord;
  /** Спецификация создана этим импортом (иначе — уже существовала). */
  created: boolean;
  inserted: number;
  updated: number;
  /** Удалено как исчезнувшее из файла (без операционных данных). */
  deleted: number;
  /** Помечено «удалено» (в файле нет, но есть операционные данные). */
  markedRemoved: number;
}

/** Есть ли у позиции операционные данные, которые нельзя потерять. */
function hasOperatingData(position: {
  quantities: { orderedQty: number; realDeliveryQty: number; received: boolean };
  expectedDate: string | null;
}): boolean {
  return (
    position.quantities.orderedQty > 0 ||
    position.quantities.realDeliveryQty > 0 ||
    position.quantities.received ||
    Boolean(position.expectedDate)
  );
}

/** Собрать поля спецификации из разобранной позиции. */
function toSpec(position: ParsedBomPosition): PositionSpec {
  return {
    rowNo: position.rowNo,
    code: position.code,
    manufacturer: position.manufacturer,
    name: position.name,
    model: position.model,
    unit: position.unit,
    requiredQty: position.requiredQty,
    reservedQty: position.reservedQty,
    deadline: position.deadline,
  };
}

/**
 * Записать спецификацию в базу.
 *
 * Выполняется в транзакции: либо спецификация обновлена целиком, либо состояние
 * осталось прежним. Частично применённый импорт было бы невозможно объяснить
 * пользователю.
 */
export async function applyParsedBom(
  db: Database,
  ctx: OperationContext,
  params: { bomCode: string; bomName: string; sourceNote: string; parsed: ParsedBom },
): Promise<BomImportSummary> {
  const existingBom = await findBomByCode(db, params.bomCode);
  const revision = existingBom ? existingBom.revision + 1 : 1;

  return db.transaction(async (tx) => {
    const bom = await upsertBom(tx, {
      code: params.bomCode,
      name: params.bomName,
      sourceNote: params.sourceNote,
      actor: ctx.actor,
    });
    if (existingBom) {
      await bumpRevision(tx, bom.id);
    }

    const current = await listPositionsByBom(tx, params.bomCode);
    const currentById = new Map(current.map((position) => [position.positionId, position]));

    const toInsert: NewPosition[] = [];
    let updated = 0;

    for (const parsed of params.parsed.positions) {
      const spec = toSpec(parsed);
      const known = currentById.get(parsed.positionId);
      if (known) {
        await updatePositionSpec(tx, parsed.positionId, spec);
        // Позиция вернулась в спецификацию — снимаем пометку «удалена».
        if (known.lifecycle === LIFECYCLE_STATE.REMOVED) {
          await updateOperatingFields(tx, parsed.positionId, {
            lifecycle: LIFECYCLE_STATE.ACTIVE,
          });
        }
        updated += 1;
      } else {
        toInsert.push({
          bomId: bom.id,
          positionId: parsed.positionId,
          materialKey: parsed.materialKey,
          ...spec,
        });
      }
    }

    const inserted = await insertPositions(tx, toInsert);

    // Позиции, которых больше нет в файле.
    const inFile = new Set(params.parsed.positions.map((position) => position.positionId));
    const vanished = current.filter(
      (position) => !inFile.has(position.positionId) && position.lifecycle !== LIFECYCLE_STATE.REMOVED,
    );
    const toDelete: string[] = [];
    const toMarkRemoved: string[] = [];
    for (const position of vanished) {
      if (hasOperatingData(position)) {
        toMarkRemoved.push(position.positionId);
      } else {
        toDelete.push(position.positionId);
      }
    }

    const deleted = await deletePositionsByPositionIds(tx, toDelete);
    for (const positionId of toMarkRemoved) {
      await updateOperatingFields(tx, positionId, { lifecycle: LIFECYCLE_STATE.REMOVED });
    }

    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.BOM_IMPORT,
        bomId: params.bomCode,
        field: 'BOM',
        oldValue: existingBom ? `${current.length} поз., ревизия ${existingBom.revision}` : 'новая',
        newValue: `${params.parsed.positions.length} поз., ревизия ${revision}`,
        reason:
          `Источник: ${params.sourceNote}. ` +
          `Добавлено: ${inserted}, обновлено: ${updated}, удалено: ${deleted}, ` +
          `помечено удалёнными: ${toMarkRemoved.length}, ` +
          `с неполными данными: ${params.parsed.incomplete.length}`,
      },
    ]);

    const reloaded = await findBomByCode(tx, params.bomCode);
    return {
      bom: reloaded ?? bom,
      created: existingBom === null,
      inserted,
      updated,
      deleted,
      markedRemoved: toMarkRemoved.length,
    };
  });
}
