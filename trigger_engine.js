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
    const user = getCurrentUser();
    const role = getCurrentUserRole();

    // MATERIAL_STATE — центр данных, ручное редактирование запрещено
    if (name === V11_CONFIG.SHEETS.MATERIAL_STATE) {
      logSystem("v11OnEdit", "Ручное редактирование MATERIAL_STATE запрещено", "WARNING");
      return;
    }

    // DASHBOARD — только чекбокс «Выполнено» и только при «Готов к производству»
    if (name === V11_CONFIG.SHEETS.DASHBOARD) {
      if (column !== V11_CONFIG.DASHBOARD_COLUMNS.DONE || row <= 1) {
        revertEdit(e);
        logSystem("v11OnEdit", "В дашборде разрешён только чекбокс «Выполнено» (" + user + ")", "WARNING");
        return;
      }
      const bom = sheet.getRange(row, V11_CONFIG.DASHBOARD_COLUMNS.BOM).getValue();
      const status = sheet.getRange(row, V11_CONFIG.DASHBOARD_COLUMNS.STATUS).getValue();
      const checked = e.range.getValue();
      if (checked === true && status !== V11_CONFIG.BOM_STATUS.READY) {
        revertEdit(e);
        logSystem("v11OnEdit", "«Выполнено» можно отметить только при «Готов к производству»: " + bom, "WARNING");
        return;
      }
      setBOMDone(bom, checked === true);
      return;
    }

    // DEFICIT_SUMMARY
    if (name === V11_CONFIG.SHEETS.DEFICIT_SUMMARY) {
      if (!role) {
        revertEdit(e);
        logSystem("v11OnEdit", "Неизвестная роль: " + user + " — правка отклонена", "WARNING");
        return;
      }
      const fieldName = getDeficitFieldName(column);
      if (!fieldName) {
        revertEdit(e);
        logSystem("v11OnEdit", "Поле запрещено для правки: колонка " + column + " (" + user + ")", "WARNING");
        return;
      }
      if (!canEditField(role, fieldName)) {
        revertEdit(e);
        logSystem("v11OnEdit", "Запрещено для роли " + role + " поле " + fieldName + " (" + user + ")", "WARNING");
        return;
      }
      let handled = false;
      try {
        if (column === V11_CONFIG.DEFICIT_COLUMNS.RECEIVED) {
          handled = true;
          processSummaryReceived(row);
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY) {
          handled = true;
          processSummaryCheckbox(row);
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.EXPECTED_DATE) {
          handled = true;
          const id = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
          eventDeliveryDateChanged(id, e.range.getValue());
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.DEADLINE_DATE) {
          handled = true;
          const id = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
          eventDeadlineDateChanged(id, e.range.getValue());
        } else if (column === V11_CONFIG.DEFICIT_COLUMNS.ORDERED) {
          handled = true;
          const id = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
          eventMaterialOrdered(id, e.range.getValue());
        }
      } catch (error) {
        logSystem("v11OnEdit", "DEFICIT_SUMMARY обработка: " + error.message, error, "ERROR");
      } finally {
        if (handled) {
          refreshAfterChange();
        }
      }
      return;
    }

    if (name.indexOf("BOM_") === 0) {
      checkBOMRevision();
    }
  } catch (error) {
    logSystem("v11OnEdit", error.message, error, "ERROR");
  }
}

/**
 * Откат запрещённой ручной правки.
 */
function revertEdit(e) {
  try {
    if (e && e.range && e.oldValue !== undefined) {
      e.range.setValue(e.oldValue);
    }
  } catch (err) {
    logSystem("revertEdit", err.message, err, "ERROR");
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
    exportBOMMaterialsToDrive();
  } catch (error) {
    logSystem("v11ScheduledUpdate", error.message, error, "ERROR");
  } finally {
    setV11Busy(false);
    lock.releaseLock();
    flushSystemLog();
  }
}

/**
 * Обновление после изменения (используется из onEdit/импорта).
 *
 * ОПТИМИЗАЦИЯ: вместо полного recalculateMaterials() (пересчёт и перезапись
 * ВСЕХ строк MATERIAL_STATE на каждое изменение) — точечный пересчёт только
 * материалов, изменённых через сводку (их возвращает saveDeficitChanges).
 * Остальные действия (чекбоксы, заказ, даты) уже пересчитывают свой материал
 * внутри своего обработчика (confirmRealDelivery / updateExpectedDeliveryDate и т.д.).
 */
function refreshAfterChange() {
  const lock = acquireScriptLock();
  try {
    setV11Busy(true);
    const changedIds = saveDeficitChanges() || [];

    // Точечный пересчёт только тех материалов, которые изменились через сводку
    if (changedIds.length) {
      const index = buildMaterialIndex();
      changedIds.forEach((id) => recalculateMaterialStatus(id, index));
    }
    // Гарантируем, что батч-записи (updateMaterialState → batchWrite) видны
    // последующим чтениям MATERIAL_STATE в recalculateBOMState / updateDeficitSummary.
    flushSheets();

    recalculateBOMState();
    updateDeficitSummary();
    updateDashboard();
    applyStatusColors();
  } catch (error) {
    logSystem("refreshAfterChange", error.message, error, "ERROR");
  } finally {
    setV11Busy(false);
    lock.releaseLock();
    flushSystemLog();
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
