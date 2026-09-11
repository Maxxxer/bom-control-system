/**
 * ЛОКАЛЬНЫЙ регрессионный тест ВТОРОЙ волны правок аудита №33.
 *
 * Проверяет:
 *   A) B-12 — toNumber корректно разбирает разделители тысяч/дробей
 *      («1,234.56» -> 1234.56, «1.234,56» -> 1234.56, «1,5» -> 1.5);
 *   B) C-4 — v12RevertEdit восстанавливает одиночную ячейку по oldValue и
 *      НЕ молчит на диапазоне (пишет WARNING, не бросает);
 *   C) P-7 — v12RefreshProjections читает POSITION_STATE ОДИН раз, когда
 *      harvest ничего не исправляет (раньше читалось дважды).
 *
 * ВАЖНО: файл — Node-скрипт (require/vm), НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_audit_fixes2_test.js
 */

const fs = require("fs");
const vm = require("vm");
const sheets = {};

// Счётчик полных чтений листов (getDataRange().getValues()).
const readCalls = [];

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
    getDataRange() {
      readCalls.push(this._name);
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
        getA1Notation() { return "R" + row + "C" + col; },
        getValue() { const r = self._data[row - 1]; return r ? (r[col - 1] === undefined || r[col - 1] === null ? "" : r[col - 1]) : ""; },
        getValues() { const out = []; for (let i = 0; i < numRows; i++) { const s = self._data[row - 1 + i] || [], rr = []; for (let j = 0; j < numCols; j++) { const v = s[col - 1 + j]; rr.push(v === undefined || v === null ? "" : v); } out.push(rr); } return out; },
        setValue(v) { self._setCell(row, col, v); return this; },
        setValues(vals) { for (let i = 0; i < vals.length; i++) { for (let j = 0; j < vals[i].length; j++) { self._setCell(row + i, col + j, vals[i][j]); } } return this; },
        clearContent() { for (let i = 0; i < numRows; i++) { for (let j = 0; j < numCols; j++) { self._setCell(row + i, col + j, ""); } } return this; },
        clearDataValidations() { return this; },
        setDataValidation() { return this; },
        setBackgrounds() { return this; }, setBackground() { return this; }, setFontWeight() { return this; }, setNotes() { return this; }
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

const logEntries = [];
// Повторяем нормализацию реального logSystem: если 3-й аргумент —
// строка-уровень ("INFO"/"ERROR"/"WARNING"/...), он трактуется как уровень.
const LOG_LEVEL_NAMES = { INFO: true, ERROR: true, WARNING: true, WARN: true, DEBUG: true };
globalThis.logSystem = function (fn, message, data, level) {
  if (typeof data === "string" && Object.prototype.hasOwnProperty.call(LOG_LEVEL_NAMES, data)) {
    level = data;
    data = "";
  }
  logEntries.push({ fn: fn, message: message, level: level || "INFO" });
};
globalThis.flushSystemLog = function () {};

const files = [
  "v12_config.js", "utils.js", "sheet_service.js", "v12_utils.js", "v12_calculate.js",
  "v12_position_state.js", "v12_material_state.js", "v12_audit.js", "v12_roles.js",
  "v12_source.js", "v12_sheet_service.js", "v12_projections.js", "v12_operations.js",
  "v12_handoff.js", "v12_change_engine.js", "v12_events.js", "lock.js", "v12_trigger.js"
];

const src = files.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n")
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, toNumber: toNumber, v12RevertEdit: v12RevertEdit,"
  + " v12RefreshProjections: v12RefreshProjections, v12BuildPositionRow: v12BuildPositionRow };";

vm.runInThisContext(src, { filename: "v12-bundle2.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

// ---------- A) B-12: toNumber ----------
console.log("=== A: toNumber — разделители (B-12) ===");
check("A1: «1,234.56» -> 1234.56", N.toNumber("1,234.56"), 1234.56);
check("A2: «1.234,56» -> 1234.56", N.toNumber("1.234,56"), 1234.56);
check("A3: «1,5» -> 1.5", N.toNumber("1,5"), 1.5);
check("A4: «1.5» -> 1.5", N.toNumber("1.5"), 1.5);
check("A5: «1 234» -> 1234", N.toNumber("1 234"), 1234);
check("A6: «1.234.567» -> 1234567", N.toNumber("1.234.567"), 1234567);
check("A7: «1,234,567» -> 1234567", N.toNumber("1,234,567"), 1234567);
check("A8: true -> 1", N.toNumber(true), 1);
check("A9: false -> 0", N.toNumber(false), 0);
check("A10: «abc» -> 0", N.toNumber("abc"), 0);

// ---------- B) C-4: v12RevertEdit ----------
console.log("=== B: v12RevertEdit (C-4) ===");
["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM", "EVENT_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const single = sheets[C.SHEETS.DEFICIT_SUMMARY].getRange(2, 9);
single.setValue(42);
logEntries.length = 0;
N.v12RevertEdit({ range: single, oldValue: 7 });
check("B1: одиночная ячейка восстановлена по oldValue", single.getValue(), 7);
check("B2: без предупреждений", logEntries.length, 0);

// Диапазон без oldValue — не должно бросать и должно залогировать WARNING.
const rangeSheet = sheets[C.SHEETS.PICKING];
const multiRange = rangeSheet.getRange(2, 12, 3, 1);
logEntries.length = 0;
let threw = false;
try { N.v12RevertEdit({ range: multiRange }); } catch (err) { threw = true; }
check("B3: диапазон без oldValue не бросает исключение", threw, false);
check("B4: диапазон без oldValue залогирован (WARNING)", logEntries.length >= 1, true);
check("B5: уровень лога = WARNING", logEntries.length ? logEntries[0].level : "", "WARNING");

// ---------- C) P-7: одно чтение POSITION_STATE на пересчёт ----------
console.log("=== C: POSITION_STATE читается один раз (P-7) ===");
// Чистое состояние: в сводке/отборке только шапки -> harvest ничего не делает.
PS._data = [C.HEADERS.POSITION_STATE.slice()];
PS._data.push(N.v12BuildPositionRow("BOM1", {
  bomName: "BOM1", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
  requiredQty: 10, reservedQty: 3, deadline: "2026-09-01"
}, "BOM1:C1", 1, { orderedQty: 0, expectedDate: "" }));
sheets[C.SHEETS.DEFICIT_SUMMARY]._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
sheets[C.SHEETS.PICKING]._data = [C.HEADERS.PICKING.slice()];

readCalls.length = 0;
N.v12RefreshProjections();
const posReads = readCalls.filter(function (n) { return n === C.SHEETS.POSITION_STATE; }).length;
check("C1: POSITION_STATE прочитан ровно 1 раз", posReads, 1);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
