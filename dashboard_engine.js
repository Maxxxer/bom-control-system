/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: dashboard_engine.js
 *
 * Dashboard: обновление, чекбокс «Выполнено», hover-подсказки
 * (ноты с недостающими позициями), условное форматирование, фильтр.
 * =====================================================
 */

/**
 * Обновление дашборда.
 */
function updateDashboard() {
  const source = getSheetByKey("BOM_STATE");
  const dashboard = getSheetByKey("DASHBOARD");
  let cache = getBOMStateCache();

  // Если кэш пуст (например, дашборд вызван из меню отдельно) — пересчитать
  if (!cache || Object.keys(cache).length === 0) {
    recalculateBOMState();
    cache = getBOMStateCache();
  }

  const data = readSheetValues(source);

  clearBody(dashboard);

  if (data.length <= 1) {
    logSystem("updateDashboard", "Нет данных BOM", "INFO");
    return;
  }

  const rows = data.slice(1).map(function (r) {
    const bom = r[0];
    const cached = cache[bom] || {};
    return [
      isBOMDone(bom),                    // 1 DONE (чекбокс)
      bom,                               // 2 BOM
      r[8] || "",                        // 3 STATUS
      r[2] || "",                        // 4 DATE_CREATED
      r[3] || "",                        // 5 TOTAL_MATERIALS
      r[4] || "",                        // 6 DEFICIT
      r[5] || "",                        // 7 NOT_ORDERED
      r[6] || "",                        // 8 LAST_DELIVERY
      r[7] || "",                        // 9 DEADLINE
      r[9] || "",                        // 10 READY
      cached.missingItems || ""          // 11 MISSING_ITEMS
    ];
  });

  writeValues(dashboard, 2, 1, rows);

  // Чекбоксы «Выполнено» в колонке 1
  dashboard.getRange(2, V11_CONFIG.DASHBOARD_COLUMNS.DONE, rows.length, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  // Hover-подсказки (ноты) на статус (колонка 3) — недостающие позиции
  rows.forEach(function (r, i) {
    const cell = dashboard.getRange(i + 2, V11_CONFIG.DASHBOARD_COLUMNS.STATUS);
    const note = r[10] ? "Недостающие позиции:\n" + r[10] : "";
    cell.setNote(note);
  });

  applyDashboardColors();
  dashboard.autoResizeColumns(1, 11);
  setupDashboardFilter();

  logSystem("updateDashboard", "Dashboard обновлён: " + rows.length, "INFO");
}

/**
 * Условное форматирование статусной колонки (C) по фактическим строкам BOM_STATUS.
 */
function applyDashboardColors() {
  const sheet = getSheetByKey("DASHBOARD");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  const range = sheet.getRange(2, V11_CONFIG.DASHBOARD_COLUMNS.STATUS, lastRow - 1, 1);
  const rules = [];

  const addRule = function (text, color) {
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

  addRule(BS.NOT_PROCESSED, COL.RED);
  addRule(BS.PARTIAL_SELECTED, COL.ORANGE);
  addRule(BS.WAITING_ON_TIME, COL.YELLOW);
  addRule(BS.WAITING_LATE, COL.ORANGE);
  addRule(BS.READY, COL.READY);
  addRule(BS.ERROR, COL.GRAY);

  sheet.setConditionalFormatRules(rules);
}

/**
 * Фильтр Dashboard.
 */
function setupDashboardFilter() {
  const sheet = getSheetByKey("DASHBOARD");
  if (sheet.getLastRow() < 2) {
    return;
  }
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  sheet.getRange(1, 1, sheet.getLastRow(), V11_CONFIG.COLUMN_COUNT.DASHBOARD).createFilter();
}

/**
 * Получить строку BOM из Dashboard.
 */
function getDashboardBOM(bom) {
  const sheet = getSheetByKey("DASHBOARD");
  const data = readSheetValues(sheet);
  for (let i = 1; i < data.length; i++) {
    if (normalizeMaterialId(data[i][V11_CONFIG.DASHBOARD_COLUMNS.BOM - 1]) === normalizeMaterialId(bom)) {
      return data[i];
    }
  }
  return null;
}
