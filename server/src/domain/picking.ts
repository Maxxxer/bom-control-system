/**
 * Список отборки — перенос `v12BuildPickingRecords`, `v12PickingDeliveryDate`,
 * `v12PickingRowColor`, `v12GetBomProjectCodes` (`v12_projections.js`).
 *
 * Алгоритм СОЗНАТЕЛЬНО единый: раньше его использовали и мастерский лист, и
 * транспорт отборщиков, чтобы они не разошлись в трактовке. Здесь он остаётся
 * одним источником для рабочего места кладовщика и любых отчётов.
 *
 * Передавать производству можно только «голубые» строки — те, что готовы к
 * передаче (материал обеспечен полностью и позиция валидна).
 */

import { COLORS, PRODUCTION_STATE, PRODUCTION_STATE_LABEL, SUPPLY_STATE } from './constants.js';
import { extractProjectCode, norm, toIsoDate, toNumber } from './values.js';
import { isActive, type Position } from './position.js';
import type { PickingRow } from './projectionTypes.js';

/** Параметры построения списка отборки. */
export interface PickingOptions {
  /** Код проекта (пустая строка или null — без фильтра). */
  projectCode?: string | null;
  /** Даты создания BOM: нужны для позиций, закрытых резервом (ISO). */
  bomCreatedDates?: ReadonlyMap<string, string | null>;
}

/** Дата поставки строки отборки: приоритет — как в прежней системе. */
export function pickingDeliveryDate(
  position: Position,
  bomCreatedDate: string | null,
): string | null {
  const required = position.quantities.requiredQty;
  const reserved = position.quantities.reservedQty;
  // Материал изначально закрыт резервом BOM — дата поставки равна дате создания BOM.
  if (required > 0 && reserved >= required && bomCreatedDate) {
    return bomCreatedDate;
  }
  if (position.computed.productionState === PRODUCTION_STATE.READY_FOR_HANDOFF) {
    return position.realDeliveryDate;
  }
  return position.expectedDate;
}

/** Цвет строки отборки: голубой — можно передавать, красный/жёлтый/оранжевый — нет. */
export function pickingRowColor(position: Position): string {
  if (position.computed.productionState === PRODUCTION_STATE.READY_FOR_HANDOFF) {
    return COLORS.STOCK;
  }
  const supply = position.computed.supplyState;
  if (supply === SUPPLY_STATE.NOT_ORDERED || supply === SUPPLY_STATE.PARTIALLY_ORDERED) {
    return COLORS.RED;
  }
  if (supply === SUPPLY_STATE.ORDERED || supply === SUPPLY_STATE.PARTIALLY_DELIVERED) {
    const expected = toIsoDate(position.expectedDate);
    const deadline = toIsoDate(position.identity.deadline);
    if (expected && deadline) {
      return expected <= deadline ? COLORS.YELLOW : COLORS.ORANGE;
    }
    // Заказан, но подтверждённого срока прихода нет — трактуем как риск.
    return COLORS.ORANGE;
  }
  return COLORS.WHITE;
}

/** Строки списка отборки с фильтром по проекту и сортировкой как в прежней системе. */
export function buildPickingRows(
  positions: readonly Position[],
  options: PickingOptions = {},
): PickingRow[] {
  const filter = String(options.projectCode ?? '').trim();
  const bomCreatedDates = options.bomCreatedDates ?? new Map<string, string | null>();

  const rows = positions
    .filter((position) => {
      if (!isActive(position) || position.quantities.received) {
        return false;
      }
      if (filter && extractProjectCode(position.bomName) !== filter) {
        return false;
      }
      return true;
    })
    .map((position) => {
      const canHandoff = position.computed.readyForHandoff;
      return {
        positionId: position.positionId,
        bomId: position.bomId,
        bomName: position.bomName,
        projectCode: extractProjectCode(position.bomName),
        rowNo: position.identity.rowNo,
        materialCode: position.identity.code,
        manufacturer: position.identity.manufacturer,
        materialName: position.identity.name,
        model: position.identity.model,
        unit: position.identity.unit,
        requiredQty: position.quantities.requiredQty,
        availableForProduction: position.computed.availableForProduction,
        productionState: position.computed.productionState,
        productionStateText: PRODUCTION_STATE_LABEL[position.computed.productionState],
        deliveryDate: pickingDeliveryDate(position, bomCreatedDates.get(position.bomId) ?? null),
        canHandoff,
        color: pickingRowColor(position),
      } satisfies PickingRow;
    });

  // Порядок: BOM → строки, готовые к передаче, вверх → номер строки в BOM.
  rows.sort((a, b) => {
    const byBom = a.bomName.localeCompare(b.bomName, 'ru');
    if (byBom !== 0) {
      return byBom;
    }
    if (a.canHandoff !== b.canHandoff) {
      return a.canHandoff ? -1 : 1;
    }
    return a.rowNo - b.rowNo;
  });

  return rows;
}

/** Уникальные коды проектов для фильтра списка отборки. */
export function buildProjectCodes(positions: readonly Position[]): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const position of positions) {
    if (!isActive(position) || position.quantities.received) {
      continue;
    }
    const code = extractProjectCode(position.bomName);
    if (!code || seen.has(norm(code))) {
      continue;
    }
    seen.add(norm(code));
    codes.push(code);
  }
  return codes.sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Страховка на сервере: передавать можно только готовые и валидные позиции. */
export function isRowHandoffAllowed(position: Position): boolean {
  return position.computed.readyForHandoff && toNumber(position.quantities.requiredQty) > 0;
}
