/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: deficit_engine.js
 *
 * Сводка дефицитов: обновление, сохранение ручных изменений,
 * обработка чекбоксов «Получено» и «Реальная поставка».
 * =====================================================
 */

/**
 * Обновление сводки дефицитов.
 */
function updateDeficitSummary() {
  const lock = acquireScriptLock();
  try {
    const source = getSheetByKey("MATERIAL_STATE");
    const target = getSheetByKey("DEFICIT_SUMMARY");
    const data = readSheetValues(source);
    const C = V11_CONFIG.MATERIAL_COLUMNS;
    const D = V11_CONFIG.DEFICIT_COLUMNS;

    // Сохранить старые чекбоксы
    const oldCheckbox = {};
    const oldReceived = {};
    const oldLastRow = target.getLastRow();
    if (oldLastRow > 1) {
      const oldData = readRange(target, 2, 1, oldLastRow - 1, V11_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY);
      oldData.forEach((row) => {
        const id = normalizeMaterialId(row[D.MATERIAL_ID - 1]);
        if (id) {
          oldCheckbox[id] = row[D.REAL_DELIVERY - 1] === true;
          oldReceived[id] = row[D.RECEIVED - 1] === true;
        }
      });
    }

    const result = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const materialId = normalizeMaterialId(row[C.MATERIAL_ID - 1]);
      if (!materialId) {
        continue;
      }

      // Полученные — убираем
      if (row[C.RECEIVED - 1] === true) {
        continue;
      }
      // Архивные — убираем
      if (row[C.STATE - 1] === V11_CONFIG.MATERIAL_STATE.ARCHIVED) {
        continue;
      }

      const required = toNumber(row[C.REQUIRED - 1]);
      const ordered = toNumber(row[C.ORDERED - 1]);
      const deficit = Math.max(required - toNumber(row[C.RESERVED - 1]) - ordered, 0);
      const expected = row[C.EXPECTED_DATE - 1] || "";
      const deadline = row[C.DEADLINE_DATE - 1] || "";

      const realDelivery = row[C.REAL_DELIVERY - 1] === true;

      let status;
      if (realDelivery) {
        status = V11_CONFIG.MATERIAL_STATUS.STOCK;
      } else if (ordered <= 0) {
        status = V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED;
      } else if (ordered < required) {
        status = V11_CONFIG.MATERIAL_STATUS.PARTIAL_ORDER;
      } else if (expected && deadline && new Date(expected) > new Date(deadline)) {
        status = V11_CONFIG.MATERIAL_STATUS.ORDERED_LATE;
      } else {
        status = V11_CONFIG.MATERIAL_STATUS.ORDERED_ON_TIME;
      }

      result.push([
        oldReceived[materialId] || false,
        materialId,
        row[C.BOM - 1],
        row[C.MATERIAL_CODE - 1],
        row[C.MATERIAL_NAME - 1],
        required,
        ordered,
        deficit,
        expected,
        deadline,
        oldCheckbox[materialId] || false,
        status
      ]);
    }

    clearBody(target);

    if (result.length) {
      writeValues(target, 2, 1, result);
    }

    // Миграция заголовка на канонический (русский, 12 колонок)
    const expectedHeader = V11_CONFIG.HEADERS.DEFICIT_SUMMARY;
    const currentHeader = target.getRange(1, 1, 1, V11_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY).getValues()[0];
    if (currentHeader.join("|") !== expectedHeader.join("|")) {
      target.getRange(1, 1, 1, expectedHeader.length).setValues([expectedHeader]);
    }

    createDeliveryCheckboxes();
    flushSheets();

    logSystem("updateDeficitSummary", "Материалов в сводке: " + result.length, "INFO");
  } catch (error) {
    logSystem("updateDeficitSummary", error.message, error, "ERROR");
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Сохранение ручных изменений из сводки (заказ, даты) в MATERIAL_STATE.
 */
function saveDeficitChanges() {
  const lock = acquireScriptLock();
  try {
    const sheet = getSheetByKey("DEFICIT_SUMMARY");
    flushSheets();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return;
    }
    const data = readRange(sheet, 2, 1, lastRow - 1, V11_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY);
    const D = V11_CONFIG.DEFICIT_COLUMNS;
    let changed = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row[D.RECEIVED - 1] === true) {
        continue;
      }
      const materialId = normalizeMaterialId(row[D.MATERIAL_ID - 1]);
      if (!materialId) {
        continue;
      }

      const ordered = toNumber(row[D.ORDERED - 1]);
      const expected = row[D.EXPECTED_DATE - 1] || "";
      const deadline = row[D.DEADLINE_DATE - 1] || "";
      const material = getMaterialById(materialId);
      if (!material) {
        continue;
      }
      const old = material.values;
      const oldOrdered = toNumber(old[V11_CONFIG.MATERIAL_COLUMNS.ORDERED - 1]);
      const oldExpected = old[V11_CONFIG.MATERIAL_COLUMNS.EXPECTED_DATE - 1] || "";
      const oldDeadline = old[V11_CONFIG.MATERIAL_COLUMNS.DEADLINE_DATE - 1] || "";

      if (
        oldOrdered === ordered &&
        String(oldExpected) === String(expected) &&
        String(oldDeadline) === String(deadline)
      ) {
        continue;
      }

      updateMaterialState(materialId, {
        ORDERED: ordered,
        EXPECTED_DATE: expected,
        DEADLINE_DATE: deadline
      });
      flushSheets();

      addMaterialHistory({
        materialId: materialId,
        event: "DEFICIT_SUMMARY_UPDATE",
        oldValue: JSON.stringify({ ordered: oldOrdered, expected: oldExpected, deadline: oldDeadline }),
        newValue: JSON.stringify({ ordered: ordered, expected: expected, deadline: deadline }),
        comment: "Изменение через сводку дефицитов"
      });
      changed++;
    }

    flushSheets();
    logSystem("saveDeficitChanges", "Изменено материалов: " + changed, "INFO");
  } catch (error) {
    logSystem("saveDeficitChanges", error.message, error, "ERROR");
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Чекбоксы «Получено» (кол 1) и «Реальная поставка» (кол 11).
 */
function createDeliveryCheckboxes() {
  const sheet = getSheetByKey("DEFICIT_SUMMARY");
  const rows = sheet.getLastRow() - 1;
  if (rows <= 0) {
    return;
  }
  sheet.getRange(2, V11_CONFIG.DEFICIT_COLUMNS.RECEIVED, rows, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sheet.getRange(2, V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY, rows, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
}

/**
 * Обработка чекбокса реальной поставки в сводке.
 */
function processSummaryCheckbox(row) {
  const sheet = getSheetByKey("DEFICIT_SUMMARY");
  const materialId = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
  if (!materialId) {
    return;
  }
  const checked = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY).getValue();
  if (checked === true) {
    confirmRealDelivery(materialId);
  } else {
    cancelRealDelivery(materialId);
  }
}

/**
 * Обработка чекбокса «Получено производством» в сводке.
 */
function processSummaryReceived(row) {
  const sheet = getSheetByKey("DEFICIT_SUMMARY");
  const materialId = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID).getValue();
  if (!materialId) {
    return;
  }
  const checked = sheet.getRange(row, V11_CONFIG.DEFICIT_COLUMNS.RECEIVED).getValue();
  if (checked === true) {
    archiveFromDeficitSummary(materialId);
  }
}

/**
 * Получение производством + перенос в архив.
 */
function archiveFromDeficitSummary(materialId) {
  confirmMaterialReceived(materialId);
  archiveMaterial(materialId);
  flushSheets();
  logSystem("archiveFromDeficitSummary", "Материал получен и архивирован: " + materialId, "INFO");
}

/**
 * Полное обновление статусов после изменений.
 */
function refreshDeficitStatus() {
  saveDeficitChanges();
  flushSheets();
  Utilities.sleep(500);
  recalculateMaterials();
  flushSheets();
  updateDeficitSummary();
  flushSheets();
  recalculateBOMState();
  applyStatusColors();
  updateDashboard();
  logSystem("refreshDeficitStatus", "Статусы обновлены", "INFO");
}
