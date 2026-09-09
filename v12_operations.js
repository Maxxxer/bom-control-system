/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_operations.js
 *
 * Операционные действия снабжения (ТЗ №18–21):
 *   заказ (ORDERED_QTY), ожидаемая дата (EXPECTED_DATE),
 *   реальная поставка (REAL_DELIVERY_QTY).
 * Заменяют старый saveDeficitChanges (ТЗ №34) — специализированные
 * обработчики. Каждый — с проверкой прав (RBAC) и пересчётом.
 * =====================================================
 */

/**
 * Установить количество заказа. PROCUREMENT.
 */
function v12SetOrderedQty(positionId, qty) {
  const role = v12GetCurrentUserRole();
  v12RequireRole(role, "ORDERED_QTY");

  const newQty = Math.max(0, toNumber(qty));
  const index = v12BuildPositionIndex();
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    throw new Error("Позиция не найдена: " + positionId);
  }
  const P = V12_CONFIG.POSITION_COLUMNS;
  const oldQty = toNumber(pos.values[P.ORDERED_QTY - 1]);

  const row = pos.values.slice();
  row[P.ORDERED_QTY - 1] = newQty;
  v12ApplyComputedToRow(row, v12GetWarehouseQtyForPositionRow(row, index));

  v12UpdatePosition(positionId, {
    ORDERED_QTY: newQty,
    SUPPLY_STATE: row[P.SUPPLY_STATE - 1],
    PRODUCTION_STATE: row[P.PRODUCTION_STATE - 1],
    DEFICIT_QTY: row[P.DEFICIT_QTY - 1],
    UNCOVERED_NEED: row[P.UNCOVERED_NEED - 1],
    OVER_ORDERED_QTY: row[P.OVER_ORDERED_QTY - 1],
    SHORT_DELIVERY_QTY: row[P.SHORT_DELIVERY_QTY - 1],
    AVAILABLE_FOR_PRODUCTION: row[P.AVAILABLE_FOR_PRODUCTION - 1],
    FLAGS: row[P.FLAGS - 1]
  }, index);

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.ORDERED_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "ORDERED_QTY",
    oldValue: oldQty,
    newValue: newQty
  });

  v12RefreshProjections();
  v12FlushAudit();
}

/**
 * Установить ожидаемую дату поставки. PROCUREMENT.
 */
function v12SetExpectedDate(positionId, date) {
  const role = v12GetCurrentUserRole();
  v12RequireRole(role, "EXPECTED_DATE");

  const index = v12BuildPositionIndex();
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    throw new Error("Позиция не найдена: " + positionId);
  }
  const P = V12_CONFIG.POSITION_COLUMNS;
  const oldDate = pos.values[P.EXPECTED_DATE - 1] || "";

  v12UpdatePosition(positionId, {
    EXPECTED_DATE: date || ""
  }, index);

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.EXPECTED_DATE_CHANGED,
    bomId: pos.values[P.BOM_ID - 1],
    positionId: positionId,
    field: "EXPECTED_DATE",
    oldValue: oldDate,
    newValue: date || ""
  });

  v12RefreshProjections();
  v12FlushAudit();
}

/**
 * Зафиксировать реальную поставку количеством. PROCUREMENT.
 * Количество поступает на склад: warehouse += qty.
 */
function v12SetRealDeliveryQty(positionId, qty) {
  const role = v12GetCurrentUserRole();
  v12RequireRole(role, "REAL_DELIVERY");

  const newQty = Math.max(0, toNumber(qty));
  const index = v12BuildPositionIndex();
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    throw new Error("Позиция не найдена: " + positionId);
  }
  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = pos.values;
  const oldQty = toNumber(row[P.REAL_DELIVERY_QTY - 1]);
  // Гейт «полное удовлетворение заказа»: отметить поставку можно, только если заказ покрывает дефицит.
  const ordered = toNumber(row[P.ORDERED_QTY - 1]);
  const deficit = toNumber(row[P.DEFICIT_QTY - 1]);
  if (newQty > 0 && ordered < deficit) {
    throw new Error("Нельзя отметить полную поставку: заказ не покрывает дефицит");
  }
  const materialKey = v12BuildMaterialKey({
    code: row[P.MATERIAL_CODE - 1],
    name: row[P.MATERIAL_NAME - 1],
    model: row[P.MODEL - 1],
    unit: row[P.UNIT - 1]
  });
  const delta = newQty - oldQty;

  const newRow = row.slice();
  newRow[P.REAL_DELIVERY_QTY - 1] = newQty;
  v12ApplyComputedToRow(newRow, v12GetWarehouseQty(materialKey) + delta);

  v12UpdatePosition(positionId, {
    REAL_DELIVERY_QTY: newQty,
    SUPPLY_STATE: newRow[P.SUPPLY_STATE - 1],
    PRODUCTION_STATE: newRow[P.PRODUCTION_STATE - 1],
    DEFICIT_QTY: newRow[P.DEFICIT_QTY - 1],
    UNCOVERED_NEED: newRow[P.UNCOVERED_NEED - 1],
    OVER_ORDERED_QTY: newRow[P.OVER_ORDERED_QTY - 1],
    SHORT_DELIVERY_QTY: newRow[P.SHORT_DELIVERY_QTY - 1],
    AVAILABLE_FOR_PRODUCTION: newRow[P.AVAILABLE_FOR_PRODUCTION - 1],
    FLAGS: newRow[P.FLAGS - 1]
  }, index);

  // Остаток склада изменяется на дельту
  if (delta !== 0) {
    v12AdjustWarehouseQty(materialKey, delta);
  }

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.REAL_DELIVERY_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "REAL_DELIVERY_QTY",
    oldValue: oldQty,
    newValue: newQty
  });

  v12RefreshProjections();
  v12FlushAudit();
}

/**
 * Вспомогательная: складской остаток для строки позиции (по materialKey).
 */
function v12GetWarehouseQtyForPositionRow(row, index) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const materialKey = v12BuildMaterialKey({
    code: row[P.MATERIAL_CODE - 1],
    name: row[P.MATERIAL_NAME - 1],
    model: row[P.MODEL - 1],
    unit: row[P.UNIT - 1]
  });
  // ВАЖНО: сюда НЕЛЬЗЯ передавать индекс POSITION_STATE — v12GetWarehouseQty
  // ожидает индекс MATERIAL_STATE. Без аргумента она сама строит корректный индекс.
  return v12GetWarehouseQty(materialKey);
}
