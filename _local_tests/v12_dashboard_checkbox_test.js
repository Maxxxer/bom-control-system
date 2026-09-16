/**
 * ЛОКАЛЬНЫЙ тест чекбокса «Выполнено» дашборда (модель «Применить», V3).
 *
 * Проверяет, что чекбокс дашборда обрабатывается ТАК ЖЕ, как чекбоксы «Сводки
 * дефицитов»:
 *   A) захват правки идёт в очередь PENDING_EDITS (поле DASHBOARD_DONE,
 *      SOURCE = DASHBOARD, POSITION_ID = BOM ID), синхронно НИЧЕГО не меняется;
 *   B) применение (v12DrainPendingEdits) ставит BOM в EXCLUDED_BOMS, и BOM
 *      УБИРАЕТСЯ из активного дашборда (это и есть «убрать позицию из списка»);
 *   C) некомплектованный BOM отметить нельзя: применение блокируется, BOM
 *      остаётся в активном дашборде, строка очереди — FAILED с причиной;
 *   D) RBAC: роль без права DASHBOARD_CHECKBOX правку откатывает (намерение
 *      не фиксируется);
 *   E) пересборка очереди (v12RebuildPendingFromChecked) добирает отмеченный
 *      «Выполнено» по факту галочки (страховка от потерянных onEdit) и
 *      идемпотентна;
 *   F) отмена «Выполнено» (v12SetBomDone(id, false) — пункт меню «Вернуть
 *      проект в Dashboard») возвращает проект в активный дашборд; повтор
 *      идемпотентен.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_dashboard_checkbox_test.js
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
    getMaxColumns() { return 30; },
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
        clearDataValidations() { return this; },
        setDataValidation() { return this; },
        setBackgrounds() { return this; }, setBackground() { return this; },
        setFontWeight() { return this; },
        setNotes(notes) { self._notes = (notes || []).map(function (r) { return r[0]; }); return this; },
        setNumberFormat() { return this; }, setHorizontalAlignment() { return this; },
        setVerticalAlignment() { return this; }, setWrapStrategy() { return this; }
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
    setColumnWidth() {}, hideColumns() {}, showColumns() {}, deleteColumn() {}, insertColumnBefore() {},
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
  WrapStrategy: { WRAP: "WRAP" },
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
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, V12_ROLE_MAP: V12_ROLE_MAP,"
  + " v12BuildPositionRow: v12BuildPositionRow, v12OnEdit: v12OnEdit,"
  + " v12RefreshDashboard: v12RefreshDashboard, v12DrainPendingEdits: v12DrainPendingEdits,"
  + " v12RebuildPendingFromChecked: v12RebuildPendingFromChecked,"
  + " v12ResolvePendingIntents: v12ResolvePendingIntents, v12BuildExcludedMap: v12BuildExcludedMap,"
  + " v12HasPendingEdits: v12HasPendingEdits,"
  + " v12SetBomDone: v12SetBomDone,"
  + " v12AggregateBomStates: v12AggregateBomStates,"
  + " v12ComputeBomStatus: v12ComputeBomStatus };";

vm.runInThisContext(src, { filename: "v12-bundle-dashboard-checkbox.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const P = C.POSITION_COLUMNS;
const Q = C.PENDING_EDIT_COLUMNS;
const D = C.DASHBOARD_COLUMNS;
const B = C.EXCLUDED_BOMS_COLUMNS;
const F = C.PENDING_FIELD;
const TEST_USER = "test@example.com";

// Роль по умолчанию — ADMIN (RBAC проверяется отдельно, в блоке D).
N.V12_ROLE_MAP[TEST_USER] = C.ROLES.ADMIN;
function setRole(role) {
  Object.keys(N.V12_ROLE_MAP).forEach(function (k) { delete N.V12_ROLE_MAP[k]; });
  N.V12_ROLE_MAP[TEST_USER] = role;
}

["POSITION_STATE", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "DEFICIT_SUMMARY",
 "PICKING", "WORKING_BOM", "SUPPLY", "ARCHIVE", "MATERIAL_STATE",
 "MATERIAL_HISTORY", "AUDIT_LOG", "EVENT_LOG", "PENDING_EDITS"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const DB = sheets[C.SHEETS.DASHBOARD];
const EX = sheets[C.SHEETS.EXCLUDED_BOMS];
const QS = sheets[C.SHEETS.PENDING_EDITS];

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

function resetPositions() { PS._data = [C.HEADERS.POSITION_STATE.slice()]; }
function resetExcluded() { EX._data = [C.HEADERS.EXCLUDED_BOMS.slice()]; }
function resetQueue() { QS._data = [C.HEADERS.PENDING_EDITS.slice()]; }

function mkPosition(bomId, code, idx, required, reserved, opts) {
  const o = opts || {};
  // «Крайний срок» обязателен для валидности позиции (v12ValidatePosition):
  // без него позиция получает статус «Ошибка данных», BOM никогда не станет
  // «Готов к работе», и гейт «Выполнено» не сработает.
  return N.v12BuildPositionRow(bomId, {
    bomName: bomId, row: idx, code: code, name: "M-" + code,
    model: o.model === undefined ? "M1" : o.model, unit: "шт",
    requiredQty: required, reservedQty: reserved, deadline: o.deadline || "2026-09-30"
  }, bomId + ":" + code, 1, {
    orderedQty: o.ordered || 0,
    expectedDate: o.expectedDate || "",
    receivedByProduction: o.received || false,
    receivedByProductionQty: o.receivedQty || 0
  });
}

function dashboardBomIds() {
  const out = [];
  for (let i = 1; i < DB._data.length; i++) {
    const id = DB._data[i][D.BOM_ID - 1];
    if (id !== "" && id !== null && id !== undefined) { out.push(id); }
  }
  return out;
}
function dashboardRowOf(bomId) {
  for (let i = 1; i < DB._data.length; i++) {
    if (DB._data[i][D.BOM_ID - 1] === bomId) { return i + 1; }
  }
  return -1;
}
function excludedDone(bomId) {
  const map = N.v12BuildExcludedMap();
  return map[bomId] === true;
}
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
// onEdit по одиночной ячейке чекбокса «Выполнено» дашборда.
function doneEdit(row, value, oldValue) {
  return {
    range: {
      getSheet() { return DB; }, getRow() { return row; }, getColumn() { return D.DONE; },
      getNumRows() { return 1; }, getNumColumns() { return 1; },
      getA1Notation() { return "R" + row + "C" + D.DONE; },
      getValue() { return value; },
      getValues() { return [[value]]; },
      setValue(v) { DB._setCell(row, D.DONE, v); }
    },
    value: value,
    oldValue: oldValue
  };
}
function setDoneChecked(bomId) {
  const row = dashboardRowOf(bomId);
  DB._setCell(row, D.DONE, true);
  return row;
}

console.log("=== A: захват «Выполнено» → очередь DASHBOARD_DONE (без синхронного применения) ===");
resetPositions();
resetExcluded();
resetQueue();
setRole(C.ROLES.PRODUCTION);
PS._data.push(mkPosition("BOM1", "C1", 1, 5, 5, { received: true, receivedQty: 5 }));
PS._data.push(mkPosition("BOM2", "C2", 1, 5, 0, {}));
N.v12RefreshDashboard();
check("A1: в дашборде две строки (BOM1 и BOM2)", dashboardBomIds().join("|"), "BOM1|BOM2");
const row1 = setDoneChecked("BOM1");
N.v12OnEdit(doneEdit(row1, true));
check("A2: зафиксировано ровно одно намерение DASHBOARD_DONE", intents(F.DASHBOARD_DONE).length, 1);
check("A3: поле намерения = DASHBOARD_DONE", intents(F.DASHBOARD_DONE)[0].field, F.DASHBOARD_DONE);
check("A4: источник = DASHBOARD", intents(F.DASHBOARD_DONE)[0].source, C.SOURCE_UI.DASHBOARD);
check("A5: POSITION_ID = BOM ID", intents(F.DASHBOARD_DONE)[0].pid, "BOM1");
check("A6: значение = true", intents(F.DASHBOARD_DONE)[0].value, true);
check("A7: синхронно в EXCLUDED_BOMS ничего не записано", excludedDone("BOM1"), false);
check("A8: BOM1 пока в активном дашборде", dashboardBomIds().indexOf("BOM1") >= 0, true);

console.log("=== B: применение → BOM уходит из активного дашборда ===");
const drain = N.v12DrainPendingEdits();
console.log("    [debug] drain=" + JSON.stringify(drain) +
  " queueError=" + JSON.stringify(QS._data[1] ? QS._data[1][Q.ERROR - 1] : null) +
  " agg=" + JSON.stringify(N.v12AggregateBomStates()["BOM1"] || null));
check("B1: применено намерений ≥ 1", drain.drained >= 1, true);
check("B2: BOM1 отмечен выполненным (EXCLUDED_BOMS)", excludedDone("BOM1"), true);
check("B3: BOM1 убран из активного дашборда", dashboardBomIds().indexOf("BOM1"), -1);
check("B4: BOM2 остался в дашборде", dashboardBomIds().join("|"), "BOM2");
check("B5: в очереди нет неприменённых намерений", pendingRows().length, 0);

console.log("=== C: некомплектованный BOM отметить нельзя (блокировка при применении) ===");
resetPositions();
resetExcluded();
resetQueue();
setRole(C.ROLES.PRODUCTION);
PS._data.push(mkPosition("BOM3", "C3", 1, 5, 0, {}));   // не заказан → не READY
N.v12RefreshDashboard();
const row3 = setDoneChecked("BOM3");
N.v12OnEdit(doneEdit(row3, true));
check("C1: намерение зафиксировано", intents(F.DASHBOARD_DONE).length, 1);
const drainC = N.v12DrainPendingEdits();
check("C2: применений нет", drainC.drained, 0);
check("C3: одно намерение не применено", drainC.failed, 1);
check("C4: BOM3 НЕ отмечен выполненным", excludedDone("BOM3"), false);
check("C5: BOM3 остался в активном дашборде", dashboardBomIds().indexOf("BOM3") >= 0, true);
check("C6: строка очереди помечена FAILED", QS._data[1][Q.STATUS - 1], C.PENDING_STATUS.FAILED);
check("C7: причина в колонке «Ошибка»", String(QS._data[1][Q.ERROR - 1]).indexOf("Готов к работе") >= 0, true);
// Неприменённая отметка не остаётся «висеть»: пересборка дашборда в конце слива
// снова пишет false в колонку «Выполнено» показанных (невыполненных) BOM.
const row3After = dashboardRowOf("BOM3");
check("C8: галочка снята пересборкой дашборда", DB._data[row3After - 1][D.DONE - 1], false);

console.log("=== D: RBAC — роль без DASHBOARD_CHECKBOX правку откатывает ===");
resetPositions();
resetExcluded();
resetQueue();
setRole(C.ROLES.PROCUREMENT);   // нет права DASHBOARD_CHECKBOX
PS._data.push(mkPosition("BOM4", "C4", 1, 5, 5, { received: true, receivedQty: 5 }));
N.v12RefreshDashboard();
const row4 = setDoneChecked("BOM4");
N.v12OnEdit(doneEdit(row4, true, false));   // oldValue=false — откат восстановит false
check("D1: намерение НЕ зафиксировано", intents(F.DASHBOARD_DONE).length, 0);
check("D2: галочка откатана (false)", DB._data[row4 - 1][D.DONE - 1], false);
check("D3: BOM4 не выполнен", excludedDone("BOM4"), false);
setRole(C.ROLES.ADMIN);

console.log("=== E: пересборка очереди добирает галочку по факту (потерянный onEdit) ===");
resetPositions();
resetExcluded();
resetQueue();
setRole(C.ROLES.PRODUCTION);
PS._data.push(mkPosition("BOM5", "C5", 1, 5, 5, { received: true, receivedQty: 5 }));
N.v12RefreshDashboard();
setDoneChecked("BOM5");   // галочка стоит, а события onEdit НЕ было
check("E1: очередь пуста до пересборки", N.v12HasPendingEdits(), false);
N.v12RebuildPendingFromChecked();
check("E2: пересборка добавила намерение DASHBOARD_DONE", intents(F.DASHBOARD_DONE).length, 1);
check("E3: pid = BOM5", intents(F.DASHBOARD_DONE)[0].pid, "BOM5");
N.v12RebuildPendingFromChecked();
check("E4: повторная пересборка не плодит дубли", pendingRows().length, 1);
const drainE = N.v12DrainPendingEdits();
check("E5: намерение применено", drainE.drained >= 1, true);
check("E6: BOM5 выполнен и убран из дашборда", excludedDone("BOM5"), true);
check("E7: BOM5 нет в активном дашборде", dashboardBomIds().indexOf("BOM5"), -1);

console.log("=== F: отмена «Выполнено» возвращает проект в активный дашборд ===");
// После применения строка уходит из дашборда, поэтому снять галочку в нём
// нельзя: отмену выполняет пункт меню «Вернуть проект в Dashboard»
// (v12PromptUndoBomDone → v12SetBomDone(bomId, false)).
check("F1: BOM5 сейчас вне активного дашборда", dashboardBomIds().indexOf("BOM5"), -1);
const undo = N.v12SetBomDone("BOM5", false);
check("F2: отмена применена", undo.status, "applied");
check("F3: BOM5 больше не выполнен", excludedDone("BOM5"), false);
check("F4: BOM5 вернулся в активный дашборд", dashboardBomIds().indexOf("BOM5") >= 0, true);
const undoAgain = N.v12SetBomDone("BOM5", false);
check("F5: повторная отмена идемпотентна", undoAgain.status, "already");
check("F6: BOM5 по-прежнему в дашборде", dashboardBomIds().indexOf("BOM5") >= 0, true);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
