/**
 * ЛОКАЛЬНЫЙ тест автофильтра листа «Сводка дефицитов» (DEFICIT_SUMMARY).
 *
 * Проверяет сортировку по столбцам через встроенный автофильтр Sheets:
 *   - конфиг: доступные для сортировки столбцы «Наименование» (5), «Модель» (6),
 *     «Ожидаемая поставка» (10), «Крайний срок» (11) входят в диапазон фильтра
 *     (1..COLUMN_COUNT.DEFICIT_SUMMARY);
 *   - v12RefreshDeficitSummary() создаёт автофильтр на строку заголовков + строки
 *     данных, колонки 1..14;
 *   - повторный пересчёт с тем же числом строк НЕ пересоздаёт фильтр
 *     (не сбрасываем пользовательскую сортировку/фильтр);
 *   - при изменении числа строк диапазон фильтра пересоздаётся;
 *   - v12FormatDeficitSheet() обеспечивает фильтр при инициализации (установке);
 *   - окружение без поддержки фильтров (нет getFilter) не приводит к падению.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script.
 * Запуск из корня проекта: node _local_tests/v12_deficit_filter_test.js
 */

const fs = require("fs");
const vm = require("vm");
const sheets = {};

function makeSheet(name, header) {
  const data = [];
  if (header) { data.push(header.slice()); }
  const sheet = {
    _name: name, _data: data,
    getName() { return this._name; },
    getLastRow() {
      let last = 0;
      for (let r = 0; r < this._data.length; r++) { const row = this._data[r] || []; for (let c = 0; c < row.length; c++) { const v = row[c]; if (v !== "" && v !== null && v !== undefined) { last = r + 1; break; } } }
      return last;
    },
    getLastColumn() {
      let last = 0;
      for (let r = 0; r < this._data.length; r++) { const row = this._data[r] || []; for (let c = 0; c < row.length; c++) { const v = row[c]; if (v !== "" && v !== null && v !== undefined) { if (c + 1 > last) { last = c + 1; } } } }
      return last;
    },
    getMaxRows() { return 1000; },
    getFilter() { return this._filter || null; },
    getDataRange() {
      const lastRow = this.getLastRow(), lastCol = this.getLastColumn(), src = this._data, out = [];
      for (let r = 0; r < lastRow; r++) { const row = src[r] || [], rr = []; for (let c = 0; c < lastCol; c++) { const v = row[c]; rr.push(v === undefined || v === null ? "" : v); } out.push(rr); }
      return { getValues() { return out; } };
    },
    getRange(row, col, numRows, numCols) {
      numRows = numRows || 1; numCols = numCols || 1;
      const self = this;
      return {
        getSheet() { return self; }, getRow() { return row; }, getColumn() { return col; },
        getNumRows() { return numRows; }, getNumColumns() { return numCols; },
        getValue() { const r = self._data[row - 1]; return r ? (r[col - 1] === undefined || r[col - 1] === null ? "" : r[col - 1]) : ""; },
        getValues() { const out = []; for (let i = 0; i < numRows; i++) { const s = self._data[row - 1 + i] || [], rr = []; for (let j = 0; j < numCols; j++) { const v = s[col - 1 + j]; rr.push(v === undefined || v === null ? "" : v); } out.push(rr); } return out; },
        setValue(v) { self._setCell(row, col, v); return this; },
        setValues(vals) { for (let i = 0; i < vals.length; i++) { for (let j = 0; j < vals[i].length; j++) { self._setCell(row + i, col + j, vals[i][j]); } } return this; },
        clearContent() { for (let i = 0; i < numRows; i++) { for (let j = 0; j < numCols; j++) { self._setCell(row + i, col + j, ""); } } return this; },
        clearDataValidations() { return this; }, setDataValidation() { return this; },
        setBackgrounds() { return this; }, setBackground() { return this; }, setFontWeight() { return this; }, setNotes() { return this; },
        setWrapStrategy() { return this; }, setHorizontalAlignment() { return this; }, setVerticalAlignment() { return this; },
        createFilter() {
          const filter = {
            getRange() {
              return {
                getRow() { return row; }, getColumn() { return col; },
                getLastRow() { return row + numRows - 1; }, getLastColumn() { return col + numCols - 1; }
              };
            },
            remove() { self._filter = null; globalThis.__filterRemoveCalls = (globalThis.__filterRemoveCalls || 0) + 1; }
          };
          self._filter = filter;
          globalThis.__filterCreateCalls = (globalThis.__filterCreateCalls || 0) + 1;
          return filter;
        }
      };
    },
    _setCell(r, c, v) {
      const ri = r - 1, ci = c - 1;
      while (this._data.length <= ri) { this._data.push([]); }
      const rowArr = this._data[ri];
      while (rowArr.length <= ci) { rowArr.push(""); }
      rowArr[ci] = v;
    },
    setFrozenRows() {}, insertSheet() {}, setConditionalFormatRules() {}, getConditionalFormatRules() { return []; },
    appendRow(row) { this._data.push(row.slice ? row.slice() : row); }
  };
  sheets[name] = sheet;
  return sheet;
}

globalThis.SpreadsheetApp = {
  WrapStrategy: { WRAP: "WRAP", OVERFLOW: "OVERFLOW" },
  getActive() { return { getSheetByName(n) { return sheets[n] || null; }, insertSheet(n) { return makeSheet(n); } }; },
  getUi() { return { alert() {}, createMenu() { return this; } }; },
  newDataValidation() { return { requireCheckbox() { return this; }, requireValueInList() { return this; }, build() { return {}; } }; },
  newConditionalFormatRule() { return { whenTextContains() { return this; }, setBackground() { return this; }, setRanges() { return this; }, build() { return {}; } }; },
  flush() {}
};
globalThis.LockService = { getScriptLock() { return { waitLock() {}, tryLock() { return true; }, releaseLock() {} }; } };
globalThis.PropertiesService = { getScriptProperties() { return { getProperty() { return null; }, setProperty() {}, deleteProperty() {} }; } };
globalThis.Session = { getActiveUser() { return { getEmail() { return "test@example.com"; } }; } };
globalThis.Utilities = { getUuid() { return "uuid-" + Math.random().toString(16).slice(2); } };
globalThis.logSystem = function () {};
globalThis.flushSystemLog = function () {};

const files = [
  "v12_config.js", "utils.js", "sheet_service.js", "v12_utils.js", "v12_calculate.js",
  "v12_position_state.js", "v12_material_state.js", "v12_audit.js", "v12_roles.js",
  "v12_source.js", "v12_sheet_service.js", "v12_projections.js", "v12_operations.js",
  "v12_handoff.js", "v12_change_engine.js", "v12_events.js", "lock.js", "v12_trigger.js",
  "v12_queue.js"
];

const src = files.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n")
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, v12BuildPositionRow: v12BuildPositionRow,"
  + " v12RefreshDeficitSummary: v12RefreshDeficitSummary, v12EnsureDeficitFilter: v12EnsureDeficitFilter,"
  + " v12EnsureTableFilter: v12EnsureTableFilter, v12FormatDeficitSheet: v12FormatDeficitSheet };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const D = C.DEFICIT_COLUMNS;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION",
 "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "WORKING_BOM", "PICKING", "EVENT_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const DS = sheets[C.SHEETS.DEFICIT_SUMMARY];

function mkPosition(code, idx, required, reserved, deadline) {
  return N.v12BuildPositionRow("BOM1", {
    bomName: "BOM1", row: idx, code: code, name: "M-" + code, model: "Model-" + code, unit: "шт",
    requiredQty: required, reservedQty: reserved, deadline: deadline || "2026-09-30"
  }, "BOM1:" + code, 1, {});
}

function setPositions(list) {
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  list.forEach(function (p, i) { PS._data.push(mkPosition(p.code, i + 1, p.required, p.reserved, p.deadline)); });
}

console.log("=== F1: сортируемые столбцы входят в диапазон фильтра ===");
check("DEFICIT_COLUMNS.MATERIAL_NAME = 5 (Наименование)", D.MATERIAL_NAME, 5);
check("DEFICIT_COLUMNS.MODEL = 6 (Модель)", D.MODEL, 6);
check("DEFICIT_COLUMNS.EXPECTED_DATE = 10 (Ожидаемая поставка)", D.EXPECTED_DATE, 10);
check("DEFICIT_COLUMNS.DEADLINE = 11 (Крайний срок)", D.DEADLINE, 11);
check("ширина таблицы (COLUMN_COUNT.DEFICIT_SUMMARY) покрывает все 4 столбца",
  C.COLUMN_COUNT.DEFICIT_SUMMARY >= D.DEADLINE, true);

console.log("=== F2: v12RefreshDeficitSummary создаёт автофильтр ===");
{
  DS._filter = null;
  setPositions([
    { code: "C1", required: 10, reserved: 0, deadline: "2026-09-30" },
    { code: "C2", required: 5, reserved: 0, deadline: "2026-09-20" }
  ]);
  globalThis.__filterCreateCalls = 0;
  globalThis.__filterRemoveCalls = 0;

  N.v12RefreshDeficitSummary();

  const f = DS.getFilter();
  check("автофильтр создан", f !== null, true);
  check("диапазон начинается со строки 1, кол. 1",
    f.getRange().getRow() === 1 && f.getRange().getColumn() === 1, true);
  check("последняя строка диапазона = 1 + 2 = 3", f.getRange().getLastRow(), 3);
  check("последняя колонка диапазона = 14", f.getRange().getLastColumn(), C.COLUMN_COUNT.DEFICIT_SUMMARY);
  check("createFilter вызван 1 раз", globalThis.__filterCreateCalls, 1);

  // Повторный пересчёт с тем же числом строк — фильтр НЕ пересоздаётся
  // (не сбрасываем пользовательскую сортировку/фильтр).
  N.v12RefreshDeficitSummary();
  check("повторный пересчёт не пересоздаёт фильтр", globalThis.__filterCreateCalls, 1);
  check("фильтр не удалялся", globalThis.__filterRemoveCalls, 0);
}

console.log("=== F3: диапазон фильтра расширяется при добавлении строки ===");
{
  setPositions([
    { code: "C1", required: 10, reserved: 0, deadline: "2026-09-30" },
    { code: "C2", required: 5, reserved: 0, deadline: "2026-09-20" },
    { code: "C3", required: 7, reserved: 0, deadline: "2026-10-01" }
  ]);
  N.v12RefreshDeficitSummary();   // 3 строки -> диапазон 1..4
  check("фильтр пересоздан под новый диапазон", globalThis.__filterCreateCalls, 2);
  check("старый фильтр удалён", globalThis.__filterRemoveCalls, 1);
  check("новая последняя строка = 4", DS.getFilter().getRange().getLastRow(), 4);
}

console.log("=== F4: диапазон фильтра сужается при выпадении строки ===");
{
  setPositions([
    { code: "C1", required: 10, reserved: 0, deadline: "2026-09-30" }
  ]);
  N.v12RefreshDeficitSummary();   // 1 строка -> диапазон 1..2
  check("фильтр пересоздан (сужение)", globalThis.__filterCreateCalls, 3);
  check("новая последняя строка = 2", DS.getFilter().getRange().getLastRow(), 2);
}

console.log("=== F5: v12FormatDeficitSheet обеспечивает фильтр при инициализации ===");
{
  makeSheet(C.SHEETS.DEFICIT_SUMMARY, C.HEADERS.DEFICIT_SUMMARY);   // пустой лист (только шапка)
  globalThis.__filterCreateCalls = 0;
  N.v12FormatDeficitSheet();
  const f = sheets[C.SHEETS.DEFICIT_SUMMARY].getFilter();
  check("фильтр создан на пустом листе", f !== null, true);
  check("минимальный диапазон (шапка + 1) последняя строка = 2", f.getRange().getLastRow(), 2);
}

console.log("=== F6: окружение без поддержки фильтров не падает ===");
{
  makeSheet(C.SHEETS.DEFICIT_SUMMARY, C.HEADERS.DEFICIT_SUMMARY);
  const noFilterSheet = sheets[C.SHEETS.DEFICIT_SUMMARY];
  noFilterSheet.getFilter = undefined;   // симуляция окружения без автофильтра
  let threw = false;
  try {
    N.v12RefreshDeficitSummary();
    N.v12FormatDeficitSheet();
  } catch (e) {
    threw = true;
  }
  check("нет getFilter -> без исключения", threw, false);
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
