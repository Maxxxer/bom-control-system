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
  if (oldQty === newQty) {
    // Значение уже совпадает с состоянием — запись и агрегаты не нужны,
    // но строку сводки всё равно согласуем (на случай расхождения листа).
    SpreadsheetApp.flush();
    v12RefreshDeficitSummaryRow(positionId, "ORDERED_QTY");
    return;
  }

  const row = pos.values.slice();
  row[P.ORDERED_QTY - 1] = newQty;
  v12ApplyComputedToRow(row);

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

  // Сводку согласуем ВСЕГДА и точечно (по строке позиции) — это устраняет
  // потерю «Заказано»/«Ожидаемой поставки» при быстром вводе.
  SpreadsheetApp.flush();
  v12RefreshDeficitSummaryRow(positionId, "ORDERED_QTY");
  // Агрегаты (СНАБЖЕНИЕ/Dashboard) обновляем, когда введены оба поля — как раньше.
  if (row[P.EXPECTED_DATE - 1]) {
    v12RefreshSupply();
    v12RefreshDashboard();
  }
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
  // Приводим входящее значение (Date / строка / числовой серийный номер Sheets)
  // к дате, иначе серийный номер сохранился бы как число → отображение 01.01.1970.
  const newDate = v12ToDate(date);
  if (v12DateValue(oldDate) === v12DateValue(newDate)) {
    // Дата уже совпадает — запись не нужна, но строку сводки согласуем.
    SpreadsheetApp.flush();
    v12RefreshDeficitSummaryRow(positionId, "EXPECTED_DATE");
    return;
  }

  v12UpdatePosition(positionId, {
    EXPECTED_DATE: newDate ? newDate : ""
  }, index);

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.EXPECTED_DATE_CHANGED,
    bomId: pos.values[P.BOM_ID - 1],
    positionId: positionId,
    field: "EXPECTED_DATE",
    oldValue: oldDate,
    newValue: newDate ? newDate.getTime() : ""
  });

  // Сводку согласуем ВСЕГДА и точечно — иначе при быстром вводе значение теряется.
  SpreadsheetApp.flush();
  v12RefreshDeficitSummaryRow(positionId, "EXPECTED_DATE");
  if (toNumber(pos.values[P.ORDERED_QTY - 1]) > 0) {
    v12RefreshSupply();
    v12RefreshDashboard();
  }
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
  // «Реальная поставка» фиксирует факт физического прихода материала.
  // Заказ и поставка — независимые величины, поэтому отметка поставки не
  // требует предварительного оформления заказа (гейт по «заказу» не применяется).
  const materialKey = v12BuildMaterialKey({
    code: row[P.MATERIAL_CODE - 1],
    name: row[P.MATERIAL_NAME - 1],
    model: row[P.MODEL - 1],
    unit: row[P.UNIT - 1]
  });
  const delta = newQty - oldQty;

  const newRow = row.slice();
  newRow[P.REAL_DELIVERY_QTY - 1] = newQty;
  // Дата фактической поставки: фиксируем дату первой положительной отметки,
  // при обнулении поставки — сбрасываем.
  const newDeliveryDate = newQty > 0
    ? (row[P.REAL_DELIVERY_DATE - 1] || new Date())
    : "";
  newRow[P.REAL_DELIVERY_DATE - 1] = newDeliveryDate;
  v12ApplyComputedToRow(newRow);

  v12UpdatePosition(positionId, {
    REAL_DELIVERY_QTY: newQty,
    REAL_DELIVERY_DATE: newDeliveryDate,
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
