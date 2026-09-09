/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: controller.js
 *
 * Меню, полное обновление, установка, диагностика.
 * =====================================================
 */

function onOpen() {
  // V12 — активная система (архитектура SOURCE ≠ STATE ≠ VIEW).
  v12OnOpen();
}

/**
 * Полное обновление системы.
 */
function runFullUpdate() {
  const lock = acquireScriptLock();
  try {
    logSystem("runFullUpdate", "Старт обновления", "INFO");

    saveDeficitChanges();
    recalculateMaterials();

    archiveReceivedMaterials();

    updateDeficitSummary();
    recalculateBOMState();
    applyStatusColors();
    updateDashboard();

    syncV11();

    logSystem("runFullUpdate", "Обновление завершено", "INFO");
    SpreadsheetApp.getUi().alert("✅ BOM CONTROL V11 обновлена");
  } catch (error) {
    logSystem("runFullUpdate", "ОШИБКА: " + error.message, error, "ERROR");
    SpreadsheetApp.getUi().alert("Ошибка:\n" + error.message);
  } finally {
    lock.releaseLock();
    flushSystemLog();
  }
}

/**
 * Запуск импорта BOM из папки Drive.
 */
function runBOMImport() {
  try {
    syncAllBOM();
    SpreadsheetApp.getUi().alert("✅ Импорт BOM завершён");
  } catch (error) {
    SpreadsheetApp.getUi().alert("Ошибка импорта:\n" + error.message);
  }
}

function showBOMImport() {
  runBOMImport();
}

/**
 * Синхронизация Google Sheets.
 */
function syncV11() {
  SpreadsheetApp.flush();
}

/**
 * Полная проверка системы (наличие листов).
 */
function fullSystemCheck() {
  const result = {};
  Object.keys(V11_CONFIG.SHEETS).forEach((key) => {
    result[key] = checkSheetExists(V11_CONFIG.SHEETS[key]);
  });
  logSystem("fullSystemCheck", "Проверка завершена", result);
  return result;
}

/**
 * Обновление одного BOM.
 */
function updateSingleBOM(bom) {
  if (!bom) {
    return;
  }
  const data = getMaterialsByBOM(bom);
  if (!data || !data.length) {
    return;
  }
  recalculateBOMState();
  applyStatusColors();
  updateDashboard();
  logSystem("updateSingleBOM", "BOM обновлен: " + bom, "INFO");
}

function getMaterialsByBOM(bom) {
  const index = buildMaterialIndex();
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  const result = [];
  for (const m of index.values()) {
    if (normalizeMaterialId(m.values[C.BOM - 1]) === normalizeMaterialId(bom)) {
      result.push(m);
    }
  }
  return result;
}

/**
 * Установка системы.
 */
function installV11() {
  const lock = acquireScriptLock();
  try {
    ensureAllSheets();
    formatAllSheets();
    protectMaterialStateSheet();
    installV11Triggers();
    logSystem("installV11", "Система установлена", "INFO");
    SpreadsheetApp.getUi().alert("BOM Control System V11 установлена");
  } catch (error) {
    SpreadsheetApp.getUi().alert("Ошибка установки V11: " + error.message);
    logSystem("installV11", error.message, error, "ERROR");
  } finally {
    lock.releaseLock();
    flushSystemLog();
  }
}

/**
 * Защита листа MATERIAL_STATE от ручного редактирования.
 * Скрипт (владелец) продолжает иметь доступ к записи.
 */
function protectMaterialStateSheet() {
  const sheet = getSheetByKey("MATERIAL_STATE");
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach((p) => p.remove());
  const protection = sheet.protect();
  protection.setDescription("MATERIAL_STATE защищён от ручного редактирования");
  protection.setWarningOnly(false);
  // Дать скрипту (текущему пользователю) возможность писать, чтобы правки из
  // сводки/импорта сохранялись, не ломая скрипт при защищённом листе.
  const user = getCurrentUser();
  if (user && user !== "unknown") {
    try {
      protection.addEditor(user);
    } catch (e) {
      logSystem("protectMaterialStateSheet", "Не удалось добавить редактора: " + user + " — " + e.message, e, "WARNING");
    }
  }
}

/**
 * Восстановление системы.
 */
function rebuildV11() {
  logSystem("rebuildV11", "Начато восстановление", "INFO");
  installV11();
  syncV11();
  runFullUpdate();
  logSystem("rebuildV11", "Восстановление завершено", "INFO");
}

/**
 * Проверка существования листа.
 */
function checkSheetExists(name) {
  return Boolean(SpreadsheetApp.getActive().getSheetByName(name));
}
