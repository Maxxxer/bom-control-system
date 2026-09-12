/**
 * =====================================================
 * BOM CONTROL SYSTEM
 *
 * FILE: sheet_service.js
 *
 * Общие обёртки над SpreadsheetApp — базовый сервис.
 * Все обращения к листам — только через этот сервис.
 * =====================================================
 */

/**
 * Активная таблица — ОДНА на запуск.
 *
 * SpreadsheetApp.getActive() — дорогой RPC. Раньше он вызывался на каждый
 * getSheetByName (т.е. десятки раз на одну операцию). Кэшируем ссылку: в рамках
 * одного запуска скрипта активная таблица неизменна.
 */
let _v12CachedSpreadsheet = null;
function v12ActiveSpreadsheet() {
  if (!_v12CachedSpreadsheet) {
    _v12CachedSpreadsheet = SpreadsheetApp.getActive();
  }
  return _v12CachedSpreadsheet;
}

/**
 * Получить лист по имени.
 *
 * Объект активной таблицы берётся из кэша (v12ActiveSpreadsheet) — именно
 * SpreadsheetApp.getActive() был дорогим вызовом. Кэшировать САМИ листы по
 * имени нельзя: лист может быть пересоздан под тем же именем (insertSheet при
 * установке/миграции схемы), и кэш «залипал» бы на устаревшем объекте. Поэтому
 * getSheetByName всегда возвращает актуальный лист активной таблицы.
 */
function getSheetByName(sheetName) {
  if (!sheetName) {
    return null;
  }
  return v12ActiveSpreadsheet().getSheetByName(sheetName);
}

/**
 * Прочитать весь диапазон листа как матрицу.
 */
function readSheetValues(sheet) {
  if (!sheet) {
    return [];
  }
  return sheet.getDataRange().getValues();
}

/**
 * Записать массив значений.
 */
function writeValues(sheet, row, col, values) {
  if (!values || !values.length) {
    return;
  }
  sheet.getRange(row, col, values.length, values[0].length).setValues(values);
}

/**
 * Очистить содержимое диапазона.
 *
 * ВАЖНО: data-validation НЕ сбрасывается здесь. Ранее `clearDataValidations()`
 * вызывался на каждом пересчёте (`clearBody` → `clearRange`) и стирал все
 * валидации тела листа, из-за чего чекбоксы «Реальная поставка»/«Отметка
 * получено» терялись, если проекция не переустанавливала их. Теперь каждый
 * владелец валидации (v12Install*Checkboxes / v12InstallPickingBomFilter)
 * управляет ею сам и очищает свою колонку на всю высоту листа.
 */
function clearRange(sheet, row, col, numRows, numCols) {
  if (numRows <= 0 || numCols <= 0) {
    return;
  }
  const range = sheet.getRange(row, col, numRows, numCols);
  range.clearContent();
}

/**
 * Очистить тело листа (ниже заголовка), оставив первую строку.
 */
function clearBody(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    clearRange(sheet, 2, 1, lastRow - 1, sheet.getLastColumn());
  }
}

/**
 * Добавить строку.
 */
function appendRow(sheet, row) {
  sheet.appendRow(row);
}

/**
 * Создать лист, если нет; записать заголовки, если пуст.
 */
function ensureSheet(name, headers) {
  const ss = v12ActiveSpreadsheet();
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
 * Батч-обновление ячеек одного листа.
 *
 * changes: [{row, col, value}]
 * Группирует по строкам и для каждой строки пишет непрерывные
 * отрезки колонок через Range.setValues — это сокращает число
 * вызовов SpreadsheetApp по сравнению с записью каждой ячейки.
 * Промежуточные колонки НЕ затираются (пишем только отрезки).
 */
function batchWrite(sheet, changes) {
  if (!changes || changes.length === 0) {
    return;
  }
  const byRow = {};
  changes.forEach((c) => {
    if (!byRow[c.row]) {
      byRow[c.row] = {};
    }
    byRow[c.row][c.col] = c.value;
  });

  Object.keys(byRow).forEach((rowStr) => {
    const row = Number(rowStr);
    const cols = Object.keys(byRow[rowStr])
      .map(Number)
      .sort(function (a, b) { return a - b; });

    let runStart = cols[0];
    let runEnd = cols[0];
    const runs = [];
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] === runEnd + 1) {
        runEnd = cols[i];
      } else {
        runs.push([runStart, runEnd]);
        runStart = cols[i];
        runEnd = cols[i];
      }
    }
    runs.push([runStart, runEnd]);

    runs.forEach((run) => {
      const cStart = run[0];
      const cEnd = run[1];
      const values = [];
      for (let col = cStart; col <= cEnd; col++) {
        values.push(byRow[rowStr][col] !== undefined ? byRow[rowStr][col] : "");
      }
      sheet.getRange(row, cStart, 1, values.length).setValues([values]);
    });
  });
}

/**
 * БЛОЧНАЯ запись ячеек одного листа: одна getValues + одна setValues на весь
 * диапазон затронутых строк (вместо записи «отрезков» по каждой строке).
 *
 * Для «плотных» пакетных операций (массовая передача производству, где за раз
 * меняются сотни смежных строк POSITION_STATE) это сокращает число вызовов
 * SpreadsheetApp с O(строк × отрезков) до 2 вызовов на всю пачку.
 *
 * changes: [{row, col, value}] — как в batchWrite. Значения merge-ятся в
 * прочитанный блок (промежуточные/чужие колонки сохраняются), затем блок
 * пишется одной setValues.
 */
function batchWriteBlock(sheet, changes) {
  if (!changes || changes.length === 0) {
    return;
  }
  const byRow = {};
  let minRow = Infinity;
  let maxRow = -Infinity;
  let maxCol = 0;
  changes.forEach((c) => {
    if (!byRow[c.row]) {
      byRow[c.row] = {};
    }
    byRow[c.row][c.col] = c.value;
    if (c.row < minRow) { minRow = c.row; }
    if (c.row > maxRow) { maxRow = c.row; }
    if (c.col > maxCol) { maxCol = c.col; }
  });

  const numRows = maxRow - minRow + 1;
  const block = sheet.getRange(minRow, 1, numRows, maxCol).getValues();
  Object.keys(byRow).forEach((rowStr) => {
    const rel = Number(rowStr) - minRow;
    const cols = byRow[rowStr];
    Object.keys(cols).forEach((colStr) => {
      block[rel][Number(colStr) - 1] = cols[colStr];
    });
  });
  sheet.getRange(minRow, 1, numRows, maxCol).setValues(block);
}
