/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_controller.js
 *
 * Меню, установка листов (+ кнопка «ПРИМЕНИТЬ» в верхнем левом углу
 * рабочих листов), полная синхронизация, диагностика и проверка
 * консистентности (ТЗ №160–161).
 *
 * Обратная связь пользователю — ВСПЛЫВАЮЩИМИ сообщениями в правом нижнем
 * углу окна (v12_ui.js, 3 с; ошибки — 8 с). Модальных окон в коде нет,
 * кроме двух ui.prompt в диалоге «Вернуть из архива» (там нужен ввод).
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
  // V3 — модель «Применить»: число необработанных намерений выносим в подпись
  // пункта меню, чтобы пользователь видел «есть неприменённые изменения».
  // Подпись обновляется при открытии таблицы.
  let pending = 0;
  try {
    pending = v12CountPendingEdits();
    // Обновляем и ячейку-индикатор на видном листе: пользователь видит
    // «есть неприменённые изменения» даже не открывая меню.
    v12UpdatePendingIndicator(pending);
  } catch (e) {
    pending = 0;
  }
  const applyLabel = (pending > 0)
    ? "Применить изменения (" + pending + ")"
    : "Применить изменения";

  SpreadsheetApp.getUi()
    .createMenu("BOM CONTROL V12")
    .addItem(applyLabel, "v12ApplyChangesUI")
    .addItem("♻ Пересобрать очередь (по галочкам)", "v12RebuildPendingFromCheckedUI")
    .addItem("Восстановить кнопку «Применить»", "v12InstallApplyButtonUI")
    .addSeparator()
    .addItem("🔄 Полная синхронизация", "v12RunFullSync")
    .addItem("📊 Обновить проекции", "v12RefreshAllProjections")
    .addSeparator()
    .addItem("↩ Вернуть из архива", "v12PromptReturnFromArchive")
    .addSeparator()
    .addItem("🔎 Диагностика V12", "v12Diagnostic")
    .addItem("🧪 Тест V12", "v12RunDebug")
    .addItem("🧩 Проверка консистентности", "v12ConsistencyCheck")
    .addSeparator()
    .addItem("⚙ Установка V12", "v12Install")
    .addToUi();
}

/**
 * «Применить изменения» с обратной связью (V3).
 *
 * Вызывается из меню и с кнопки «ПРИМЕНИТЬ» на листе. Применяет все накопленные
 * намерения (v12ApplyChanges) и показывает сводку ВСПЛЫВАЮЩИМ сообщением в
 * правом нижнем углу окна (3 секунды) — без модальных окон.
 */
function v12ApplyChangesUI() {
  const result = v12ApplyChanges();
  const applied = (result && typeof result.drained === "number") ? result.drained : 0;
  const failed = (result && typeof result.failed === "number") ? result.failed : 0;
  if (result && result.skipped) {
    v12Toast("Система занята — повторите через несколько секунд.");
  } else if (result && result.error) {
    v12Toast("Ошибка применения: " + result.error, V12_UI.TOAST_SECONDS_ERROR);
  } else if (failed > 0) {
    v12Toast("Применено: " + applied + ", не применено: " + failed +
      " (см. PENDING_EDITS, колонка «Ошибка»)", V12_UI.TOAST_SECONDS_ERROR);
  } else if (applied > 0) {
    v12Toast("Применено изменений: " + applied);
  } else {
    v12Toast("Неприменённых изменений нет");
  }
  return result;
}

/**
 * «Пересобрать очередь» (пункт меню) с обратной связью.
 *
 * Приводит множество HANDOFF-намерений листа PENDING_EDITS к каноническому виду
 * по ФАКТИЧЕСКИ стоящим галочкам ОТБОРКИ и WORKING BOM: схлопывает возможные
 * дубли и ДОБИРАЕТ отмеченные позиции, по которым не пришло событие onEdit
 * (Google «глотает» всплески при массовой отметке). Так лист очереди становится
 * точным отражением отмеченных галочек ещё ДО нажатия «Применить».
 *
 * В норме вызывается автоматически при каждой правке чекбокса
 * (см. v12CaptureCheckboxEdit → v12ReconcilePendingHandoffs); пункт меню нужен
 * для ручного контроля и для случая, когда последнее событие onEdit было
 * потеряно платформой.
 *
 * Возвращает { added, pending } либо null, если очередь занята.
 */
function v12RebuildPendingFromCheckedUI() {
  let added;
  try {
    added = v12ReconcilePendingHandoffs();
  } catch (e) {
    logSystem("v12RebuildPendingFromCheckedUI", e.message, e, "ERROR");
    flushSystemLog();
    v12Toast("Не удалось пересобрать очередь: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return null;
  }
  if (added === null) {
    v12Toast("Очередь занята (идёт применение/синхронизация) — повторите через несколько секунд.");
    return null;
  }
  const pending = v12CountPendingEdits();
  v12UpdatePendingIndicator(pending);
  v12Toast("Очередь пересобрана: дополнено " + added +
    ", всего в очереди " + pending + " намерений");
  return { added: added, pending: pending };
}

/**
 * Установка V12: создать листы, снять старые триггеры, поставить новые.
 */
function v12Install() {
  const lock = acquireScriptLock();
  try {
    v12EnsureAllSheets();
    v12InstallTriggers();
    // Кнопка «Применить» в верхнем левом углу рабочих листов.
    v12InstallApplyButton();
    logSystem("v12Install", "V12 установлена", "INFO");
    v12Toast("Скрипт выполнен: V12 установлена, кнопка «" + V12_UI.BUTTON_LABEL + "» поставлена");
  } catch (error) {
    logSystem("v12Install", error.message, error, "ERROR");
    v12Toast("Ошибка установки V12: " + error.message, V12_UI.TOAST_SECONDS_ERROR);
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
    // Очередь правок (Вариант D): число необработанных намерений.
    result.pendingEdits = v12CountPendingEdits();
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
    errors: [],
    info: []
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
  }

  // BOM из позиций, отсутствующие в реестре
  report.positionBoms.forEach(function (bomId) {
    if (!report.registryBoms.has(bomId)) {
      report.errors.push("BOM " + bomId + " есть в POSITION_STATE, но отсутствует в BOM_REGISTRY");
    }
  });

  // BOM из реестра без позиций — это НОРМАЛЬНО (новый BOM или все позиции
  // отфильтрованы): не ошибка, а информационная заметка.
  report.registryBoms.forEach(function (bomId) {
    if (!report.positionBoms.has(bomId)) {
      report.info.push("BOM " + bomId + " есть в BOM_REGISTRY, но пока без позиций");
    }
  });

  // Дубликаты positionId: число уникальных ID сравниваем с числом НЕПУСТЫХ ID
  // (иначе строки с пустым Position ID давали бы ложное «обнаружены дубликаты»).
  const nonEmptyIdCount = positionData.slice(1).filter(function (r) {
    return normalizeMaterialId(r[P.POSITION_ID - 1]);
  }).length;
  if (report.positionIds.size !== nonEmptyIdCount) {
    report.errors.push("Обнаружены дубликаты positionId");
  }

  return report;
}

/**
 * Диалог возврата позиции из архива (ТЗ №78–82).
 * Запрашивает Position ID и причину, вызывает v12ReturnFromArchive.
 */
function v12PromptReturnFromArchive() {
  const ui = SpreadsheetApp.getUi();
  const idResponse = ui.prompt("Возврат из архива", "Position ID позиции:", ui.ButtonSet.OK_CANCEL);
  if (idResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  const positionId = String(idResponse.getResponseText() || "").trim();
  if (!positionId) {
    v12Toast("Position ID не указан");
    return;
  }
  const reasonResponse = ui.prompt("Возврат из архива", "Причина возврата:", ui.ButtonSet.OK_CANCEL);
  if (reasonResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  const reason = String(reasonResponse.getResponseText() || "").trim();
  const result = v12ReturnFromArchive(positionId, reason);
  if (result && result.status === "returned") {
    v12Toast("Позиция возвращена из архива: " + positionId);
  } else {
    v12Toast("Не удалось вернуть: " + ((result && result.reason) || "неизвестная ошибка"),
      V12_UI.TOAST_SECONDS_ERROR);
  }
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

  const summary = "Тест V12 завершён.\nВсего: " + report.tests.length +
    "\nОшибок: " + report.errors.length +
    (report.errors.length ? "\n\n" + report.errors.join("\n") : "");
  logSystem("v12RunDebug", summary, report, report.errors.length ? "WARNING" : "INFO");
  // Вместо модального окна — краткая всплывашка; полный отчёт — в SYSTEM_LOG.
  v12Toast("Тест V12: ошибок " + report.errors.length + " из " + report.tests.length +
    (report.errors.length ? " — подробности в SYSTEM_LOG" : ""));
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
