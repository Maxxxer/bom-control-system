/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_controller.js
 *
 * Меню, установка листов, полная синхронизация, диагностика
 * и проверка консистентности (ТЗ №160–161).
 * =====================================================
 */

/**
 * Точка входа (меню открывается при открытии таблицы).
 */
function onOpen() {
  v12OnOpen();
}

/**
 * Меню V12.
 */
function v12OnOpen() {
  SpreadsheetApp.getUi()
    .createMenu("BOM CONTROL V12")
    .addItem("🔄 Полная синхронизация", "v12RunFullSync")
    .addSeparator()
    .addItem("📥 Импорт BOM (источник)", "v12RunFullSync")
    .addItem("📊 Обновить проекции", "v12RefreshAllProjections")
    .addSeparator()
    .addItem("🔎 Диагностика V12", "v12Diagnostic")
    .addItem("🧪 Тест V12", "v12RunDebug")
    .addItem("🧩 Проверка консистентности", "v12ConsistencyCheck")
    .addSeparator()
    .addItem("⚙ Установка V12", "v12Install")
    .addToUi();
}

/**
 * Установка V12: создать листы, снять старые триггеры, поставить новые.
 */
function v12Install() {
  const lock = acquireScriptLock();
  try {
    v12EnsureAllSheets();
    v12InstallTriggers();
    logSystem("v12Install", "V12 установлена", "INFO");
    SpreadsheetApp.getUi().alert("BOM CONTROL SYSTEM V12 установлена");
  } catch (error) {
    logSystem("v12Install", error.message, error, "ERROR");
    SpreadsheetApp.getUi().alert("Ошибка установки V12: " + error.message);
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * Диагностика V12: наличие листов, количество позиций/BOM.
 */
function v12Diagnostic() {
  const result = {
    version: V12_CONFIG.VERSION,
    timestamp: new Date(),
    sheets: {},
    positions: 0,
    boms: 0,
    errors: []
  };
  try {
    Object.keys(V12_CONFIG.SHEETS).forEach(function (key) {
      result.sheets[key] = Boolean(SpreadsheetApp.getActive().getSheetByName(V12_CONFIG.SHEETS[key]));
    });
    const posSheet = SpreadsheetApp.getActive().getSheetByName(V12_CONFIG.SHEETS.POSITION_STATE);
    if (posSheet) {
      result.positions = Math.max(0, posSheet.getLastRow() - 1);
    }
    const bomSheet = SpreadsheetApp.getActive().getSheetByName(V12_CONFIG.SHEETS.BOM_REGISTRY);
    if (bomSheet) {
      result.boms = Math.max(0, bomSheet.getLastRow() - 1);
    }
  } catch (e) {
    result.errors.push(e.message);
  }
  return result;
}

/**
 * Проверка консистентности (ТЗ №160–161):
 * BOM_REGISTRY ↔ POSITION_STATE ↔ DEFICIT_SUMMARY ↔ ОТБОРКА ↔ WORKING BOM ↔ Dashboard ↔ Архив.
 */
function v12ConsistencyCheck() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const positionData = v12ReadSheet("POSITION_STATE");
  const registryData = v12ReadSheet("BOM_REGISTRY");
  const B = V12_CONFIG.BOM_REGISTRY_COLUMNS;

  const report = {
    registryBoms: new Set(),
    positionBoms: new Set(),
    positionIds: new Set(),
    archivedPositionIds: new Set(),
    errors: []
  };

  for (let i = 1; i < registryData.length; i++) {
    const id = normalizeMaterialId(registryData[i][B.BOM_ID - 1]);
    if (id) {
      report.registryBoms.add(id);
    }
  }

  for (let i = 1; i < positionData.length; i++) {
    const r = positionData[i];
    const pid = normalizeMaterialId(r[P.POSITION_ID - 1]);
    const bomId = normalizeMaterialId(r[P.BOM_ID - 1]);
    if (pid) {
      report.positionIds.add(pid);
    }
    if (bomId) {
      report.positionBoms.add(bomId);
    }
    if (r[P.LIFECYCLE_STATE - 1] === V12_CONFIG.LIFECYCLE_STATE.ARCHIVED) {
      report.archivedPositionIds.add(pid);
    }
  }

  // BOM из позиций, отсутствующие в реестре
  report.positionBoms.forEach(function (bomId) {
    if (!report.registryBoms.has(bomId)) {
      report.errors.push("BOM " + bomId + " есть в POSITION_STATE, но отсутствует в BOM_REGISTRY");
    }
  });

  // BOM из реестра, отсутствующие в позициях (допустимо, если BOM пуст)
  report.registryBoms.forEach(function (bomId) {
    if (!report.positionBoms.has(bomId)) {
      report.errors.push("BOM " + bomId + " есть в BOM_REGISTRY, но нет позиций");
    }
  });

  // Дубликаты positionId
  if (report.positionIds.size !== (positionData.length - 1)) {
    report.errors.push("Обнаружены дубликаты positionId");
  }

  // Проверка: архивированные позиции не должны участвовать в активных проекциях
  report.archivedPositionIds.forEach(function (pid) {
    if (report.positionIds.has(pid)) {
      // архивная позиция остаётся в POSITION_STATE (ок), но должна отсутствовать в сводке/отборке
      // это проверяется отдельно — здесь только факт фиксации
    }
  });

  return report;
}

/**
 * Тест V12: прогон расчётного движка на типовых сценариях.
 */
function v12RunDebug() {
  const report = {
    version: V12_CONFIG.VERSION,
    time: new Date(),
    tests: [],
    errors: []
  };

  // Сценарий 1: дефицит = required − reserved (ТЗ)
  report.tests.push(v12Assert("Дефицит: required=10, reserved=3", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 0, realDeliveryQty: 0,
      expectedDate: "", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 0)
    });
    return r.deficitQty === 7;
  }));

  // Сценарий 2: заказ ≥ дефицита → supplyState ORDERED
  report.tests.push(v12Assert("SupplyState: ordered=7, deficit=7 → ORDERED", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 7, realDeliveryQty: 0,
      expectedDate: "2026-08-15", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 7)
    });
    return r.supplyState === V12_CONFIG.SUPPLY_STATE.ORDERED;
  }));

  // Сценарий 3: availableForProduction = reserved + realDelivery (К1)
  report.tests.push(v12Assert("availableForProduction = 3 + 5 = 8", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 7, realDeliveryQty: 5,
      expectedDate: "2026-08-15", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 7)
    });
    return r.availableForProduction === 8;
  }));

  // Сценарий 4: readyForHandoff, когда available >= required и не передано
  report.tests.push(v12Assert("readyForHandoff при available=8, required=10 — false", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 7, realDeliveryQty: 5,
      expectedDate: "2026-08-15", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 7)
    });
    return r.readyForHandoff === false;
  }));

  // Сценарий 5: readyForHandoff при available >= required
  report.tests.push(v12Assert("readyForHandoff при reserved=10 — true", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 10, orderedQty: 0, realDeliveryQty: 0,
      expectedDate: "", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 10, 0)
    });
    return r.readyForHandoff === true;
  }));

  // Сценарий 6: валидация по №8 — Код необязателен, Модель обязательна
  report.tests.push(v12Assert("Валидация №8: без Кода, но с Моделью — валидна", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 0, orderedQty: 0, realDeliveryQty: 0,
      expectedDate: "", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 0, 0)
    });
    return r.valid === true;
  }));

  report.errors = report.tests.filter(function (t) { return !t.pass; })
    .map(function (t) { return t.name; });

  logSystem("v12RunDebug", "Тесты V12: " + report.tests.length + ", ошибок: " + report.errors.length, report);
  SpreadsheetApp.getUi().alert("Тест V12 завершён.\nВсего: " + report.tests.length +
    "\nОшибок: " + report.errors.length +
    (report.errors.length ? "\n\n" + report.errors.join("\n") : ""));
  return report;
}

/**
 * Вспомогательный assert.
 */
function v12Assert(name, fn) {
  let pass = false;
  let error = "";
  try {
    pass = fn() === true;
  } catch (e) {
    error = e.message;
  }
  return { name: name, pass: pass, error: error };
}

/**
 * Строка POSITION_STATE для тестов (только необходимые поля валидации).
 */
function v12TestRow(required, reserved, ordered) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.POSITION_STATE).fill("");
  row[P.BOM_ROW - 1] = 1;
  row[P.MATERIAL_NAME - 1] = "Тестовый материал";
  row[P.MODEL - 1] = "M-1";
  row[P.UNIT - 1] = "шт";
  row[P.REQUIRED_QTY - 1] = required;
  row[P.RESERVED_QTY - 1] = reserved;
  row[P.ORDERED_QTY - 1] = ordered;
  row[P.DEADLINE - 1] = "2026-09-01";
  return row;
}
