/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_projections.js
 *
 * Проекции (ТЗ №33–№47, №68–№71):
 *   DEFICIT_SUMMARY — для снабжения;
 *   ОТБОРКА (PICKING) — для кладовщика/производства;
 *   WORKING BOM — периодический документ на BOM;
 *   СНАБЖЕНИЕ (SUPPLY) — агрегация по materialKey;
 *   DASHBOARD — сводка по BOM.
 *
 * К2: маппинг supplyState/productionState -> BOM-статус дашборда.
 * К7: обновление только затронутых (incremental) — здесь пересборка
 *     по флагам dirty (полную сверку оставляем для debug).
 * =====================================================
 */

/**
 * Пересчитать и записать ВСЕ проекции (после массовых операций).
 */
function v12RefreshAllProjections() {
  v12RefreshDeficitSummary();
  v12RefreshPicking();
  v12RefreshWorkingBOM();
  v12RefreshSupply();
  v12RefreshDashboard();
}

/**
 * Обновить только затронутые проекции после единичной операции (dirty).
 */
function v12RefreshProjections() {
  // Лёгкая версия: пересчитываем всё (для корректности), т.к. объёмы
  // на старте малы. Для 40k строк — перевести на dirty-флаги (К7).
  v12RefreshDeficitSummary();
  v12RefreshPicking();
  v12RefreshWorkingBOM();
  v12RefreshSupply();
  v12RefreshDashboard();
}

/**
 * DEFICIT_SUMMARY: активные (не архив/не удалённые, не переданные производству)
 * позиции для снабжения. Колонки из V12_CONFIG.DEFICIT_COLUMNS.
 */
function v12RefreshDeficitSummary() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc === V12_CONFIG.LIFECYCLE_STATE.ARCHIVED || lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
      continue;
    }
    if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) {
      continue;
    }
    if (toNumber(r[P.DEFICIT_QTY - 1]) <= 0) {
      continue;   // нет дефицита — в сводку не берём
    }
    rows.push([
      r[P.POSITION_ID - 1],
      r[P.BOM_NAME - 1],
      r[P.BOM_ROW - 1],
      r[P.MATERIAL_CODE - 1],
      r[P.MATERIAL_NAME - 1],
      r[P.MODEL - 1],
      r[P.UNIT - 1],
      r[P.DEFICIT_QTY - 1],
      r[P.ORDERED_QTY - 1],
      r[P.UNCOVERED_NEED - 1],
      r[P.EXPECTED_DATE - 1],
      r[P.DEADLINE - 1],
      r[P.REAL_DELIVERY_QTY - 1],
      false, // RECEIVED checkbox
      false, // REAL_DELIVERY checkbox
      v12SupplyStatusDisplay(r[P.SUPPLY_STATE - 1], r[P.VALIDATION_STATUS - 1])
    ]);
  }

  v12ClearBody("DEFICIT_SUMMARY");
  if (rows.length) {
    v12WriteRows("DEFICIT_SUMMARY", 2, rows);
  }
  v12InstallDeficitCheckboxes(rows.length);
}

/**
 * Человекочитаемый статус для сводки.
 */
function v12SupplyStatusDisplay(supplyState, validation) {
  if (validation === V12_CONFIG.VALIDATION_STATUS.ERROR) {
    return "Ошибка данных";
  }
  const map = {
    [V12_CONFIG.SUPPLY_STATE.NO_REQUIREMENT]: "Нет потребности",
    [V12_CONFIG.SUPPLY_STATE.RESERVED]: "Зарезервировано",
    [V12_CONFIG.SUPPLY_STATE.NOT_ORDERED]: "Не заказано",
    [V12_CONFIG.SUPPLY_STATE.PARTIALLY_ORDERED]: "Заказано частично",
    [V12_CONFIG.SUPPLY_STATE.ORDERED]: "Заказано",
    [V12_CONFIG.SUPPLY_STATE.PARTIALLY_DELIVERED]: "Поставлено частично",
    [V12_CONFIG.SUPPLY_STATE.DELIVERED]: "Поставлено"
  };
  return map[supplyState] || supplyState || "";
}

/**
 * Чекбоксы «Получено» (RECEIVED, кол. 14) и «Реальная поставка» (REAL_DELIVERY, кол. 15).
 */
function v12InstallDeficitCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const lastRow = sheet.getLastRow();
  const maxRows = Math.max(lastRow - 1, rowCount || 0);
  if (maxRows <= 0) {
    return;
  }
  sheet.getRange(2, D.RECEIVED, maxRows, 1).clearDataValidations();
  sheet.getRange(2, D.REAL_DELIVERY, maxRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, D.RECEIVED, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    sheet.getRange(2, D.REAL_DELIVERY, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * ОТБОРКА (PICKING): активные позиции, готовые/частично готовые к передаче.
 */
function v12RefreshPicking() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const K = V12_CONFIG.PICKING_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) {
      continue;
    }
    if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) {
      continue;
    }
    const materialKey = v12BuildMaterialKey({
      code: r[P.MATERIAL_CODE - 1],
      name: r[P.MATERIAL_NAME - 1],
      model: r[P.MODEL - 1],
      unit: r[P.UNIT - 1]
    });
    const warehouse = v12GetWarehouseQty(materialKey);
    rows.push([
      r[P.POSITION_ID - 1],
      r[P.BOM_NAME - 1],
      r[P.BOM_ROW - 1],
      r[P.MATERIAL_CODE - 1],
      r[P.MATERIAL_NAME - 1],
      r[P.MODEL - 1],
      r[P.UNIT - 1],
      r[P.REQUIRED_QTY - 1],
      r[P.RESERVED_QTY - 1],
      r[P.AVAILABLE_FOR_PRODUCTION - 1],
      warehouse,
      r[P.PRODUCTION_STATE - 1],
      false, // CHECKBOX
      r[P.RECEIVED_BY_PRODUCTION_QTY - 1],
      new Date()
    ]);
  }

  v12ClearBody("PICKING");
  if (rows.length) {
    v12WriteRows("PICKING", 2, rows);
  }
  v12InstallPickingCheckboxes(rows.length);
}

/**
 * Чекбокс передачи в ОТБОРКЕ (кол. 13).
 */
function v12InstallPickingCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("PICKING");
  const K = V12_CONFIG.PICKING_COLUMNS;
  const lastRow = sheet.getLastRow();
  const maxRows = Math.max(lastRow - 1, rowCount || 0);
  if (maxRows <= 0) {
    return;
  }
  sheet.getRange(2, K.CHECKBOX, maxRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, K.CHECKBOX, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * WORKING BOM: активные позиции по всем BOM (для производства).
 */
function v12RefreshWorkingBOM() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const W = V12_CONFIG.WORKING_BOM_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) {
      continue;
    }
    rows.push([
      r[P.POSITION_ID - 1],
      r[P.BOM_NAME - 1],
      r[P.BOM_ROW - 1],
      r[P.MATERIAL_CODE - 1],
      r[P.MATERIAL_NAME - 1],
      r[P.MODEL - 1],
      r[P.UNIT - 1],
      r[P.REQUIRED_QTY - 1],
      r[P.RESERVED_QTY - 1],
      r[P.REAL_DELIVERY_QTY - 1],
      r[P.AVAILABLE_FOR_PRODUCTION - 1],
      r[P.RECEIVED_BY_PRODUCTION_QTY - 1],
      r[P.PRODUCTION_STATE - 1],
      new Date()
    ]);
  }

  v12ClearBody("WORKING_BOM");
  if (rows.length) {
    v12WriteRows("WORKING_BOM", 2, rows);
  }
}
/**
 * СНАБЖЕНИЕ (SUPPLY): агрегация по materialKey (ТЗ №68–71).
 */
function v12RefreshSupply() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const S = V12_CONFIG.SUPPLY_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const agg = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc === V12_CONFIG.LIFECYCLE_STATE.ARCHIVED || lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
      continue;
    }
    const key = v12BuildMaterialKey({
      code: r[P.MATERIAL_CODE - 1],
      name: r[P.MATERIAL_NAME - 1],
      model: r[P.MODEL - 1],
      unit: r[P.UNIT - 1]
    });
    if (!agg[key]) {
      agg[key] = {
        code: r[P.MATERIAL_CODE - 1],
        name: r[P.MATERIAL_NAME - 1],
        model: r[P.MODEL - 1],
        unit: r[P.UNIT - 1],
        required: 0, reserved: 0, deficit: 0, ordered: 0,
        realDelivery: 0, uncovered: 0, bomCount: 0
      };
    }
    const a = agg[key];
    a.required += toNumber(r[P.REQUIRED_QTY - 1]);
    a.reserved += toNumber(r[P.RESERVED_QTY - 1]);
    a.deficit += toNumber(r[P.DEFICIT_QTY - 1]);
    a.ordered += toNumber(r[P.ORDERED_QTY - 1]);
    a.realDelivery += toNumber(r[P.REAL_DELIVERY_QTY - 1]);
    a.uncovered += toNumber(r[P.UNCOVERED_NEED - 1]);
    a.bomCount += 1;
  }

  const rows = Object.keys(agg).map(function (key) {
    const a = agg[key];
    return [key, a.code, a.name, a.model, a.unit,
      a.required, a.reserved, a.deficit, a.ordered,
      a.realDelivery, a.uncovered, a.bomCount, new Date()];
  });

  v12ClearBody("SUPPLY");
  if (rows.length) {
    v12WriteRows("SUPPLY", 2, rows);
  }
}

/**
 * Агрегация по BOM: подсчёт позиций и BOM-статус (К2).
 * Возвращает Map<bomId, { total, collected, notOrdered, partial, late, onTime, errors, status, missing }>.
 */
function v12AggregateBomStates() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const bomMap = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const bomId = normalizeMaterialId(r[P.BOM_ID - 1]);
    if (!bomId) {
      continue;
    }
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
      continue;
    }
    if (!bomMap[bomId]) {
      bomMap[bomId] = {
        bomName: r[P.BOM_NAME - 1],
        total: 0, collected: 0, notOrdered: 0, partial: 0,
        late: 0, onTime: 0, errors: 0, missing: [],
        minDeadline: null
      };
    }
    const b = bomMap[bomId];
    b.total++;
    const deadline = r[P.DEADLINE - 1];
    if (deadline && (b.minDeadline === null || new Date(b.minDeadline) > new Date(deadline))) {
      b.minDeadline = deadline;
    }
    const supply = r[P.SUPPLY_STATE - 1];
    const production = r[P.PRODUCTION_STATE - 1];
    const validation = r[P.VALIDATION_STATUS - 1];
    const received = r[P.RECEIVED_BY_PRODUCTION - 1] === true;

    if (validation === V12_CONFIG.VALIDATION_STATUS.ERROR) {
      b.errors++;
      b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Ошибка данных" });
      continue;
    }
    if (production === V12_CONFIG.PRODUCTION_STATE.RECEIVED) {
      b.collected++;
      continue;
    }
    switch (supply) {
      case V12_CONFIG.SUPPLY_STATE.NOT_ORDERED:
        b.notOrdered++;
        b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Не заказано" });
        break;
      case V12_CONFIG.SUPPLY_STATE.PARTIALLY_ORDERED:
        b.partial++;
        b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Заказано частично" });
        break;
      case V12_CONFIG.SUPPLY_STATE.PARTIALLY_DELIVERED:
        b.partial++;
        b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Поставлено частично" });
        break;
      case V12_CONFIG.SUPPLY_STATE.ORDERED:
        b.onTime++;
        break;
      default:
        b.onTime++;
    }
  }
  return bomMap;
}

/**
 * Определить BOM-статус по агрегату (К2).
 */
function v12ComputeBomStatus(agg) {
  const BS = V12_CONFIG.BOM_STATUS;
  if (agg.errors > 0) {
    return BS.ERROR;
  }
  if (agg.collected === agg.total && agg.total > 0) {
    return BS.READY;
  }
  if (agg.notOrdered === agg.total) {
    return BS.NOT_PROCESSED;
  }
  if (agg.notOrdered > 0 || agg.partial > 0) {
    return BS.PARTIAL_SELECTED;
  }
  if (agg.late > 0) {
    return BS.WAITING_LATE;
  }
  return BS.WAITING_ON_TIME;
}

/**
 * DASHBOARD: сводка по BOM. Чекбокс «Выполнено» (DONE) активен только
 * при «Готов к производству» (ТЗ №53).
 */
function v12RefreshDashboard() {
  const D = V12_CONFIG.DASHBOARD_COLUMNS;
  const agg = v12AggregateBomStates();
  const excluded = v12BuildExcludedMap();
  const bomIds = Object.keys(agg);
  const revDates = v12BuildRevisionDateMap();
  const rows = [];

  bomIds.forEach(function (bomId) {
    const a = agg[bomId];
    const status = v12ComputeBomStatus(a);
    const progress = a.total > 0 ? Math.round((a.collected / a.total) * 100) : 0;
    const missingText = a.missing.length
      ? a.missing.map(function (m) {
          return (m.code || m.name) + " (" + m.reason + ")";
        }).join("; ")
      : "";
    const done = excluded[bomId] === true;
    rows.push([
      done,
      bomId,
      a.bomName,
      status,
      a.total,
      a.collected,
      progress,
      revDates[bomId] || "",
      a.minDeadline || "",
      missingText,
      new Date()
    ]);
  });

  v12ClearBody("DASHBOARD");
  if (rows.length) {
    v12WriteRows("DASHBOARD", 2, rows);
  }
  v12InstallDashboardCheckboxes(rows.length);
  v12ApplyDashboardColors();
  v12SetupDashboardNotes(rows);
}

/**
 * Карта «дата создания» BOM из BOM_REVISION (самая ранняя ревизия).
 * Возвращает { bomId: date }.
 */
function v12BuildRevisionDateMap() {
  const revData = v12ReadSheet("BOM_REVISION");
  const R = V12_CONFIG.BOM_REVISION_COLUMNS;
  const map = {};
  for (let i = 1; i < revData.length; i++) {
    const bomId = normalizeMaterialId(revData[i][R.BOM_ID - 1]);
    const date = revData[i][R.DATE - 1];
    if (!bomId || !date) {
      continue;
    }
    const t = new Date(date).getTime();
    if (!map[bomId] || (!isNaN(t) && t < new Date(map[bomId]).getTime())) {
      map[bomId] = date;
    }
  }
  return map;
}

/**
 * Чекбокс «Выполнено» в DASHBOARD (кол. 1).
 */
function v12InstallDashboardCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("DASHBOARD");
  const lastRow = sheet.getLastRow();
  const maxRows = Math.max(lastRow - 1, rowCount || 0);
  if (maxRows <= 0) {
    return;
  }
  sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.DONE, maxRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.DONE, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Условное форматирование статусной колонки DASHBOARD.
 */
function v12ApplyDashboardColors() {
  const sheet = v12GetSheetByKey("DASHBOARD");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  const range = sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.STATUS, lastRow - 1, 1);
  const rules = [];
  const BS = V12_CONFIG.BOM_STATUS;
  const BSC = V12_CONFIG.BOM_STATUS_COLOR;
  Object.keys(BSC).forEach(function (label) {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextContains(label)
        .setBackground(V12_CONFIG.COLORS[BSC[label]])
        .setRanges([range])
        .build()
    );
  });
  sheet.setConditionalFormatRules(rules);
}

/**
 * Hover-подсказки (ноты) на статус DASHBOARD — «недостающие позиции».
 */
function v12SetupDashboardNotes(rows) {
  const sheet = v12GetSheetByKey("DASHBOARD");
  const notes = rows.map(function (r) {
    return [r[V12_CONFIG.DASHBOARD_COLUMNS.MISSING_ITEMS - 1]
      ? "Недостающие позиции:\n" + r[V12_CONFIG.DASHBOARD_COLUMNS.MISSING_ITEMS - 1]
      : ""];
  });
  if (notes.length) {
    sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.STATUS, notes.length, 1).setNotes(notes);
  }
}
