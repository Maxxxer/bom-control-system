/**
 * Построители строк представлений: сводка дефицитов и WORKING BOM.
 *
 * Это чистые функции: на вход позиции, на выход готовые строки для интерфейса.
 * В прежней системе строки писались прямо в лист и пересобирались целиком —
 * здесь тот же состав и порядок сортировки, но без побочных эффектов.
 */

import { PRODUCTION_STATE_LABEL } from './constants.js';
import { deficitStatus } from './procurement.js';
import { extractProjectCode } from './values.js';
import { isActive, isDeficitVisible, type Position } from './position.js';
import type { DeficitRow, WorkingBomRow } from './projectionTypes.js';

/** Сравнение позиций для стабильной выдачи: по BOM, затем по номеру строки. */
function byBomThenRow(a: Position, b: Position): number {
  const byBom = a.bomName.localeCompare(b.bomName, 'ru');
  if (byBom !== 0) {
    return byBom;
  }
  return a.identity.rowNo - b.identity.rowNo;
}

/** Строки «Сводки дефицитов» — рабочее место снабженца и экономиста. */
export function buildDeficitRows(positions: readonly Position[]): DeficitRow[] {
  return positions
    .filter(isDeficitVisible)
    .sort(byBomThenRow)
    .map((position) => {
      const status = deficitStatus(
        {
          orderedQty: position.quantities.orderedQty,
          deficitQty: position.computed.deficitQty,
          expectedDate: position.expectedDate,
          deadline: position.identity.deadline,
        },
        position.computed.valid,
      );
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
        deficitQty: position.computed.deficitQty,
        orderedQty: position.quantities.orderedQty,
        expectedDate: position.expectedDate,
        deadline: position.identity.deadline,
        realDelivery: false,
        uncoveredNeed: position.computed.uncoveredNeed,
        statusKey: status.key,
        statusText: status.text,
        statusColor: status.color,
      } satisfies DeficitRow;
    });
}

/** Строки WORKING BOM — все активные позиции (рабочее место производства). */
export function buildWorkingBomRows(positions: readonly Position[]): WorkingBomRow[] {
  return positions
    .filter(isActive)
    .sort(byBomThenRow)
    .map((position) => ({
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
      reservedQty: position.quantities.reservedQty,
      realDeliveryQty: position.quantities.realDeliveryQty,
      availableForProduction: position.computed.availableForProduction,
      receivedQty: position.quantities.receivedQty,
      productionState: position.computed.productionState,
      productionStateText: PRODUCTION_STATE_LABEL[position.computed.productionState],
      canHandoff: position.computed.readyForHandoff,
      updatedAt: position.updatedAt,
    }));
}
