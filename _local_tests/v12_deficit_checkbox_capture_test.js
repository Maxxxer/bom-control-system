/**
 * ЛОКАЛЬНЫЙ тест дефекта «выделил несколько чекбоксов + пробел → в очереди
 * только ОДНА позиция» и его исправления (Вариант A: пересборка по факту).
 *
 * Причина дефекта: массовое переключение чекбоксов «пробелом» Google отдаёт
 * ОДНИМ событием `onEdit` с «одиночной» формой диапазона, поэтому захват
 * (v12CaptureCheckboxEdit / v12CaptureDeficitEdit) по форме события видел одну
 * строку. Исправление: после захвата очередь пересобирается по ФАКТИЧЕСКИМ
 * галочкам (v12ReconcilePendingHandoffs → v12RebuildPendingFromChecked) — теперь
 * и для REAL_DELIVERY «Реальная поставка» Сводки дефицитов.
 *
 * Проверяется:
 *   D1 — массовая отметка «Реальная поставка»: событие приходит ОДНОЙ ячейкой,
 *        а в очереди оказываются ВСЕ реально отмеченные позиции;
 *   D2 — пересборка идемпотентна (повторное событие не плодит дубли);
 *   D3 — берутся только реально отмеченные (не вся колонка);
 *   D4 — типизированное намерение (ORDERED_QTY) пересборкой не трогается;
 *   D5 — HANDOFF (ОТБОРКА) по-прежнему восстанавливается (регресс-страховка);
 *   D6 — смешанный случай: HANDOFF + REAL_DELIVERY в одной пересборке.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_deficit_checkbox_capture_test.js
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
        getA1Notation() { return "R" + row + "C" + col; },
        getValue() { const r = self._data[row - 1]; return r ? (r[col - 1] === undefined || r[col - 1] === null ? "" : r[col - 1]) : ""; },
        getValues() { const out = []; for (let i = 0; i < numRows; i++) { const s = self._data[row - 1 + i] || [], rr = []; for (let j = 0; j < numCols; j++) { const v = s[col - 1 + j]; rr.push(v === undefined || v === null ? "" : v); } out.push(rr); } return out; },
        setValue(v) { self._setCell(row, col, v); return this; },
        setValues(vals) { for (let i = 0; i < vals.length; i++) { for (let j = 0; j < vals[i].length; j++) { self._setCell(row + i, col + j, vals[i][j]); } } return this; },
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
    appendRow(row) { this._data.push(row.slice ? row.slice() : row); }
  };
  sheets[name] = sheet;
  return sheet;
}

globalThis.__lockBusy = false;

globalThis.SpreadsheetApp = {
  getActive() { return { getSheetByName(n) { return sheets[n] || null; }, insertSheet(n) { return makeSheet(n); } }; },
  getUi() { return { alert() {}, createMenu() { return this; } }; },
  newDataValidation() { return { requireCheckbox() { return this; }, requireValueInList() { return this; }, build() { return {}; } }; },
  newConditionalFormatRule() { return { whenTextContains() { return this; }, setBackground() { return this; }, setRanges() { return this; }, build() { return {}; } }; },
  flush() {}
};
globalThis.LockService = { getScriptLock() { return { waitLock() {}, tryLock() { return !globalThis.__lockBusy; }, releaseLock() {} }; } };
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
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, V12_ROLE_MAP: V12_ROLE_MAP,"
  + " v12BuildPositionRow: v12BuildPositionRow, v12OnEdit: v12OnEdit,"
  + " v12BuildPendingRow: v12BuildPendingRow, v12RebuildPendingFromChecked: v12RebuildPendingFromChecked,"
  + " v12ResolvePendingIntents: v12ResolvePendingIntents, v12EnqueuePendingEdit: v12EnqueuePendingEdit };";

vm.runInThisContext(src, { filename: "v12-bundle-deficit-capture.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
V12_ROLE_MAP["test@example.com"] = C.ROLES.ADMIN;
["u", "u1", "u2"].forEach(function (u) { V12_ROLE_MAP[u] = C.ROLES.ADMIN; });
const Q = C.PENDING_EDIT_COLUMNS;
const D = C.DEFICIT_COLUMNS;
const K = C.PICKING_COLUMNS;
const F = C.PENDING_FIELD;

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION",
 "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM",
 "EVENT_LOG", "PENDING_EDITS"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const DS = sheets[C.SHEETS.DEFICIT_SUMMARY];
const PK = sheets[C.SHEETS.PICKING];
const QS = sheets[C.SHEETS.PENDING_EDITS];

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

function resetQueue() { QS._data = [C.HEADERS.PENDING_EDITS.slice()]; }
function resetDeficit() { DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()]; }
function resetPicking() { PK._data = [C.HEADERS.PICKING.slice()]; }

function pendingRows() {
  const out = [];
  for (let i = 1; i < QS._data.length; i++) {
    if (String(QS._data[i][Q.STATUS - 1]).trim() === C.PENDING_STATUS.PENDING) { out.push(QS._data[i]); }
  }
  return out;
}
function intents(field) {
  return N.v12ResolvePendingIntents(QS._data).filter(function (it) { return it.field === field; });
}

function deficitRow(positionId) {
  const row = new Array(C.COLUMN_COUNT.DEFICIT_SUMMARY).fill("");
  row[D.POSITION_ID - 1] = positionId;
  return row;
}
function pickRow(positionId) {
  const row = new Array(C.COLUMN_COUNT.PICKING).fill("");
  row[K.POSITION_ID - 1] = positionId;
  return row;
}
// Диапазон/ячейка onEdit по колонке чекбокса. Форма события — «одиночная»
// (numRows=1, numCols=1), как её отдаёт Google при выделении нескольких
// чекбоксов и нажатии «пробел» (одно событие на всё выделение).
function singleCellEvent(sheet, row, col, value) {
  return {
    range: {
      getSheet() { return sheet; }, getRow() { return row; }, getColumn() { return col; },
      getNumRows() { return 1; }, getNumColumns() { return 1; },
      getA1Notation() { return "R" + row + "C" + col; },
      getValue() { return value; },
      getValues() { return [[value]]; },
      setValue() {}
    },
    value: value
  };
}

console.log("=== D1: массовая отметка «Реальная поставка» (событие = ОДНА ячейка) ===");
resetQueue();
resetDeficit();
for (let i = 1; i <= 4; i++) { DS._data.push(deficitRow("BOM1:C" + i)); }   // строки 2..5
DS._setCell(2, D.REAL_DELIVERY, true);
DS._setCell(3, D.REAL_DELIVERY, true);
DS._setCell(4, D.REAL_DELIVERY, true);
// «Пробел» по выделению пришёл ОДНИМ событием только по первой ячейке.
N.v12OnEdit(singleCellEvent(DS, 2, D.REAL_DELIVERY, "TRUE"));
check("D1: намерений REAL_DELIVERY = 3 (все отмеченные)", intents(F.REAL_DELIVERY).length, 3);
check("D1: источник = DEFICIT_SUMMARY", intents(F.REAL_DELIVERY)[0].source, C.SOURCE_UI.DEFICIT_SUMMARY);
check("D1: значение = true", intents(F.REAL_DELIVERY)[0].value, true);

console.log("=== D2: пересборка идемпотентна (повтор события не плодит дубли) ===");
N.v12OnEdit(singleCellEvent(DS, 3, D.REAL_DELIVERY, "TRUE"));
check("D2: намерений REAL_DELIVERY всё ещё 3", intents(F.REAL_DELIVERY).length, 3);

console.log("=== D3: берутся только реально отмеченные (не вся колонка) ===");
check("D3: неотмеченная C4 НЕ в очереди", (function () {
  return intents(F.REAL_DELIVERY).some(function (it) { return it.pid === "BOM1:C4"; });
})(), false);

console.log("=== D4: типизированное намерение (ORDERED_QTY) пересборкой не трогается ===");
N.v12EnqueuePendingEdit(C.SOURCE_UI.DEFICIT_SUMMARY, "BOM1:C1", F.ORDERED_QTY, 7, "u");
N.v12OnEdit(singleCellEvent(DS, 2, D.REAL_DELIVERY, "TRUE"));
check("D4: ORDERED_QTY намерение сохранено", intents(F.ORDERED_QTY).length, 1);
check("D4: REAL_DELIVERY по-прежнему 3", intents(F.REAL_DELIVERY).length, 3);

console.log("=== D5: HANDOFF (ОТБОРКА) восстанавливается по факту (регресс) ===");
resetQueue();
resetPicking();
for (let i = 1; i <= 3; i++) { PK._data.push(pickRow("BOM1:C" + i)); }
PK._setCell(2, K.CHECKBOX, true);
PK._setCell(3, K.CHECKBOX, true);
N.v12OnEdit(singleCellEvent(PK, 2, K.CHECKBOX, "TRUE"));
check("D5: HANDOFF намерений = 2 (все отмеченные)", intents(F.HANDOFF).length, 2);

console.log("=== D6: смешанный случай — HANDOFF + REAL_DELIVERY одновременно ===");
resetQueue();
resetDeficit();
resetPicking();
DS._data.push(deficitRow("BOM1:C1"));
DS._setCell(2, D.REAL_DELIVERY, true);
PK._data.push(pickRow("BOM1:C1"));
PK._setCell(2, K.CHECKBOX, true);
// Одно событие по чекбоксу ОТБОРКИ — пересборка должна навести порядок по ОБОИМ.
N.v12OnEdit(singleCellEvent(PK, 2, K.CHECKBOX, "TRUE"));
check("D6: HANDOFF = 1", intents(F.HANDOFF).length, 1);
check("D6: REAL_DELIVERY = 1", intents(F.REAL_DELIVERY).length, 1);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
