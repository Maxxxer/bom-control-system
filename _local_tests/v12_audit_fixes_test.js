/**
 * ЛОКАЛЬНЫЙ регрессионный тест правок аудита №33.
 *
 * Проверяет:
 *   A) C-1/P7 — чекбокс-валидации ВОССТАНАВЛИВАЮТСЯ при каждом полном
 *      пересчёте (в т.ч. на втором подряд при неизменном числе строк), и
 *      clearRange() больше НЕ сбрасывает data-validation;
 *   B) B-1 — статус Dashboard «Ожидание поставки (опаздывает)» достижим, когда
 *      позиция заказана, а ожидаемый приход позже крайнего срока;
 *   C) B-7 — запись истории производится (MATERIAL_HISTORY наполняется).
 *
 * ВАЖНО: файл — Node-скрипт (require/vm), НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_audit_fixes_test.js
 */

const fs = require("fs");
const vm = require("vm");
const sheets = {};

// Журнал вызовов data-validation: { sheet, type: "set"|"clear", row, col, numRows, numCols }.
const dvCalls = [];

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
        clearDataValidations() { dvCalls.push({ sheet: self._name, type: "clear", row: row, col: col, numRows: numRows, numCols: numCols }); return this; },
        setDataValidation() { dvCalls.push({ sheet: self._name, type: "set", row: row, col: col, numRows: numRows, numCols: numCols }); return this; },
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
  + " v12RefreshDeficitSummary: v12RefreshDeficitSummary, v12RefreshPicking: v12RefreshPicking,"
  + " v12AggregateBomStates: v12AggregateBomStates, v12ComputeBomStatus: v12ComputeBomStatus,"
  + " v12SetOrderedQty: v12SetOrderedQty, clearRange: clearRange };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM", "EVENT_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const DS = sheets[C.SHEETS.DEFICIT_SUMMARY];
const PK = sheets[C.SHEETS.PICKING];
const P = C.POSITION_COLUMNS;
const D = C.DEFICIT_COLUMNS;
const K = C.PICKING_COLUMNS;

function mkPosition(code, idx, required, reserved, ordered, expectedDate, deadline) {
  return N.v12BuildPositionRow("BOM1", {
    bomName: "BOM1", row: idx, code: code, name: "M-" + code, model: "M1", unit: "шт",
    requiredQty: required, reservedQty: reserved, deadline: deadline
  }, "BOM1:" + code, 1, { orderedQty: ordered, expectedDate: expectedDate || "" });
}

function resetPositions() {
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
}

function countSets(sheetName, col) {
  return dvCalls.filter(function (c) { return c.type === "set" && c.sheet === sheetName && c.col === col; }).length;
}

// ---------- A) C-1 / P7: валидации восстанавливаются при каждом пересчёте ----------
console.log("=== A: data-validation восстанавливается при повторных пересчётах ===");
resetPositions();
PS._data.push(mkPosition("C1", 1, 10, 3, 0, "", "2026-09-01"));
PS._data.push(mkPosition("C2", 2, 10, 3, 0, "", "2026-09-01"));
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];

dvCalls.length = 0;
N.v12RefreshDeficitSummary();       // 1-й полный пересчёт
const sets1 = countSets(C.SHEETS.DEFICIT_SUMMARY, D.REAL_DELIVERY);
N.v12RefreshDeficitSummary();       // 2-й полный пересчёт (число строк не изменилось)
const sets2 = countSets(C.SHEETS.DEFICIT_SUMMARY, D.REAL_DELIVERY);

check("A1: 1-й пересчёт установил валидацию (>=1)", sets1 >= 1, true);
check("A2: 2-й пересчёт ТОЖЕ установил валидацию (растёт)", sets2 > sets1, true);

// Тот же сценарий для ОТБОРКИ
PK._data = [C.HEADERS.PICKING.slice()];
dvCalls.length = 0;
N.v12RefreshPicking();              // 1-й
const psets1 = countSets(C.SHEETS.PICKING, K.CHECKBOX);
N.v12RefreshPicking();              // 2-й
const psets2 = countSets(C.SHEETS.PICKING, K.CHECKBOX);
check("A3: ОТБОРКА 1-й пересчёт установил валидацию", psets1 >= 1, true);
check("A4: ОТБОРКА 2-й пересчёт ТОЖЕ установил валидацию", psets2 > psets1, true);

// clearRange не должен сбрасывать валидации
dvCalls.length = 0;
N.clearRange(PK, 2, 1, 3, C.COLUMN_COUNT.PICKING);
const clearsFromClearRange = dvCalls.filter(function (c) { return c.type === "clear"; }).length;
check("A5: clearRange НЕ вызывает clearDataValidations", clearsFromClearRange, 0);

// ---------- B) B-1: статус «опаздывает» достижим ----------
console.log("=== B: Dashboard-статус «Ожидание поставки (опаздывает)» ===");
resetPositions();
// Заказано полностью (ordered=10, deficit=10), ожидаемый приход позже крайнего срока.
PS._data.push(mkPosition("C1", 1, 10, 0, 10, "2026-09-10", "2026-09-01"));
const agg = N.v12AggregateBomStates(PS._data);
const bomAgg = agg["BOM1"];
check("B1: late=1 (приход позже срока)", bomAgg.late, 1);
check("B2: статус = WAITING_LATE", N.v12ComputeBomStatus(bomAgg), C.BOM_STATUS.WAITING_LATE);

// Контроль: приход в срок → не late
resetPositions();
PS._data.push(mkPosition("C1", 1, 10, 0, 10, "2026-08-30", "2026-09-01"));
const agg2 = N.v12AggregateBomStates(PS._data);
check("B3: late=0 (приход в срок)", agg2["BOM1"].late, 0);

// ---------- C) B-7: история наполняется ----------
console.log("=== C: запись истории (MATERIAL_HISTORY) ===");
resetPositions();
PS._data.push(mkPosition("C1", 1, 10, 3, 0, "", "2026-09-01"));
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
const MH = sheets[C.SHEETS.MATERIAL_HISTORY];
MH._data = [C.HEADERS.MATERIAL_HISTORY.slice()];
N.v12SetOrderedQty("BOM1:C1", 5);
check("C1: MATERIAL_HISTORY получила строку", MH._data.length, 2);
check("C2: событие = ORDERED_QTY", MH._data[1][C.HISTORY_COLUMNS.EVENT - 1], "ORDERED_QTY");

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
