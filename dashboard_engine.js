/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: dashboard_engine.js
 *
 * Dashboard: обновление, условное форматирование, фильтр.
 * Условное форматирование — по фактическим строкам BOM_STATUS.
 * =====================================================
 */

function updateDashboard() {
  const source = getSheetByKey("BOM_STATE");
  const dashboard = getSheetByKey("DASHBOARD");
  const data = readSheetValues(source);

  clearBody(dashboard);

  if (data.length <= 1) {
    logSystem("updateDashboard", "Нет данных BOM", "INFO");
    return;
  }

  const rows = data.slice(1).map((r) => [
    r[0], // BOM
    r[8], // Статус
    r[2], // Дата создания
    r[3], // Позиций
    r[4], // Дефицит
    r[5], // Незаказано
    r[6], // Последняя поставка
    r[7], // Крайний срок
    r[9]  // Готовность
  ]);

  writeValues(dashboard, 2, 1, rows);
  applyDashboardColors();
  dashboard.autoResizeColumns(1, 9);
  setupDashboardFilter();

  logSystem("updateDashboard", "Dashboard обновлен: " + rows.length, "INFO");
}

/**
 * Условное форматирование статусной колонки (B) по реальным строкам.
 */
function applyDashboardColors() {
  const sheet = getSheetByKey("DASHBOARD");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  const range = sheet.getRange(2, 2, lastRow - 1, 1);
  const rules = [];

  const addRule = (text, color) => {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextContains(text)
        .setBackground(color)
        .setRanges([range])
        .build()
    );
  };

  const BS = V11_CONFIG.BOM_STATUS;
  const COL = V11_CONFIG.COLORS;

  addRule(BS.RED, COL.RED);
  addRule(BS.PARTIAL, COL.ORANGE);
  addRule(BS.ORANGE, COL.ORANGE);
  addRule(BS.YELLOW, COL.YELLOW);
  addRule(BS.GREEN, COL.READY);

  sheet.setConditionalFormatRules(rules);
}

/**
 * Фильтр Dashboard (пересоздаётся, чтобы не сбрасывать пользовательский выбор).
 */
function setupDashboardFilter() {
  const sheet = getSheetByKey("DASHBOARD");
  if (sheet.getLastRow() < 2) {
    return;
  }
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  sheet.getRange(1, 1, sheet.getLastRow(), 9).createFilter();
}

/**
 * Получить строку BOM из Dashboard.
 */
function getDashboardBOM(bom) {
  const sheet = getSheetByKey("DASHBOARD");
  const data = readSheetValues(sheet);
  for (let i = 1; i < data.length; i++) {
    if (normalizeMaterialId(data[i][0]) === normalizeMaterialId(bom)) {
      return data[i];
    }
  }
  return null;
}
