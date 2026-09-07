/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: sheet_service.js
 *
 * Обёртки над SpreadsheetApp.
 * Все обращения к листам — только через этот сервис.
 * =====================================================
 */

/**
 * Получить активную таблицу
 */
function getActiveSpreadsheet() {
  return SpreadsheetApp.getActive();
}

/**
 * Получить лист по имени из конфига
 */
function getSheetByName(sheetName) {
  if (!sheetName) {
    return null;
  }
  return SpreadsheetApp.getActive().getSheetByName(sheetName);
}

function getSheetByKey(key) {
  const name = V11_CONFIG.SHEETS[key];
  if (!name) {
    throw new Error("Нет листа с ключом: " + key);
  }
  const sheet = getSheetByName(name);
  if (!sheet) {
    throw new Error("Лист не найден: " + name);
  }
  return sheet;
}

/**
 * Прочитать весь диапазон листа как матрицу
 */
function readSheetValues(sheet) {
  if (!sheet) {
    return [];
  }
  return sheet.getDataRange().getValues();
}

function readSheetByKey(key) {
  return readSheetValues(getSheetByKey(key));
}

/**
 * Прочитать диапазон
 */
function readRange(sheet, row, col, numRows, numCols) {
  return sheet.getRange(row, col, numRows, numCols).getValues();
}

/**
 * Записать массив значений
 */
function writeValues(sheet, row, col, values) {
  if (!values || !values.length) {
    return;
  }
  sheet.getRange(row, col, values.length, values[0].length).setValues(values);
}

/**
 * Очистить содержимое диапазона
 */
function clearRange(sheet, row, col, numRows, numCols) {
  if (numRows <= 0 || numCols <= 0) {
    return;
  }
  sheet.getRange(row, col, numRows, numCols).clearContent();
}

/**
 * Очистить тело листа (ниже заголовка), оставив первую строку
 */
function clearBody(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    clearRange(sheet, 2, 1, lastRow - 1, sheet.getLastColumn());
  }
}

/**
 * Добавить строку
 */
function appendRow(sheet, row) {
  sheet.appendRow(row);
}

/**
 * Создать лист, если нет; записать заголовки, если пуст
 */
function ensureSheet(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sheet;
}

/**
 * Создать все листы из конфига
 */
function ensureAllSheets() {
  const headers = V11_CONFIG.HEADERS;
  Object.keys(V11_CONFIG.SHEETS).forEach((key) => {
    const name = V11_CONFIG.SHEETS[key];
    const header = headers[key] || [];
    ensureSheet(name, header);
  });
}

/**
 * Форматировать все листы: закрепить шапку, жирный заголовок
 */
function formatAllSheets() {
  Object.values(V11_CONFIG.SHEETS).forEach((name) => {
    const sheet = getSheetByName(name);
    if (sheet) {
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold");
    }
  });
}

/**
 * Батч-обновление ячеек одного листа.
 *
 * changes: [{row, col, value}]
 * Группирует по (row, col) и пишет один раз через RangeList.
 */
function batchWrite(sheet, changes) {
  if (!changes || changes.length === 0) {
    return;
  }
  const rangeList = changes.map((c) => sheet.getRange(c.row, c.col));
  rangeList.setValues(changes.map((c) => [c.value]));
}

/**
 * Unlock helper — снять возможные блокировки (не используется в проде)
 */
function flushSheets() {
  SpreadsheetApp.flush();
}
