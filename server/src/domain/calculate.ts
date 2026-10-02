/**
 * Расчётный движок позиции — перенос `v12CalculatePositionState`
 * (`v12_calculate.js`). ЧИСТАЯ функция без обращений к базе.
 *
 * Здесь вся арифметика системы, и она не менялась при переходе на веб:
 *
 *   дефицит            = max(0, требуется − зарезервировано)
 *   непокрытая потреб. = max(0, дефицит − заказано)
 *   перезаказ          = max(0, заказано − дефицит)
 *   недопоставка       = max(0, заказано − реально поставлено)
 *   доступно           = зарезервировано + реально поставлено
 *
 * Важно: склад в расчёте НЕ участвует — он контрольная книга, а не источник
 * доступности. Дефицит считается от резерва и реального прихода.
 */

import { FLAGS, PRODUCTION_STATE, SUPPLY_STATE } from './constants.js';
import { toNumber } from './values.js';
import { validatePosition } from './validation.js';
import type {
  CalculationInput,
  CalculationResult,
  PositionFlag,
  ProductionState,
  SupplyState,
} from './types.js';

/** Рассчитать дефицит, состояния и флаги позиции. */
export function calculatePositionState(input: CalculationInput): CalculationResult {
  const required = toNumber(input.requiredQty);
  const reserved = toNumber(input.reservedQty);
  const ordered = toNumber(input.orderedQty);
  const realDelivery = toNumber(input.realDeliveryQty);
  const received = input.received === true;

  const validation = validatePosition(input.identity ?? {}, required);

  // 1. Дефицит: заказанное НЕ вычитается (заказ — намерение, а не поставка).
  const deficitQty = Math.max(required - reserved, 0);

  // 2. Непокрытая потребность: сколько дефицита ещё не закрыто заказом.
  const uncoveredNeed = Math.max(deficitQty - ordered, 0);

  // 3. Перезаказ: заказали больше, чем нужно.
  const overOrderedQty = Math.max(ordered - deficitQty, 0);

  // 4. Недопоставка: заказали больше, чем реально пришло.
  const shortDeliveryQty = Math.max(ordered - realDelivery, 0);

  // 5. Доступно для производства: резерв BOM плюс фактический приход.
  const availableForProduction = reserved + realDelivery;

  // 6. Готово к передаче — отдельное понятие от «передано».
  const readyForHandoff =
    validation.valid && !received && availableForProduction >= required && required > 0;

  // Порядок ветвлений критичен — состояние определяется первым подходящим.
  let supplyState: SupplyState;
  if (required <= 0) {
    supplyState = SUPPLY_STATE.NO_REQUIREMENT;
  } else if (reserved >= required) {
    supplyState = SUPPLY_STATE.RESERVED;
  } else if (ordered <= 0) {
    supplyState = SUPPLY_STATE.NOT_ORDERED;
  } else if (ordered < deficitQty) {
    supplyState = SUPPLY_STATE.PARTIALLY_ORDERED;
  } else if (realDelivery <= 0) {
    supplyState = SUPPLY_STATE.ORDERED;
  } else if (realDelivery < deficitQty) {
    supplyState = SUPPLY_STATE.PARTIALLY_DELIVERED;
  } else {
    supplyState = SUPPLY_STATE.DELIVERED;
  }

  let productionState: ProductionState;
  if (received) {
    productionState = PRODUCTION_STATE.RECEIVED;
  } else if (required <= 0) {
    productionState = PRODUCTION_STATE.NOT_AVAILABLE;
  } else if (availableForProduction >= required) {
    // Невалидная позиция не может быть «готова к передаче».
    productionState = validation.valid
      ? PRODUCTION_STATE.READY_FOR_HANDOFF
      : PRODUCTION_STATE.PARTIALLY_AVAILABLE;
  } else if (availableForProduction > 0) {
    productionState = PRODUCTION_STATE.PARTIALLY_AVAILABLE;
  } else {
    productionState = PRODUCTION_STATE.NOT_AVAILABLE;
  }

  const flags: PositionFlag[] = [];
  if (overOrderedQty > 0) {
    flags.push(FLAGS.OVER_ORDERED);
  }
  if (shortDeliveryQty > 0) {
    flags.push(FLAGS.SHORT_DELIVERY);
  }
  if (!validation.valid) {
    flags.push(FLAGS.CHANGED);
  }

  return {
    deficitQty,
    uncoveredNeed,
    overOrderedQty,
    shortDeliveryQty,
    availableForProduction,
    readyForHandoff,
    supplyState,
    productionState,
    flags,
    valid: validation.valid,
    missing: validation.missing,
  };
}
