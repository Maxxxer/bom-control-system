/**
 * ЛОКАЛЬНЫЙ тест «Очереди правок чекбоксов» (Вариант D).
 *
 * Проверяет:
 *   Z1  — захват одиночной отметки через onEdit: в PENDING_EDITS одна строка
 *         PENDING с верными SOURCE/POSITION_ID/FIELD/VALUE/USER;
 *   Z1b — инлайн-слив: при QUEUE_INLINE_DRAIN=true onEdit применяет отметку сразу;
 *   Z2  — запрещённая роль: строка НЕ добавляется, ячейка откатывается;
 *   Z3  — last-wins: «поставил → снял» = отмена; дубликаты = одно намерение;
 *   Z4  — слив пачки: 3 передачи, склад списан ОДИН раз, строки DONE;
 *         повторный слив — no-op (идемпотентность, склад не меняется);
 *   Z5  — REAL_DELIVERY: realDelivery = required, склад +required один раз;
 *   Z6  — заблокированное намерение -> FAILED с причиной;
 *   Z7  — очистка старых DONE-строк (purge);
 *   Z8/Z8b — Вариант A: захват «Заказано» из Сводки и сохранение ввода, даже
 *            если пересборка проекции затрёт ячейку (регрессия «сброс в 0.0»);
 *   Z9  — «Заказано» = 0 применяется (для типизированных полей это НЕ отмена);
 *   Z10 — захват «Ожидаемой поставки» из Сводки + слив;
 *   Z11 — last-wins по «Заказано» (одно намерение, последнее значение);
 *   Z12 — «Реальная поставка» через общий захват Сводки (регрессия);
 *   Z13 — read-only колонка Сводки не перехватывается.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_queue_test.js
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

globalThis.SpreadsheetApp = {
  getActive() { return { getSheetByName(n) { return sheets[n] || null; }, insertSheet(n) { return makeSheet(n); } }; },
  getUi() { return { alert() {}, createMenu() { return this; } }; },
  newDataValidation() { return { requireCheckbox() { return this; }, requireValueInList() { return this; }, build() { return {}; } }; },
  newConditionalFormatRule() { return { whenTextContains() { return this; }, setBackground() { return this; }, setRanges() { return this; }, build() { return {}; } }; },
  flush() {}
};
globalThis.LockService = { getScriptLock() { return { waitLock() {}, tryLock() { return true; }, releaseLock() {} }; } };
globalThis.PropertiesService = { getScriptProperties() { return { getProperty() { return null; }, setProperty() {}, deleteProperty() {} }; } };
globalThis.__testUser = "test@example.com";
globalThis.Session = { getActiveUser() { return { getEmail() { return globalThis.__testUser; } }; } };
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
  + " v12CaptureCheckboxEdit: v12CaptureCheckboxEdit, v12EnqueuePendingEdit: v12EnqueuePendingEdit,"
  + " v12DrainPendingEdits: v12DrainPendingEdits, v12HasPendingEdits: v12HasPendingEdits,"
  + " v12CountPendingEdits: v12CountPendingEdits, v12ResolvePendingIntents: v12ResolvePendingIntents,"
  + " v12PurgeDonePendingEdits: v12PurgeDonePendingEdits, v12CurrentActor: v12CurrentActor };";

vm.runInThisContext(src, { filename: "v12-bundle-queue.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const P = C.POSITION_COLUMNS;
const Q = C.PENDING_EDIT_COLUMNS;
const K = C.PICKING_COLUMNS;
const M = C.MATERIAL_COLUMNS;

// По умолчанию инлайн-слив выключаем — тогда onEdit только фиксирует намерение,
// а слив вызываем вручную (детерминированно). Инлайн проверяется отдельно (Z1b).
C.SETTINGS.QUEUE_INLINE_DRAIN = false;

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION",
 "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM",
 "EVENT_LOG", "PENDING_EDITS"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const MS = sheets[C.SHEETS.MATERIAL_STATE];
const PK = sheets[C.SHEETS.PICKING];
const QS = sheets[C.SHEETS.PENDING_EDITS];
const DS = sheets[C.SHEETS.DEFICIT_SUMMARY];
const D = C.DEFICIT_COLUMNS;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}
function checkTrue(label, actual) { check(label, actual === true, true); }

function resetQueue() { QS._data = [C.HEADERS.PENDING_EDITS.slice()]; }
function queueData() { return QS._data; }
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
function whQty(k) {
  for (let i = 1; i < MS._data.length; i++) { if (MS._data[i][M.MATERIAL_KEY - 1] === k) { return MS._data[i][M.WAREHOUSE_QTY - 1]; } }
  return 0;
}
function psCell(id, col) {
  for (let i = 1; i < PS._data.length; i++) { if (PS._data[i][P.POSITION_ID - 1] === id) { return PS._data[i][col - 1]; } }
  return undefined;
}
function mkPosition(code, idx, required, reserved, ordered, expectedDate, deadline) {
  return N.v12BuildPositionRow("BOM1", {
    bomName: "BOM1", row: idx, code: code, name: "M-" + code, model: "M1", unit: "шт",
    requiredQty: required, reservedQty: reserved, deadline: deadline || "2026-09-01"
  }, "BOM1:" + code, 1, { orderedQty: ordered || 0, expectedDate: expectedDate || "" });
}
function cellEvent(sheet, row, col, value, oldValue) {
  return {
    range: {
      getSheet() { return sheet; }, getRow() { return row; }, getColumn() { return col; },
      getNumRows() { return 1; }, getNumColumns() { return 1; },
      getA1Notation() { return "R" + row + "C" + col; },
      getValue() { return value; },
      getValues() { return [[value]]; },
      setValue(v) { sheet._setCell(row, col, v); }
    },
    value: value,
    oldValue: oldValue
  };
}
function pickRow(positionId) {
  const row = new Array(C.COLUMN_COUNT.PICKING).fill("");
  row[K.POSITION_ID - 1] = positionId;
  return row;
}
function deficitRow(positionId) {
  const row = new Array(C.COLUMN_COUNT.DEFICIT_SUMMARY).fill("");
  row[D.POSITION_ID - 1] = positionId;
  return row;
}

console.log("=== Z1: захват одиночной отметки через onEdit ===");
resetPositions();
resetQueue();
resetPicking();
PK._data.push(pickRow("BOM1:C1"));
N.v12OnEdit(cellEvent(PK, 2, K.CHECKBOX, true));
check("Z1: в очереди 1 строка", queueData().length - 1, 1);
{
  const r = queueData()[1];
  check("Z1: STATUS = PENDING", r[Q.STATUS - 1], C.PENDING_STATUS.PENDING);
  check("Z1: SOURCE = PICKING", r[Q.SOURCE - 1], "PICKING");
  check("Z1: POSITION_ID", r[Q.POSITION_ID - 1], "BOM1:C1");
  check("Z1: FIELD = HANDOFF", r[Q.FIELD - 1], "HANDOFF");
  check("Z1: VALUE = true", r[Q.VALUE - 1], true);
  check("Z1: USER", r[Q.USER - 1], "test@example.com");
  check("Z1: есть Edit ID", String(r[Q.EDIT_ID - 1] || "").length > 0, true);
}

console.log("=== Z1b: инлайн-слив применяет отметку сразу ===");
C.SETTINGS.QUEUE_INLINE_DRAIN = true;
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 50 });
PS._data.push(mkPosition("C1", 1, 10, 10, 0, "", "2026-09-01"));   // available=10 >= required=10
PK._data.push(pickRow("BOM1:C1"));
N.v12OnEdit(cellEvent(PK, 2, K.CHECKBOX, true));
check("Z1b: позиция передана (RECEIVED_BY_PRODUCTION)", psCell("BOM1:C1", P.RECEIVED_BY_PRODUCTION), true);
check("Z1b: жизненный цикл = ARCHIVED", psCell("BOM1:C1", P.LIFECYCLE_STATE), C.LIFECYCLE_STATE.ARCHIVED);
check("Z1b: склад C1 = 40", whQty("C1"), 40);
check("Z1b: очередь пуста (обработана)", queueData()[1][Q.STATUS - 1], C.PENDING_STATUS.DONE);
C.SETTINGS.QUEUE_INLINE_DRAIN = false;

console.log("=== Z2: запрещённая роль — строка не создаётся, ячейка откатывается ===");
resetQueue();
resetPicking();
PK._data.push(pickRow("BOM1:C1"));
PK._setCell(2, K.CHECKBOX, true);
N.V12_ROLE_MAP["viewer@example.com"] = C.ROLES.VIEWER;
globalThis.__testUser = "viewer@example.com";
N.v12OnEdit(cellEvent(PK, 2, K.CHECKBOX, true, false));
check("Z2: очередь пуста", queueData().length - 1, 0);
check("Z2: ячейка откатана в false", PK._data[1][K.CHECKBOX - 1], false);
delete N.V12_ROLE_MAP["viewer@example.com"];
globalThis.__testUser = "test@example.com";

console.log("=== Z3: last-wins (отмена + дубликаты) ===");
function rawQ(status, source, pid, field, value, user) {
  const row = new Array(C.COLUMN_COUNT.PENDING_EDITS).fill("");
  row[Q.DATE - 1] = new Date();
  row[Q.STATUS - 1] = status;
  row[Q.SOURCE - 1] = source;
  row[Q.POSITION_ID - 1] = pid;
  row[Q.FIELD - 1] = field;
  row[Q.VALUE - 1] = value;
  row[Q.USER - 1] = user;
  return row;
}
{
  const data = [C.HEADERS.PENDING_EDITS.slice(),
    rawQ("PENDING", "PICKING", "BOM1:C1", "HANDOFF", true, "u1"),
    rawQ("PENDING", "PICKING", "BOM1:C1", "HANDOFF", false, "u1"),   // снятие — отмена
    rawQ("PENDING", "PICKING", "BOM1:C2", "HANDOFF", true, "u2"),
    rawQ("PENDING", "PICKING", "BOM1:C2", "HANDOFF", true, "u3"),    // дубликат -> одно
    rawQ("DONE", "PICKING", "BOM1:C3", "HANDOFF", true, "u9")];      // не PENDING -> не учитывается
  const intents = N.v12ResolvePendingIntents(data);
  check("Z3: намерений = 2", intents.length, 2);
  const byPid = {};
  intents.forEach(function (it) { byPid[it.pid] = it; });
  check("Z3: C1 — последнее значение false (отмена)", byPid["BOM1:C1"].value, false);
  check("Z3: C2 — true, пользователь последней отметки", byPid["BOM1:C2"].value && byPid["BOM1:C2"].user === "u3", true);
}

console.log("=== Z4: слив пачки передач (склад списывается один раз) ===");
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 50, "C2": 50, "C3": 50 });
PS._data.push(mkPosition("C1", 1, 10, 10, 0, "", "2026-09-01"));
PS._data.push(mkPosition("C2", 2, 10, 10, 0, "", "2026-09-01"));
PS._data.push(mkPosition("C3", 3, 10, 10, 0, "", "2026-09-01"));
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "test@example.com");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C2", "HANDOFF", true, "test@example.com");
N.v12EnqueuePendingEdit("PICKING", "BOM1:C3", "HANDOFF", true, "test@example.com");
check("Z4: в очереди 3 намерения", N.v12CountPendingEdits(), 3);
const drain1 = N.v12DrainPendingEdits();
check("Z4: слито = 3", drain1.drained, 3);
["C1", "C2", "C3"].forEach(function (c) {
  check("Z4: " + c + " передан", psCell("BOM1:" + c, P.RECEIVED_BY_PRODUCTION), true);
  check("Z4: " + c + " склад = 40", whQty(c), 40);
  check("Z4: " + c + " строка очереди DONE", (function () {
    for (let i = 1; i < queueData().length; i++) {
      if (queueData()[i][Q.POSITION_ID - 1] === "BOM1:" + c) { return queueData()[i][Q.STATUS - 1]; }
    }
    return "";
  })(), C.PENDING_STATUS.DONE);
});
check("Z4: необработанных не осталось", N.v12HasPendingEdits(), false);
N.v12DrainPendingEdits();
check("Z4: повторный слив не меняет склад C1", whQty("C1"), 40);
check("Z4: повторный слив не меняет склад C2", whQty("C2"), 40);
check("Z4: повторный слив не меняет склад C3", whQty("C3"), 40);

console.log("=== Z5: REAL_DELIVERY — полная поставка + склад на дельту ===");
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 5 });
PS._data.push(mkPosition("C1", 1, 10, 0, 10, "2026-09-05", "2026-09-10"));
N.v12EnqueuePendingEdit("DEFICIT_SUMMARY", "BOM1:C1", "REAL_DELIVERY", true, "test@example.com");
const drain5 = N.v12DrainPendingEdits();
check("Z5: слито = 1", drain5.drained, 1);
check("Z5: REAL_DELIVERY_QTY = 10", psCell("BOM1:C1", P.REAL_DELIVERY_QTY), 10);
check("Z5: склад C1 = 15", whQty("C1"), 15);

console.log("=== Z6: заблокированное намерение -> FAILED ===");
resetPositions();
resetQueue();
resetPicking();
PS._data.push(mkPosition("C1", 1, 10, 0, 0, "", "2026-09-01"));   // available=0 < required -> blocked
N.v12EnqueuePendingEdit("PICKING", "BOM1:C1", "HANDOFF", true, "test@example.com");
N.v12DrainPendingEdits();
{
  const r = queueData()[1];
  check("Z6: статус = FAILED", r[Q.STATUS - 1], C.PENDING_STATUS.FAILED);
  checkTrue("Z6: причина записана", String(r[Q.ERROR - 1] || "").length > 0);
  check("Z6: позиция не передана", psCell("BOM1:C1", P.RECEIVED_BY_PRODUCTION), false);
}

console.log("=== Z7: очистка старых DONE-строк (purge 30 дней) ===");
resetQueue();
{
  const oldRow = rawQ("DONE", "PICKING", "BOM1:OLD", "HANDOFF", true, "u");
  oldRow[Q.PROCESSED_AT - 1] = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const freshRow = rawQ("DONE", "PICKING", "BOM1:NEW", "HANDOFF", true, "u");
  freshRow[Q.PROCESSED_AT - 1] = new Date();
  const pendRow = rawQ("PENDING", "PICKING", "BOM1:PEND", "HANDOFF", true, "u");
  queueData().push(oldRow, freshRow, pendRow);
  const removed = N.v12PurgeDonePendingEdits(30);
  check("Z7: удалена 1 старая DONE-строка", removed, 1);
  check("Z7: осталось 2 строки", QS.getLastRow() - 1, 2);
  let hasOld = false, hasPending = false;
  const last = QS.getLastRow();
  for (let i = 1; i <= last; i++) {
    const row = QS._data[i - 1] || [];
    if (row[Q.POSITION_ID - 1] === "BOM1:OLD") { hasOld = true; }
    if (row[Q.STATUS - 1] === C.PENDING_STATUS.PENDING) { hasPending = true; }
  }
  check("Z7: старейшая строка удалена", hasOld, false);
  check("Z7: PENDING-строка сохранена", hasPending, true);
}

console.log("=== Z8: захват «Заказано» из Сводки + слив ===");
resetPositions();
resetQueue();
resetPicking();
setMaterial({ "C1": 0 });
PS._data.push(mkPosition("C1", 1, 10, 0, 0, "", "2026-09-30"));   // deficit = 10
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
DS._data.push(deficitRow("BOM1:C1"));
N.v12OnEdit(cellEvent(DS, 2, D.ORDERED_QTY, 100));
check("Z8: в очереди 1 строка", queueData().length - 1, 1);
check("Z8: SOURCE = DEFICIT_SUMMARY", queueData()[1][Q.SOURCE - 1], "DEFICIT_SUMMARY");
check("Z8: FIELD = ORDERED_QTY", queueData()[1][Q.FIELD - 1], "ORDERED_QTY");
check("Z8: VALUE = 100 (число, не boolean)", queueData()[1][Q.VALUE - 1], 100);
N.v12DrainPendingEdits();
check("Z8: POSITION_STATE.ORDERED_QTY = 100", psCell("BOM1:C1", P.ORDERED_QTY), 100);
check("Z8: строка очереди DONE", queueData()[1][Q.STATUS - 1], C.PENDING_STATUS.DONE);

console.log("=== Z8b: ввод не теряется, даже если пересборка затрёт ячейку ===");
// Симуляция гонки: намерение уже зафиксировано в очереди (быстрый путь onEdit),
// затем ЛЮБАЯ пересборка проекции перезаписывает ячейку Сводки значением из
// POSITION_STATE (0). Слив очереди восстанавливает ввод.
resetPositions();
resetQueue();
setMaterial({ "C1": 0 });
PS._data.push(mkPosition("C1", 1, 10, 0, 0, "", "2026-09-30"));
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
DS._data.push(deficitRow("BOM1:C1"));
N.v12OnEdit(cellEvent(DS, 2, D.ORDERED_QTY, 7));   // намерение в очереди
DS._setCell(2, D.ORDERED_QTY, 0);                  // «пересборка» затёрла ячейку
N.v12DrainPendingEdits();                          // слив применяет намерение
check("Z8b: заказ сохранён (=7), несмотря на сброс ячейки", psCell("BOM1:C1", P.ORDERED_QTY), 7);

console.log("=== Z9: «Заказано» = 0 применяется (это НЕ отмена) ===");
resetPositions();
resetQueue();
PS._data.push(mkPosition("C1", 1, 10, 0, 50, "2026-09-05", "2026-09-30"));   // уже заказано 50
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
DS._data.push(deficitRow("BOM1:C1"));
N.v12OnEdit(cellEvent(DS, 2, D.ORDERED_QTY, 0));
check("Z9: VALUE = 0", queueData()[1][Q.VALUE - 1], 0);
N.v12DrainPendingEdits();
check("Z9: ORDERED_QTY сброшен в 0", psCell("BOM1:C1", P.ORDERED_QTY), 0);

console.log("=== Z10: захват «Ожидаемая поставка» + слив ===");
resetPositions();
resetQueue();
PS._data.push(mkPosition("C1", 1, 10, 0, 10, "", "2026-09-30"));
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
DS._data.push(deficitRow("BOM1:C1"));
N.v12OnEdit(cellEvent(DS, 2, D.EXPECTED_DATE, new Date(2026, 8, 20)));   // 20.09.2026
check("Z10: FIELD = EXPECTED_DATE", queueData()[1][Q.FIELD - 1], "EXPECTED_DATE");
N.v12DrainPendingEdits();
check("Z10: EXPECTED_DATE установлена (Date)", psCell("BOM1:C1", P.EXPECTED_DATE) instanceof Date, true);
check("Z10: день = 20", psCell("BOM1:C1", P.EXPECTED_DATE).getDate(), 20);

console.log("=== Z11: last-wins по «Заказано» (одно намерение, последнее значение) ===");
resetQueue();
N.v12EnqueuePendingEdit("DEFICIT_SUMMARY", "BOM1:C1", "ORDERED_QTY", 10, "u1");
N.v12EnqueuePendingEdit("DEFICIT_SUMMARY", "BOM1:C1", "ORDERED_QTY", 25, "u2");
{
  const intents = N.v12ResolvePendingIntents(queueData());
  check("Z11: одно намерение", intents.length, 1);
  check("Z11: последнее значение = 25", intents[0].value, 25);
}

console.log("=== Z12: «Реальная поставка» через общий захват Сводки (регрессия) ===");
resetPositions();
resetQueue();
setMaterial({ "C1": 5 });
PS._data.push(mkPosition("C1", 1, 10, 0, 10, "2026-09-05", "2026-09-10"));
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
DS._data.push(deficitRow("BOM1:C1"));
N.v12OnEdit(cellEvent(DS, 2, D.REAL_DELIVERY, true));
check("Z12: FIELD = REAL_DELIVERY", queueData()[1][Q.FIELD - 1], "REAL_DELIVERY");
check("Z12: VALUE = true", queueData()[1][Q.VALUE - 1], true);
N.v12DrainPendingEdits();
check("Z12: REAL_DELIVERY_QTY = 10", psCell("BOM1:C1", P.REAL_DELIVERY_QTY), 10);
check("Z12: склад C1 = 15", whQty("C1"), 15);

console.log("=== Z13: read-only колонка Сводки не перехватывается (идёт прежней логикой) ===");
resetQueue();
// Колонка «Статус» (14) — не редактируемая. Захват не должен её принять.
DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
DS._data.push(deficitRow("BOM1:C2"));
N.v12OnEdit(cellEvent(DS, 2, D.STATUS, "Не заказано"));
check("Z13: очередь пуста (колонка не перехвачена)", queueData().length - 1, 0);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
