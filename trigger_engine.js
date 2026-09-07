/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: trigger_engine.js
 *
 * Триггеры. Один onEdit + один time-based.
 * Защита от рекурсии и от параллельного запуска.
 * =====================================================
 */

/**
 * Установить все триггеры (сначала удалить старые).
 */
function installV11Triggers() {
  removeV11Triggers();

  const ss = SpreadsheetApp.getActive();

  ScriptApp.newTrigger("v11OnEdit")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  ScriptApp.newTrigger("v11ScheduledUpdate")
    .timeBased()
    .everyHours(1)
    .create();

  logSystem("installV11Triggers", "Триггеры установлены", "INFO");
}

/**
 * Удалить все проектные триггеры.
 */
function removeV11Triggers() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    ScriptApp.deleteTrigger(trigger);
  });
}

/**
 * Главный onEdit.
 */
function v11OnEdit(e) {
  try {
    // Guard: событие может отсутствовать
    if (!e || !e.range) {
      return;
    }

    const sheet = e.range.getSheet();
    if (!sheet) {
      return;
    }

    // Игнор пустых и multi-cell правок
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) {
      return;
    }

    // Защита от рекурсии: во время пересчёта не обрабатываем onEdit
    if (isV11Busy()) {
      return;
    }

    const name = sheet.getName();
    const row = e.range.getRow();
    const column = e.range.getColumn();

    if (name === V11_CONFIG.SHEETS.DEFICIT_SUMMARY) {
      let handled = false;
      try {
        if (column === V11_CONFIG.DEFICIT_COLUMNS.RECEIVED && row > 1) {
          handled = true;
          processSummaryReceived(row);
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY && row > 1) {
          handled = true;
          processSummaryCheckbox(row);
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.EXPECTED_DATE && row > 1) {
          handled = true;
          const id = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
          const date = e.range.getValue();
          eventDeliveryDateChanged(id, date);
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.DEADLINE_DATE && row > 1) {
          handled = true;
          const id = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
          const date = e.range.getValue();
          eventDeadlineDateChanged(id, date);
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.ORDERED && row > 1) {
          handled = true;
          const id = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
          const qty = e.range.getValue();
          eventMaterialOrdered(id, qty);
        }
      } catch (error) {
        logSystem("v11OnEdit", "DEFICIT_SUMMARY обработка: " + error.message, error, "ERROR");
      } finally {
        if (handled) {
          refreshAfterChange();
        }
      }
    }

    if (name.indexOf("BOM_") === 0) {
      checkBOMRevision();
    }
  } catch (error) {
    logSystem("v11OnEdit", error.message, error, "ERROR");
  }
}

/**
 * Плановое обновление: архив → пересчёт → сводка → BOM → дашборд → цвета.
 */
function v11ScheduledUpdate() {
  const lock = acquireScriptLock();
  try {
    setV11Busy(true);
    saveDeficitChanges();
    archiveReceivedMaterials();
    recalculateMaterials();
    updateDeficitSummary();
    recalculateBOMState();
    applyStatusColors();
    updateDashboard();
  } catch (error) {
    logSystem("v11ScheduledUpdate", error.message, error, "ERROR");
  } finally {
    setV11Busy(false);
    lock.releaseLock();
  }
}

/**
 * Обновление после изменения (используется из onEdit/импорта).
 */
function refreshAfterChange() {
  const lock = acquireScriptLock();
  try {
    setV11Busy(true);
    saveDeficitChanges();
    recalculateMaterials();
    recalculateBOMState();
    updateDeficitSummary();
    updateDashboard();
    applyStatusColors();
  } catch (error) {
    logSystem("refreshAfterChange", error.message, error, "ERROR");
  } finally {
    setV11Busy(false);
    lock.releaseLock();
  }
}

/**
 * Флаг занятости в ScriptProperties — защита от рекурсии.
 */
function isV11Busy() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(V11_CONFIG.SYSTEM_STATE.RECALCULATING) === "true";
}

function setV11Busy(flag) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(V11_CONFIG.SYSTEM_STATE.RECALCULATING, String(flag));
}

function dailyV11Update() {
  v11ScheduledUpdate();
}
