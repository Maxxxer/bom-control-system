/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_operations.js
 *
 * Операционные действия снабжения (ТЗ №18–21):
 *   заказ (ORDERED_QTY), ожидаемая дата (EXPECTED_DATE),
 *   реальная поставка (REAL_DELIVERY_QTY).
 *
 * V3 — модель «Применить». Операции работают и ПАКЕТНО, и одиночно:
 *   - пакетно (передан ctx от v12DrainPendingEdits) — изменения копятся в
 *     ctx.positionWrites / ctx.warehouseDelta, а проекции пересобираются ОДИН
 *     раз в конце применения всей пачки намерений;
 *   - одиночно (ctx не передан) — операция сама пишет состояние, применяет
 *     складские дельты и пересобирает проекции.
 * Это единая реализация: очередь правок НЕ дублирует расчёт и аудит.
 *
 * Каждая операция сама проверяет права (RBAC) и возвращает
 * { status: "applied" | "already" | "blocked", reason? }.
 * =====================================================
 */

/**
 * Контекст записи для ОДИНОЧНОЙ операции (когда пакетный ctx не передан).
 */
function v12CreateWriteContext(index) {
  return { index: index || null, warehouseDelta: {}, positionWrites: [] };
}

/**
 * Добавить в буфер записи вычисленные поля строки состояния — они одинаковы для
 * всех операций снабжения (состояния обеспечения/производства, производные
 * количества и метка обновления).
 */
function v12PushComputedWrites(ctx, rowNum, rowVals) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  [
    P.SUPPLY_STATE,
    P.PRODUCTION_STATE,
    P.DEFICIT_QTY,
    P.UNCOVERED_NEED,
    P.OVER_ORDERED_QTY,
    P.SHORT_DELIVERY_QTY,
    P.AVAILABLE_FOR_PRODUCTION,
    P.FLAGS,
    P.UPDATED_AT
  ].forEach(function (col) {
    ctx.positionWrites.push({ row: rowNum, col: col, value: rowVals[col - 1] });
  });
}

/**
 * Записать накопленные изменения POSITION_STATE одним батчем и очистить буфер.
 */
function v12FlushWriteContext(ctx) {
  if (!ctx.positionWrites.length) {
    return;
  }
  batchWrite(v12GetSheetByKey("POSITION_STATE"), ctx.positionWrites);
  ctx.positionWrites = [];
}

/**
 * Завершить ОДИНОЧНУЮ операцию: записать состояние, применить складские дельты,
 * пересобрать проекции и слить аудит. При пакетном применении НЕ вызывается —
 * это делает v12DrainPendingEdits (один пересчёт на всю пачку).
 */
function v12CommitSingleOperation(ctx) {
  v12FlushWriteContext(ctx);
  v12ApplyWarehouseDeltas(ctx.warehouseDelta);
  SpreadsheetApp.flush();
  v12RefreshProjections();
  v12FlushAudit();
}

/**
 * Установить количество заказа. PROCUREMENT.
 *
 * qty — абсолютное новое значение «Заказано» (0 — сброс заказа).
 */
function v12SetOrderedQty(positionId, qty, index, ctx) {
  v12RequireRole(v12GetCurrentUserRole(), "ORDERED_QTY");

  const own = !ctx;
  const work = ctx || v12CreateWriteContext(index);
  const idx = work.index || index || v12BuildPositionIndex();
  work.index = idx;

  const pos = v12GetPositionById(positionId, idx);
  if (!pos) {
    return { status: "blocked", reason: "Позиция не найдена: " + positionId };
  }

  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = pos.values;
  const newQty = Math.max(0, toNumber(qty));
  const oldQty = toNumber(row[P.ORDERED_QTY - 1]);
  if (oldQty === newQty) {
    return { status: "already" };
  }

  const rowVals = row.slice();
  rowVals[P.ORDERED_QTY - 1] = newQty;
  v12ApplyComputedToRow(rowVals);

  work.positionWrites.push({ row: pos.row, col: P.ORDERED_QTY, value: newQty });
  v12PushComputedWrites(work, pos.row, rowVals);

  // Синхронизируем in-memory строку индекса ЦЕЛИКОМ: последующие намерения
  // пачки должны видеть уже изменённое состояние позиции.
  for (let c = 0; c < rowVals.length; c++) {
    row[c] = rowVals[c];
  }

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.ORDERED_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "ORDERED_QTY",
    oldValue: oldQty,
    newValue: newQty
  });
  v12LogHistory(positionId, "ORDERED_QTY", oldQty, newQty, "", ctx);
  v12LogEvent(V12_CONFIG.AUDIT_ACTIONS.ORDERED_CHANGED, positionId, row[P.BOM_ID - 1],
    { oldValue: oldQty, newValue: newQty }, ctx);

  if (own) {
    v12CommitSingleOperation(work);
  }
  return { status: "applied" };
}

/**
 * Установить ожидаемую дату поставки. PROCUREMENT.
 *
 * date — Date / строка / числовой серийный номер Sheets (нормализуется); пустое
 * значение очищает дату.
 */
function v12SetExpectedDate(positionId, date, index, ctx) {
  v12RequireRole(v12GetCurrentUserRole(), "EXPECTED_DATE");

  const own = !ctx;
  const work = ctx || v12CreateWriteContext(index);
  const idx = work.index || index || v12BuildPositionIndex();
  work.index = idx;

  const pos = v12GetPositionById(positionId, idx);
  if (!pos) {
    return { status: "blocked", reason: "Позиция не найдена: " + positionId };
  }

  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = pos.values;
  const oldDate = row[P.EXPECTED_DATE - 1] || "";
  // Приводим входящее значение к дате, иначе серийный номер Sheets сохранился
  // бы как число → отображение 01.01.1970.
  const newDate = v12ToDate(date);
  if (v12DateValue(oldDate) === v12DateValue(newDate)) {
    return { status: "already" };
  }

  work.positionWrites.push({ row: pos.row, col: P.EXPECTED_DATE, value: newDate ? newDate : "" });
  work.positionWrites.push({ row: pos.row, col: P.UPDATED_AT, value: new Date() });
  row[P.EXPECTED_DATE - 1] = newDate ? newDate : "";

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.EXPECTED_DATE_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "EXPECTED_DATE",
    oldValue: oldDate,
    newValue: newDate ? newDate.getTime() : ""
  });
  v12LogHistory(positionId, "EXPECTED_DATE", oldDate, newDate ? newDate.getTime() : "", "", ctx);

  if (own) {
    v12CommitSingleOperation(work);
  }
  return { status: "applied" };
}

/**
 * Зафиксировать реальную поставку количеством. PROCUREMENT.
 *
 * qty — абсолютное количество фактического прихода (0 — отмена поставки).
 * Количество поступает на склад: warehouse += (newQty − oldQty). Дата поставки —
 * дата первой положительной отметки; при обнулении количества сбрасывается.
 */
function v12SetRealDeliveryQty(positionId, qty, index, ctx) {
  v12RequireRole(v12GetCurrentUserRole(), "REAL_DELIVERY");

  const own = !ctx;
  const work = ctx || v12CreateWriteContext(index);
  const idx = work.index || index || v12BuildPositionIndex();
  work.index = idx;

  const pos = v12GetPositionById(positionId, idx);
  if (!pos) {
    return { status: "blocked", reason: "Позиция не найдена: " + positionId };
  }

  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = pos.values;
  const newQty = Math.max(0, toNumber(qty));
  const oldQty = toNumber(row[P.REAL_DELIVERY_QTY - 1]);
  if (oldQty === newQty) {
    return { status: "already" };
  }

  const materialKey = v12BuildMaterialKey({
    code: row[P.MATERIAL_CODE - 1],
    name: row[P.MATERIAL_NAME - 1],
    model: row[P.MODEL - 1],
    unit: row[P.UNIT - 1]
  });
  const delta = newQty - oldQty;

  const rowVals = row.slice();
  rowVals[P.REAL_DELIVERY_QTY - 1] = newQty;
  rowVals[P.REAL_DELIVERY_DATE - 1] = newQty > 0
    ? (row[P.REAL_DELIVERY_DATE - 1] || new Date())
    : "";
  v12ApplyComputedToRow(rowVals);

  work.positionWrites.push({ row: pos.row, col: P.REAL_DELIVERY_QTY, value: newQty });
  work.positionWrites.push({ row: pos.row, col: P.REAL_DELIVERY_DATE, value: rowVals[P.REAL_DELIVERY_DATE - 1] });
  v12PushComputedWrites(work, pos.row, rowVals);

  for (let c = 0; c < rowVals.length; c++) {
    row[c] = rowVals[c];
  }

  if (delta !== 0) {
    work.warehouseDelta[materialKey] = (work.warehouseDelta[materialKey] || 0) + delta;
  }

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.REAL_DELIVERY_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "REAL_DELIVERY_QTY",
    oldValue: oldQty,
    newValue: newQty
  });
  v12LogHistory(positionId, "REAL_DELIVERY_QTY", oldQty, newQty, "", ctx);

  if (own) {
    v12CommitSingleOperation(work);
  }
  return { status: "applied" };
}
