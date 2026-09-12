/**
 * ЛОКАЛЬНЫЙ тест исправлений «захвата намерений» (V4-надёжность).
 *
 * Проверяет дефекты, из-за которых в ОТБОРКЕ «чекбокс стоит, а позиции в
 * PENDING_EDITS нет» и «снял → поставил фиксируется и как off, и как on»:
 *
 *   F1 — UPSERT: повторная отметка того же ключа НЕ добавляет вторую строку,
 *        а ОБНОВЛЯЕТ существующую (в очереди максимум одно намерение на ключ);
 *   F2 — off→on→off→on: одно намерение, итог = последнее значение (true);
 *   F3 — РАЗНЫЕ ключи (позиции/поля) сохраняются раздельно (3 -> 3);
 *   F4 — upsert НЕ воскрешает уже обработанную (DONE) строку — добавляется
 *        свежая PENDING (итого 2 строки, намерение одно);
 *   F5 — массовый захват диапазона: ВСЕ позиции попадают в очередь (нет
 *        «пропажи»), Edit ID берётся из одной базы на весь захват;
 *   F6 — повторные записи НЕ перезатирают друг друга (все ключи сохранены);
 *   F7 — при занятом локе (идёт Apply) намерение НЕ пишется молча — безопасный
 *        отказ (очередь не портится), вместо гоночной перезаписи;
 *   F8 — реконсиляция: галочка стоит БЕЗ строки в очереди -> передача;
 *   F9 — реконсиляция НЕ дублирует уже зафиксированное намерение;
 *   F10 — САМОВОССТАНОВЛЕНИЕ захвата: «доехало» 1 событие из 5 -> в очереди
 *         СРАЗУ все 5 отмеченных (пересборка по фактическим галочкам), при
 *         Apply переданы все 5;
 *   F11 — пересборка идемпотентна и схлопывает дубли;
 *   F12 — последовательные доехавшие события не плодят дубли;
 *   F13 — снятие галочки не воскрешается пересборкой (HANDOFF=false).
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_queue_capture_fix_test.js
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

// Флаг «лок занят» для F7: имитирует параллельный Apply/полный синк.
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
  + " v12EnqueuePendingEdit: v12EnqueuePendingEdit, v12EnqueuePendingRows: v12EnqueuePendingRows,"
  + " v12BuildPendingRow: v12BuildPendingRow, v12RebuildPendingFromChecked: v12RebuildPendingFromChecked,"
  + " v12DrainPendingEdits: v12DrainPendingEdits, v12HasPendingEdits: v12HasPendingEdits,"
  + " v12CountPendingEdits: v12CountPendingEdits, v12ResolvePendingIntents: v12ResolvePendingIntents };";

vm.runInThisContext(src, { filename: "v12-bundle-capture-fix.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const P = C.POSITION_COLUMNS;
const Q = C.PENDING_EDIT_COLUMNS;
const K = C.PICKING_COLUMNS;
const M = C.MATERIAL_COLUMNS;

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION",
 "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM",
 "EVENT_LOG", "PENDING_EDITS"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const MS = sheets[C.SHEETS.MATERIAL_STATE];
const PK = sheets[C.SHEETS.PICKING];
const QS = sheets[C.SHEETS.PENDING_EDITS];

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

function resetQueue() { QS._data = [C.HEADERS.PENDING_EDITS.slice()]; }
function resetPositions() { PS._data = [C.HEADERS.POSITION_STATE.slice()]; }
function resetPicking() { PK._data = [C.HEADERS.PICKING.slice()]; }
function setMaterial(map) {
  MS._data = [C.HEADERS.MATERIAL_STATE.slice()];
  Object.keys(map).forEach(function (k) {
    const row = new Array(C.COLUMN_COUNT.MATERIAL_STATE).fill("");
    row[M.MATERIAL_KEY - 1] = k;
    row[M.MATERIAL_CODE - 1] = k;
    row[M.WAREHOUSE_QTY - 1] = map[k];
    MS._data.push(row);
  });
}
function bodyRows() { return QS.getLastRow() - 1; }
function pendingRows() {
  const out = [];
  for (let i = 1; i < QS._data.length; i++) {
    if (String(QS._data[i][Q.STATUS - 1]).trim() === C.PENDING_STATUS.PENDING) { out.push(QS._data[i]); }
  }
  return out;
}
function mkPosition(code, idx, required, reserved) {
  return N.v12BuildPositionRow("BOM1", {
    bomName: "BOM1", row: idx, code: code, name: "M-" + code, model: "M1", unit: "шт",
    requiredQty: required, reservedQty: reserved, deadline: "2026-09-01"
  }, "BOM1:" + code, 1, {});
}
function pickRow(positionId) {
  const row = new Array(C.COLUMN_COUNT.PICKING).fill("");
  row[K.POSITION_ID - 1] = positionId;
  return row;
}
// Диапазонный onEdit по колонке CHECKBOX ОТБОРКИ (массовая отметка).
function rangeEvent(sheet, firstRow, numRows, col, values) {
  return {
    range: {
      getSheet() { return sheet; }, getRow() { return firstRow; }, getColumn() { return col; },
      getNumRows() { return numRows; }, getNumColumns() { return 1; },
      getA1Notation() { return "R" + firstRow + "C" + col; },
      getValue() { return values[0] ? values[0][0] : ""; },
      getValues() { return values; },
      setValue() {}
    },
    value: values[0] ? values[0][0] : "",
    values: values
  };
}

console.log("=== F1: UPSERT — повторная отметка того же ключа обновляет, а не дублирует ===");
resetQueue();
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u1");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", false, "u2");
check("F1: в очереди ОДНА строка (upsert)", bodyRows(), 1);
check("F1: значение = последнее (false)", pendingRows()[0][Q.VALUE - 1], false);
check("F1: автор = последний", pendingRows()[0][Q.USER - 1], "u2");
check("F1: намерений при резолве = 1", N.v12ResolvePendingIntents(QS._data).length, 1);

console.log("=== F2: off→on→off→on — одно намерение, итог true ===");
resetQueue();
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", false, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", false, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u");
check("F2: в очереди одна строка", bodyRows(), 1);
{
  const intents = N.v12ResolvePendingIntents(QS._data);
  check("F2: одно намерение", intents.length, 1);
  check("F2: значение = true (последнее)", intents[0].value, true);
}

console.log("=== F3: разные ключи сохраняются раздельно ===");
resetQueue();
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C2", "HANDOFF", true, "u");
N.v12EnqueuePendingEdit("DEFICIT_SUMMARY", "BOM1:C1", "ORDERED_QTY", 5, "u");
check("F3: три разных ключа -> три строки", bodyRows(), 3);

console.log("=== F4: upsert НЕ воскрешает DONE-строку (свежая PENDING добавляется) ===");
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 50 });
PS._data.push(mkPosition("C1", 1, 10, 10));
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u");
N.v12DrainPendingEdits();           // -> HANDOFF применён, строка DONE
check("F4: после слива строка DONE", QS._data[1][Q.STATUS - 1], C.PENDING_STATUS.DONE);
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u");   // ключ тот же, но старая строка DONE
check("F4: добавлена НОВАЯ строка (всего 2)", bodyRows(), 2);
check("F4: ровно одно живое намерение (PENDING)", pendingRows().length, 1);

console.log("=== F5: массовый захват диапазона — ВСЕ позиции попадают в очередь ===");
resetPositions();
resetQueue();
resetPicking();
for (let i = 1; i <= 5; i++) { PK._data.push(pickRow("BOM1:C" + i)); }   // строки 2..6
const maskValues = [["TRUE"], ["TRUE"], ["TRUE"], ["TRUE"], ["TRUE"]];
N.v12OnEdit(rangeEvent(PK, 2, 5, K.CHECKBOX, maskValues));
check("F5: захвачено ВСЕ 5 позиций", bodyRows(), 5);
{
  let allPresent = true;
  for (let i = 1; i <= 5; i++) {
    let found = false;
    for (let r = 0; r < pendingRows().length; r++) {
      if (pendingRows()[r][Q.POSITION_ID - 1] === "BOM1:C" + i) { found = true; break; }
    }
    if (!found) { allPresent = false; }
  }
  check("F5: присутствуют все Position ID", allPresent, true);
  const editIds = pendingRows().map(function (row) { return String(row[Q.EDIT_ID - 1]); });
  check("F5: у всех строк есть Edit ID", editIds.every(function (id) { return id.length > 0; }), true);
  check("F5: Edit ID уникальны в захвате", new Set(editIds).size, 5);
}

console.log("=== F6: повторные записи не перезатирают друг друга ===");
resetQueue();
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C2", "HANDOFF", true, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C3", "HANDOFF", true, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C4", "HANDOFF", true, "u");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C5", "HANDOFF", true, "u");
check("F6: все 5 строк на месте", bodyRows(), 5);
{
  const ids = pendingRows().map(function (row) { return row[Q.POSITION_ID - 1]; });
  check("F6: все ключи сохранены", new Set(ids).size, 5);
}

console.log("=== F7: при занятом локе намерение НЕ пишется (безопасный отказ) ===");
resetQueue();
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "u");   // 1 строка успешно
const before = bodyRows();
globalThis.__lockBusy = true;
N.v12EnqueuePendingEdit("PICKING", "BOM1:C2", "HANDOFF", true, "u");   // лок занят -> отказ
globalThis.__lockBusy = false;
check("F7: очередь не изменилась (без гоночной перезаписи)", bodyRows(), before);
check("F7: строка C2 НЕ добавлена", (function () {
  return pendingRows().some(function (r) { return r[Q.POSITION_ID - 1] === "BOM1:C2"; });
})(), false);

function whQty(k) {
  for (let i = 1; i < MS._data.length; i++) { if (MS._data[i][M.MATERIAL_KEY - 1] === k) { return MS._data[i][M.WAREHOUSE_QTY - 1]; } }
  return 0;
}
function psCell(id, col) {
  for (let i = 1; i < PS._data.length; i++) { if (PS._data[i][P.POSITION_ID - 1] === id) { return PS._data[i][col - 1]; } }
  return undefined;
}

console.log("=== F8: реконсиляция — галочка стоит БЕЗ строки в очереди -> передача ===");
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 50 });
PS._data.push(mkPosition("C1", 1, 10, 10));      // available=10 >= required=10
PK._data.push(pickRow("BOM1:C1"));
PK._setCell(2, K.CHECKBOX, true);                // галочка стоит, in onEdit «потерян» (очередь пуста)
check("F8: очередь пуста перед сливом", N.v12HasPendingEdits(), false);
const drainR = N.v12DrainPendingEdits();
check("F8: слив произошёл (не no-op)", drainR.drained >= 1, true);
check("F8: позиция передана по галочке", psCell("BOM1:C1", P.RECEIVED_BY_PRODUCTION), true);
check("F8: склад C1 = 40", whQty("C1"), 40);

console.log("=== F9: реконсиляция НЕ дублирует уже зафиксированное намерение ===");
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C2": 50 });
PS._data.push(mkPosition("C2", 1, 10, 10));
PK._data.push(pickRow("BOM1:C2"));
PK._setCell(2, K.CHECKBOX, true);
N.v12EnqueuePendingEdit("PICKING", "BOM1:C2", "HANDOFF", true, "u");   // намерение УЖЕ в очереди
const drainD = N.v12DrainPendingEdits();
check("F9: применено ровно одно намерение", drainD.drained, 1);
check("F9: склад списан ОДИН раз (C2 = 40, не 30)", whQty("C2"), 40);
check("F9: позиция передана", psCell("BOM1:C2", P.RECEIVED_BY_PRODUCTION), true);

console.log("=== F10: САМОВОССТАНОВЛЕНИЕ — доехало 1 событие, в очереди СРАЗУ ВСЕ 5 ===");
// 5 галочек стоят в листе, но onEdit «доехал» только для 1 строки. Захват
// самовосстанавливается: пересборка по фактическим галочкам СРАЗУ добирает все
// отмеченные позиции — лист очереди отражает 5, ещё ДО «Применить».
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 50, "C2": 50, "C3": 50, "C4": 50, "C5": 50 });
for (let i = 1; i <= 5; i++) {
  PS._data.push(mkPosition("C" + i, i, 10, 10));         // available=10 >= required=10
  PK._data.push(pickRow("BOM1:C" + i));
  PK._setCell(i + 1, K.CHECKBOX, true);                  // все 5 отмечены
}
// «Доехало» только событие для 1 строки (остальные onEdit потеряны Google).
N.v12OnEdit(rangeEvent(PK, 2, 1, K.CHECKBOX, [["TRUE"]]));
check("F10: в очереди СРАЗУ ВСЕ 5 позиций (самовосстановление)", bodyRows(), 5);
// Слив подтверждает: передаются все 5 отмеченных позиций.
N.v12DrainPendingEdits();
let received = 0;
for (let i = 1; i <= 5; i++) { if (psCell("BOM1:C" + i, P.RECEIVED_BY_PRODUCTION) === true) { received++; } }
check("F10: переданы ВСЕ 5 позиций", received, 5);

console.log("=== F11: пересборка идемпотентна и схлопывает дубли ===");
resetPositions();
resetQueue();
resetPicking();
PK._data.push(pickRow("BOM1:C1"));
PK._setCell(2, K.CHECKBOX, true);
// имитируем уже накопившиеся дубли одного ключа
QS._data.push(N.v12BuildPendingRow("PICKING", "BOM1:C1", "HANDOFF", true, "u"));
QS._data.push(N.v12BuildPendingRow("PICKING", "BOM1:C1", "HANDOFF", true, "u"));
check("F11: до пересборки 2 строки (дубль)", pendingRows().length, 2);
N.v12RebuildPendingFromChecked();
check("F11: после пересборки ровно 1 живая строка", pendingRows().length, 1);
N.v12RebuildPendingFromChecked();
check("F11: повторная пересборка не плодит дубли", pendingRows().length, 1);

console.log("=== F12: последовательные доехавшие события не плодят дубли ===");
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 50, "C2": 50, "C3": 50 });
for (let i = 1; i <= 3; i++) {
  PS._data.push(mkPosition("C" + i, i, 10, 10));
  PK._data.push(pickRow("BOM1:C" + i));
  PK._setCell(i + 1, K.CHECKBOX, true);                  // все 3 отмечены
}
// Два события подряд (каждое запускает самовосстановление по всем галочкам).
N.v12OnEdit(rangeEvent(PK, 2, 1, K.CHECKBOX, [["TRUE"]]));
N.v12OnEdit(rangeEvent(PK, 3, 1, K.CHECKBOX, [["TRUE"]]));
check("F12: живых намерений ровно 3 (без дублей)", pendingRows().length, 3);
check("F12: всего строк 3", bodyRows(), 3);

console.log("=== F13: снятие галочки не воскрешается пересборкой ===");
resetPositions();
resetQueue();
resetPicking();
PK._data.push(pickRow("BOM1:C1"));
PK._setCell(2, K.CHECKBOX, true);
N.v12OnEdit(rangeEvent(PK, 2, 1, K.CHECKBOX, [["TRUE"]]));   // поставили галочку
check("F13: намерение зафиксировано", pendingRows().length, 1);
PK._setCell(2, K.CHECKBOX, false);                           // сняли галочку в листе
N.v12OnEdit(rangeEvent(PK, 2, 1, K.CHECKBOX, [["FALSE"]]));  // событие «снятие»
{
  const intents = N.v12ResolvePendingIntents(QS._data);
  check("F13: ровно одно намерение", intents.length, 1);
  check("F13: значение = false (снятие, не воскрешено)", intents[0].value, false);
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
