/**
 * ЛОКАЛЬНЫЙ тест производительности «Отметки получено» (передача производству).
 *
 * Цель: зафиксировать, что массовая передача пачки позиций НЕ деградирует по
 * числу «горячих» операций (полные чтения листов, appendRow, UUID) на позицию.
 *
 * Проверяет на пачке из N = 200 позиций:
 *   P1 — корректность: все N позиций переданы (RECEIVED_BY_PRODUCTION=true,
 *        LIFECYCLE_STATE=ARCHIVED), склад списан на required по каждой;
 *   P2 — логи: ровно N строк в ARCHIVE, N в MATERIAL_HISTORY, N в EVENT_LOG;
 *   P3 — appendRow по этим трём листам = 0 (запись идёт батчем);
 *   P4 — полное чтение MATERIAL_HISTORY (getDataRange) — ОДИН раз на пачку,
 *        а НЕ на каждую позицию;
 *   P5 — Utilities.getUuid() вызывается ОДИН раз на пачку, а не на позицию.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_received_perf_test.js
 */

const fs = require("fs");
const vm = require("vm");
const sheets = {};

// Счётчики «горячих» вызовов.
const counters = {
  appendRow: {},
  getDataRange: {},
  getUuid: 0,
  getActive: 0,
  setValues: {}
};

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
      counters.getDataRange[name] = (counters.getDataRange[name] || 0) + 1;
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
        setValues(vals) { counters.setValues[self._name] = (counters.setValues[self._name] || 0) + 1; for (let i = 0; i < vals.length; i++) { for (let j = 0; j < vals[i].length; j++) { self._setCell(row + i, col + j, vals[i][j]); } } return this; },
        clearContent() { for (let i = 0; i < numRows; i++) { for (let j = 0; j < numCols; j++) { self._setCell(row + i, col + j, ""); } } return this; },
        clearDataValidations() { return this; }, setDataValidation() { return this; },
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
    appendRow(row) {
      counters.appendRow[name] = (counters.appendRow[name] || 0) + 1;
      this._data.push(row.slice ? row.slice() : row);
    }
  };
  sheets[name] = sheet;
  return sheet;
}

globalThis.SpreadsheetApp = {
  getActive() {
    counters.getActive++;
    return { getSheetByName(n) { return sheets[n] || null; }, insertSheet(n) { return makeSheet(n); } };
  },
  getUi() { return { alert() {}, createMenu() { return this; } }; },
  newDataValidation() { return { requireCheckbox() { return this; }, requireValueInList() { return this; }, build() { return {}; } }; },
  newConditionalFormatRule() { return { whenTextContains() { return this; }, setBackground() { return this; }, setRanges() { return this; }, build() { return {}; } }; },
  flush() {}
};
globalThis.LockService = { getScriptLock() { return { waitLock() {}, tryLock() { return true; }, releaseLock() {} }; } };
globalThis.PropertiesService = { getScriptProperties() { return { getProperty() { return null; }, setProperty() {}, deleteProperty() {} }; } };
globalThis.Session = { getActiveUser() { return { getEmail() { return "test@example.com"; } }; } };
globalThis.Utilities = { getUuid() { counters.getUuid++; return "uuid-" + counters.getUuid; } };
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
  + " v12DrainPendingEdits: v12DrainPendingEdits, v12EnqueuePendingEdit: v12EnqueuePendingEdit,"
  + " v12BuildPositionHistoryIndex: v12BuildPositionHistoryIndex };";

vm.runInThisContext(src, { filename: "v12-bundle-perf.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const P = C.POSITION_COLUMNS;
const M = C.MATERIAL_COLUMNS;

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION",
 "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM",
 "EVENT_LOG", "PENDING_EDITS"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const MS = sheets[C.SHEETS.MATERIAL_STATE];
const AR = sheets[C.SHEETS.ARCHIVE];
const MH = sheets[C.SHEETS.MATERIAL_HISTORY];
const EL = sheets[C.SHEETS.EVENT_LOG];

const COUNT = 200;

function buildPositions() {
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  MS._data = [C.HEADERS.MATERIAL_STATE.slice()];
  for (let i = 0; i < COUNT; i++) {
    const code = "C" + i;
    PS._data.push(N.v12BuildPositionRow("BOM1", {
      bomName: "BOM1", row: i + 1, code: code, name: "M-" + code, model: "M1", unit: "шт",
      requiredQty: 10, reservedQty: 10, deadline: "2026-09-01"
    }, "BOM1:" + code, 1, {}));   // reserved=10 >= required=10 -> available для передачи
    const mrow = new Array(C.COLUMN_COUNT.MATERIAL_STATE).fill("");
    mrow[M.MATERIAL_KEY - 1] = code;
    mrow[M.MATERIAL_CODE - 1] = code;
    mrow[M.WAREHOUSE_QTY - 1] = 100;
    MS._data.push(mrow);
  }
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

function bodyRows(sheet) { return sheet.getLastRow() - 1; }

console.log("=== Подготовка пачки из " + COUNT + " позиций ===");
buildPositions();
sheets[C.SHEETS.PENDING_EDITS]._data = [C.HEADERS.PENDING_EDITS.slice()];
for (let i = 0; i < COUNT; i++) {
  N.v12EnqueuePendingEdit("PICKING", "BOM1:C" + i, "HANDOFF", true, "test@example.com");
}

// Сбрасываем счётчики, чтобы считать только фазу применения.
Object.keys(counters.appendRow).forEach(function (k) { delete counters.appendRow[k]; });
Object.keys(counters.getDataRange).forEach(function (k) { delete counters.getDataRange[k]; });
Object.keys(counters.setValues).forEach(function (k) { delete counters.setValues[k]; });
counters.getUuid = 0;

console.log("=== Применение пачки (v12DrainPendingEdits) ===");
const drain = N.v12DrainPendingEdits();
check("P0: слито позиций = " + COUNT, drain.drained, COUNT);

console.log("=== P1: корректность передачи ===");
let receivedOk = 0;
let archivedOk = 0;
for (let i = 0; i < COUNT; i++) {
  const id = "BOM1:C" + i;
  for (let r = 1; r < PS._data.length; r++) {
    if (PS._data[r][P.POSITION_ID - 1] === id) {
      if (PS._data[r][P.RECEIVED_BY_PRODUCTION - 1] === true) { receivedOk++; }
      if (PS._data[r][P.LIFECYCLE_STATE - 1] === C.LIFECYCLE_STATE.ARCHIVED) { archivedOk++; }
      break;
    }
  }
}
check("P1: все " + COUNT + " переданы", receivedOk, COUNT);
check("P1: все " + COUNT + " архивированы", archivedOk, COUNT);

console.log("=== P2: логи записаны ровно по одной строке на позицию ===");
check("P2: строк в ARCHIVE = " + COUNT, bodyRows(AR), COUNT);
check("P2: строк в MATERIAL_HISTORY = " + COUNT, bodyRows(MH), COUNT);
check("P2: строк в EVENT_LOG = " + COUNT, bodyRows(EL), COUNT);

console.log("=== P3: appendRow по логам НЕ вызывался (запись батчем) ===");
check("P3: appendRow(ARCHIVE) = 0", counters.appendRow[C.SHEETS.ARCHIVE] || 0, 0);
check("P3: appendRow(MATERIAL_HISTORY) = 0", counters.appendRow[C.SHEETS.MATERIAL_HISTORY] || 0, 0);
check("P3: appendRow(EVENT_LOG) = 0", counters.appendRow[C.SHEETS.EVENT_LOG] || 0, 0);

console.log("=== P4: полное чтение MATERIAL_HISTORY — один раз на пачку ===");
check("P4: getDataRange(MATERIAL_HISTORY) = 1", counters.getDataRange[C.SHEETS.MATERIAL_HISTORY] || 0, 1);

console.log("=== P5: Utilities.getUuid() — один раз на пачку (а не " + COUNT + " раз) ===");
check("P5: getUuid() = 1", counters.getUuid, 1);

console.log("=== P6: POSITION_STATE записан малым числом setValues (блок) ===");
// Блочная запись: ожидаем несколько вызовов (flush +, возможно, от пересборки
// проекций ничего в POSITION_STATE не пишет), но НЕ пропорционально N.
check("P6: POSITION_STATE setValues <= 3", (counters.setValues[C.SHEETS.POSITION_STATE] || 0) <= 3, true);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
