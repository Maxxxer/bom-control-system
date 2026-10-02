/**
 * Статус BOM (дашборд) — перенос `v12ComputeBomStatus` (`v12_projections.js`).
 *
 * Порядок приоритетов менять нельзя: он определяет, что увидит производство.
 * Ошибка данных важнее всего; «скомплектован» — только когда ВСЕ позиции уже
 * переданы производству (на этом статусе держится гейт галочки «Выполнено»).
 */

import { BOM_STATUS, BOM_STATUS_COLOR, BOM_STATUS_LABEL } from './constants.js';
import type { BomAggregate } from './projectionTypes.js';
import type { BomStatus } from './types.js';

/** Определить статус BOM по агрегату позиций. */
export function computeBomStatus(agg: BomAggregate): BomStatus {
  if (agg.errors > 0) {
    return BOM_STATUS.ERROR;
  }
  if (agg.total > 0 && agg.collected === agg.total) {
    return BOM_STATUS.READY;
  }
  if (agg.total > 0 && agg.collected + agg.onShelf === agg.total) {
    return BOM_STATUS.ON_SHELF;
  }
  if (agg.notOrdered > 0) {
    return BOM_STATUS.NOT_ORDERED;
  }
  if (agg.late > 0) {
    return BOM_STATUS.WAITING_LATE;
  }
  return BOM_STATUS.WAITING_ON_TIME;
}

/** Текст и цвет статуса для интерфейса. */
export function bomStatusPresentation(status: BomStatus): { text: string; color: string } {
  return { text: BOM_STATUS_LABEL[status], color: BOM_STATUS_COLOR[status] };
}

/**
 * Готов ли BOM к отметке «Выполнено»: все позиции переданы производству.
 * Это тот же гейт, что проверялся при установке галочки в прежней системе.
 */
export function isBomReadyForDone(agg: BomAggregate): boolean {
  return computeBomStatus(agg) === BOM_STATUS.READY;
}
