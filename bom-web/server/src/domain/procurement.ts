/**
 * Исход снабжения и статус строки сводки дефицитов — перенос
 * `v12ProcurementOutcome`, `v12DeficitStatusDisplay`, `v12DeficitStatusColor`
 * (`v12_projections.js`).
 *
 * Ключевое правило, которое обязано сохраниться: заказ считается оформленным
 * только когда заполнены ОБА поля — количество И ожидаемая дата поставки.
 */

import { COLORS, DEFICIT_STATUS } from './constants.js';
import { toIsoDate, toNumber } from './values.js';
import type { ProcurementOutcome, ProcurementRow } from './types.js';

/** Исход снабжения позиции (без разбора текста статуса). */
export function procurementOutcome(row: ProcurementRow): ProcurementOutcome {
  const ordered = toNumber(row.orderedQty);
  const deficit = toNumber(row.deficitQty);
  const expected = toIsoDate(row.expectedDate);
  const deadline = toIsoDate(row.deadline);

  // Заказ не оформлен либо не указана ожидаемая дата — «не заказано».
  if (ordered <= 0 || !expected) {
    return 'NOT_ORDERED';
  }
  // Нет распознанного крайнего срока — сопоставить не с чем, считаем «не заказано».
  if (!deadline) {
    return 'NOT_ORDERED';
  }
  if (ordered < deficit) {
    return 'PARTIAL';
  }
  return expected <= deadline ? 'ON_TIME' : 'LATE';
}

/** Идентификаторы статуса строки сводки (для вёрстки и фильтров в интерфейсе). */
export type DeficitStatusKey = 'ERROR' | 'NOT_ORDERED' | 'PARTIAL' | 'ON_TIME' | 'LATE';

/** Готовый статус строки: ключ, текст и цвет заливки. */
export interface DeficitStatus {
  key: DeficitStatusKey;
  text: string;
  color: string;
}

const DEFICIT_STATUS_PRESENTATION: Record<DeficitStatusKey, { text: string; color: string }> = {
  ERROR: { text: DEFICIT_STATUS.ERROR, color: COLORS.GRAY },
  NOT_ORDERED: { text: DEFICIT_STATUS.NOT_ORDERED, color: COLORS.RED },
  PARTIAL: { text: DEFICIT_STATUS.PARTIAL, color: COLORS.RED },
  ON_TIME: { text: DEFICIT_STATUS.ON_TIME, color: COLORS.YELLOW },
  LATE: { text: DEFICIT_STATUS.LATE, color: COLORS.ORANGE },
};

/** Статус строки сводки: ошибка данных важнее любого исхода снабжения. */
export function deficitStatus(row: ProcurementRow, valid: boolean): DeficitStatus {
  const key: DeficitStatusKey = !valid ? 'ERROR' : procurementOutcome(row);
  const presentation = DEFICIT_STATUS_PRESENTATION[key];
  return { key, text: presentation.text, color: presentation.color };
}

/** Описание вёрстки статуса без проверки данных (для подсказок дашборда). */
export function deficitStatusPresentation(key: DeficitStatusKey): { text: string; color: string } {
  return DEFICIT_STATUS_PRESENTATION[key];
}
