/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_calculate.js
 *
 * Единый расчётный движок (ТЗ №15–23, №145).
 *
 * Решения по конфликтам:
 *   К1: availableForProduction = reservedQty + realDeliveryQty,
 *       а reservedQty — складское удержание под позицию BOM.
 *   К3: READY_FOR_HANDOFF (готово к передаче) ≠ RECEIVED (передано).
 *   К4: reserved=0 — валидный дефолт; валидация по №8.
 *
 * calculatePositionState — ЧИСТАЯ функция (без I/O).
 * =====================================================
 */

/**
 * Валидация + расчёт всех канонических количеств, состояний и флагов.
 *
 * input: {
 *   requiredQty, reservedQty, orderedQty, realDeliveryQty,
 *   expectedDate, deadline, receivedByProduction (bool),
 *   receivedByProductionQty, warehouseQty,
 *   row (сырая строка POSITION_STATE для валидации по №8)
 * }
 */
function v12CalculatePositionState(input) {
  const required = toNumber(input.requiredQty);
  const reserved = toNumber(input.reservedQty);
  const ordered = toNumber(input.orderedQty);
  const realDelivery = toNumber(input.realDeliveryQty);
  const warehouse = toNumber(input.warehouseQty);
  const received = input.receivedByProduction === true;
  const receivedQty = toNumber(input.receivedByProductionQty);
  const expected = input.expectedDate;
  const deadline = input.deadline;

  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = input.row || [];

  // Валидация по ТЗ №8 (К4): reserved=0 валиден.
  const validation = v12ValidatePosition(row);

  // 1. Дефицит по ТЗ: max(0, required − reserved)  (НЕ вычитаем ordered)
  const deficitQty = Math.max(required - reserved, 0);

  // 2. Непокрытая потребность: max(0, deficit − ordered)
  const uncoveredNeed = Math.max(deficitQty - ordered, 0);

  // 3. Перезаказ: max(0, ordered − deficit)
  const overOrderedQty = Math.max(ordered - deficitQty, 0);

  // 4. Недопоставка: max(0, ordered − realDelivery)
  const shortDeliveryQty = Math.max(ordered - realDelivery, 0);

  // 5. Доступно для производства (К1): reserved + realDelivery
  const availableForProduction = reserved + realDelivery;

  // 6. Готово к передаче (К3) — отдельно от «передано»
  const readyForHandoff = validation.valid &&
    !received &&
    availableForProduction >= required &&
    required > 0;

  const SS = V12_CONFIG.SUPPLY_STATE;
  let supplyState;

  if (required <= 0) {
    supplyState = SS.NO_REQUIREMENT;
  } else if (reserved >= required) {
    supplyState = SS.RESERVED;
  } else if (ordered <= 0) {
    supplyState = SS.NOT_ORDERED;
  } else if (ordered < deficitQty) {
    supplyState = SS.PARTIALLY_ORDERED;
  } else if (realDelivery <= 0) {
    supplyState = SS.ORDERED;
  } else if (realDelivery < deficitQty) {
    supplyState = SS.PARTIALLY_DELIVERED;
  } else {
    supplyState = SS.DELIVERED;
  }

  // Если позиция невалидна — supplyState учитывает ошибку отдельно (через flags/validation)
  const PS = V12_CONFIG.PRODUCTION_STATE;
  let productionState;

  if (received) {
    productionState = PS.RECEIVED;
  } else if (required <= 0) {
    productionState = PS.NOT_AVAILABLE;
  } else if (availableForProduction >= required) {
    productionState = validation.valid ? PS.READY_FOR_HANDOFF : PS.PARTIALLY_AVAILABLE;
  } else if (availableForProduction > 0) {
    productionState = PS.PARTIALLY_AVAILABLE;
  } else {
    productionState = PS.NOT_AVAILABLE;
  }

  // Флаги
  const FL = V12_CONFIG.FLAGS;
  const flags = [];
  if (overOrderedQty > 0) flags.push(FL.OVER_ORDERED);
  if (shortDeliveryQty > 0) flags.push(FL.SHORT_DELIVERY);
  if (!validation.valid) flags.push(FL.CHANGED); // невалидная — требует внимания

  return {
    deficitQty: deficitQty,
    uncoveredNeed: uncoveredNeed,
    overOrderedQty: overOrderedQty,
    shortDeliveryQty: shortDeliveryQty,
    availableForProduction: availableForProduction,
    readyForHandoff: readyForHandoff,
    supplyState: supplyState,
    productionState: productionState,
    flags: flags,
    valid: validation.valid,
    missing: validation.missing
  };
}

/**
 * Проверка готовности к передаче (ТЗ №24/№106, К3).
 */
function v12IsReadyForHandoff(position) {
  return Boolean(position && position.readyForHandoff === true);
}

/**
 * Проверка физического несоответствия резерва и склада (ТЗ №30).
 * raised: res = Σ резервов по materialKey, warehouse = остаток.
 */
function v12IsReservationPhysicalInconsistent(totalReserved, warehouseQty) {
  return totalReserved > warehouseQty;
}
