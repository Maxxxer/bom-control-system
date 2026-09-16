/**
 * ЛОКАЛЬНЫЙ тест прав доступа ролей (RBAC).
 *
 * Требование (матрица прав):
 *   Снабженец (PROCUREMENT)  — «Сводка дефицитов»: «Заказано» (ORDERED_QTY)
 *                              и «Ожидаемая поставка» (EXPECTED_DATE);
 *   Экономист (ECONOMIST)    — «Сводка дефицитов»: чекбокс «Реальная поставка»
 *                              (REAL_DELIVERY);
 *   Кладовщик (WAREHOUSE)    — «ОТБОРКА»: чекбоксы (PICKING_CHECKBOX);
 *   Производство (PRODUCTION)— «Dashboard»: чекбоксы (DASHBOARD_CHECKBOX);
 *   Админ (ADMIN)            — всё без ограничений.
 *
 * Проверяется:
 *   R1 — чистая матрица v12CanEditField для каждой роли/поля;
 *   R2 — определение роли по e-mail;
 *   R3 — Сводка дефицитов: снабженец правит «Заказано», но НЕ «Реальную поставку»;
 *        экономист правит «Реальную поставку», но НЕ «Заказано»;
 *   R4 — ОТБОРКА: кладовщик ставит чекбокс; снабженец — отклонён;
 *   R5 — Dashboard: производство фиксирует «Выполнено» в очереди (как чекбоксы
 *        Сводки), применение отмечает BOM выполненным и убирает его из активного
 *        дашборда; экономист — отклонён.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_roles_test.js
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
    getMaxColumns() { return 40; },
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
        setBackgrounds() { return this; }, setBackground() { return this; },
        setFontWeight() { return this; }, setNotes(notes) { self._notes = (notes || []).map(function (r) { return r[0]; }); return this; },
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
  + " v12CanEditField: v12CanEditField, v12GetUserRole: v12GetUserRole,"
  + " v12GetCurrentUserRole: v12GetCurrentUserRole, v12OnEdit: v12OnEdit,"
  + " v12BuildPositionRow: v12BuildPositionRow, v12CountPendingEdits: v12CountPendingEdits,"
  + " v12ResolvePendingIntents: v12ResolvePendingIntents, v12RefreshDashboard: v12RefreshDashboard,"
  + " v12DrainPendingEdits: v12DrainPendingEdits, v12BuildExcludedMap: v12BuildExcludedMap,"
  + " v12EnqueuePendingEdit: v12EnqueuePendingEdit };";

vm.runInThisContext(src, { filename: "v12-bundle-roles.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const R = C.ROLES;

// Тестовые пользователи: по одному на роль.
const U = {
  admin: "admin@test.local",
  economist: "economist@test.local",
  procurement: "procurement@test.local",
  warehouse: "warehouse@test.local",
  production: "production@test.local",
  viewer: "viewer@test.local"
};
V12_ROLE_MAP[U.admin] = R.ADMIN;
V12_ROLE_MAP[U.economist] = R.ECONOMIST;
V12_ROLE_MAP[U.procurement] = R.PROCUREMENT;
V12_ROLE_MAP[U.warehouse] = R.WAREHOUSE;
V12_ROLE_MAP[U.production] = R.PRODUCTION;
V12_ROLE_MAP[U.viewer] = R.VIEWER;

const D = C.DEFICIT_COLUMNS;
const K = C.PICKING_COLUMNS;
const Q = C.PENDING_EDIT_COLUMNS;
const DB = C.DASHBOARD_COLUMNS;
const P = C.POSITION_COLUMNS;

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION",
 "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM",
 "EVENT_LOG", "PENDING_EDITS", "BOM_REGISTRY", "SYSTEM_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const DS = sheets[C.SHEETS.DEFICIT_SUMMARY];
const PK = sheets[C.SHEETS.PICKING];
const QS = sheets[C.SHEETS.PENDING_EDITS];
const DBs = sheets[C.SHEETS.DASHBOARD];
const EX = sheets[C.SHEETS.EXCLUDED_BOMS];

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

function asUser(email) { globalThis.__testUser = email; }
function resetQueue() { QS._data = [C.HEADERS.PENDING_EDITS.slice()]; }
function queuePending() {
  let n = 0;
  for (let i = 1; i < QS._data.length; i++) {
    if (String(QS._data[i][Q.STATUS - 1]).trim() === C.PENDING_STATUS.PENDING) { n++; }
  }
  return n;
}
function firstPending() {
  for (let i = 1; i < QS._data.length; i++) {
    if (String(QS._data[i][Q.STATUS - 1]).trim() === C.PENDING_STATUS.PENDING) { return QS._data[i]; }
  }
  return null;
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
// Сбрасываются ОБА «списочных» листа с чекбоксами (сводка + ОТБОРКА) вместе:
// иначе оставленная галочка на одном листе попадёт в пересборку очереди
// (v12RebuildPendingFromChecked) при правке чекбокса на другом и создаст
// лишнее намерение, которого роль не делала.
function resetListSheets() {
  DS._data = [C.HEADERS.DEFICIT_SUMMARY.slice()];
  DS._data.push(deficitRow("B1:C1"));
  PK._data = [C.HEADERS.PICKING.slice()];
  PK._data.push(pickRow("B1:C1"));
}
function resetDeficit() { resetListSheets(); }
function resetPicking() { resetListSheets(); }
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
function mkReadyPosition(bomId, code) {
  return N.v12BuildPositionRow(bomId, {
    bomName: bomId, row: 1, code: code, name: "M-" + code, model: "M1", unit: "шт",
    requiredQty: 5, reservedQty: 5, deadline: "2026-09-01"
  }, bomId + ":" + code, 1, { receivedByProduction: true, receivedByProductionQty: 5 });
}
function findDashRow(bomId) {
  for (let i = 1; i < DBs._data.length; i++) {
    if (String(DBs._data[i][DB.BOM_ID - 1]) === bomId) { return i + 1; }
  }
  return -1;
}
function resetDashboard() {
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  PS._data.push(mkReadyPosition("B1", "C1"));
  EX._data = [C.HEADERS.EXCLUDED_BOMS.slice()];
  N.v12RefreshDashboard();
}

// ---------- R1: чистая матрица прав ----------
console.log("=== R1: матрица прав v12CanEditField ===");
const CC = N.v12CanEditField;

check("R1: PROCUREMENT → ORDERED_QTY", CC(R.PROCUREMENT, "ORDERED_QTY"), true);
check("R1: PROCUREMENT → EXPECTED_DATE", CC(R.PROCUREMENT, "EXPECTED_DATE"), true);
check("R1: PROCUREMENT ✗ REAL_DELIVERY", CC(R.PROCUREMENT, "REAL_DELIVERY"), false);
check("R1: PROCUREMENT ✗ PICKING_CHECKBOX", CC(R.PROCUREMENT, "PICKING_CHECKBOX"), false);
check("R1: PROCUREMENT ✗ DASHBOARD_CHECKBOX", CC(R.PROCUREMENT, "DASHBOARD_CHECKBOX"), false);

check("R1: ECONOMIST → REAL_DELIVERY", CC(R.ECONOMIST, "REAL_DELIVERY"), true);
check("R1: ECONOMIST ✗ ORDERED_QTY", CC(R.ECONOMIST, "ORDERED_QTY"), false);
check("R1: ECONOMIST ✗ EXPECTED_DATE", CC(R.ECONOMIST, "EXPECTED_DATE"), false);
check("R1: ECONOMIST ✗ DASHBOARD_CHECKBOX", CC(R.ECONOMIST, "DASHBOARD_CHECKBOX"), false);

check("R1: WAREHOUSE → PICKING_CHECKBOX", CC(R.WAREHOUSE, "PICKING_CHECKBOX"), true);
check("R1: WAREHOUSE → WAREHOUSE_QTY", CC(R.WAREHOUSE, "WAREHOUSE_QTY"), true);
check("R1: WAREHOUSE ✗ DASHBOARD_CHECKBOX", CC(R.WAREHOUSE, "DASHBOARD_CHECKBOX"), false);
check("R1: WAREHOUSE ✗ ORDERED_QTY", CC(R.WAREHOUSE, "ORDERED_QTY"), false);

check("R1: PRODUCTION → DASHBOARD_CHECKBOX", CC(R.PRODUCTION, "DASHBOARD_CHECKBOX"), true);
check("R1: PRODUCTION → WORKING_BOM_CHECKBOX", CC(R.PRODUCTION, "WORKING_BOM_CHECKBOX"), true);
check("R1: PRODUCTION → PICKING_CHECKBOX", CC(R.PRODUCTION, "PICKING_CHECKBOX"), true);
check("R1: PRODUCTION ✗ ORDERED_QTY", CC(R.PRODUCTION, "ORDERED_QTY"), false);
check("R1: PRODUCTION ✗ REAL_DELIVERY", CC(R.PRODUCTION, "REAL_DELIVERY"), false);

["ORDERED_QTY", "EXPECTED_DATE", "REAL_DELIVERY", "PICKING_CHECKBOX", "WORKING_BOM_CHECKBOX", "DASHBOARD_CHECKBOX", "WAREHOUSE_QTY"]
  .forEach(function (a) { check("R1: ADMIN → " + a, CC(R.ADMIN, a), true); });
["ORDERED_QTY", "REAL_DELIVERY", "PICKING_CHECKBOX", "DASHBOARD_CHECKBOX"]
  .forEach(function (a) { check("R1: VIEWER ✗ " + a, CC(R.VIEWER, a), false); });
check("R1: неизвестная роль ✗ ORDERED_QTY", CC("", "ORDERED_QTY"), false);

// ---------- R2: роль по e-mail ----------
console.log("=== R2: определение роли ===");
check("R2: снабженец", N.v12GetUserRole(U.procurement), R.PROCUREMENT);
check("R2: экономист", N.v12GetUserRole(U.economist), R.ECONOMIST);
check("R2: кладовщик", N.v12GetUserRole(U.warehouse), R.WAREHOUSE);
check("R2: производство", N.v12GetUserRole(U.production), R.PRODUCTION);
check("R2: админ", N.v12GetUserRole(U.admin), R.ADMIN);
check("R2: неизвестный e-mail → пусто", N.v12GetUserRole("nobody@test.local"), "");
asUser(U.production);
check("R2: текущая роль = PRODUCTION", N.v12GetCurrentUserRole(), R.PRODUCTION);

// ---------- R3: Сводка дефицитов ----------
console.log("=== R3: «Сводка дефицитов» — права ===");
asUser(U.procurement);
resetQueue(); resetDeficit();
N.v12OnEdit(cellEvent(DS, 2, D.ORDERED_QTY, 5));
check("R3: снабженец — «Заказано» в очереди", queuePending(), 1);
check("R3: поле намерения = ORDERED_QTY", firstPending()[Q.FIELD - 1], "ORDERED_QTY");

resetQueue();
DS._setCell(2, D.REAL_DELIVERY, true);
N.v12OnEdit(cellEvent(DS, 2, D.REAL_DELIVERY, true, false));
check("R3: снабженец — «Реальная поставка» отклонена (очередь пуста)", queuePending(), 0);
check("R3: чекбокс «Реальная поставка» откатан в false", DS.getRange(2, D.REAL_DELIVERY).getValue(), false);

asUser(U.economist);
resetQueue(); resetDeficit();
DS._setCell(2, D.REAL_DELIVERY, true);
N.v12OnEdit(cellEvent(DS, 2, D.REAL_DELIVERY, true, false));
check("R3: экономист — «Реальная поставка» в очереди", queuePending(), 1);
check("R3: поле намерения = REAL_DELIVERY", firstPending()[Q.FIELD - 1], "REAL_DELIVERY");

resetQueue();
N.v12OnEdit(cellEvent(DS, 2, D.ORDERED_QTY, 5, 0));
check("R3: экономист — «Заказано» отклонено (очередь пуста)", queuePending(), 0);

asUser(U.viewer);
resetQueue();
N.v12OnEdit(cellEvent(DS, 2, D.ORDERED_QTY, 9, 0));
check("R3: наблюдатель — «Заказано» отклонено", queuePending(), 0);

// ---------- R4: ОТБОРКА ----------
console.log("=== R4: «ОТБОРКА» — права ===");
asUser(U.warehouse);
resetQueue(); resetPicking();
PK._setCell(2, K.CHECKBOX, true);
N.v12OnEdit(cellEvent(PK, 2, K.CHECKBOX, true, false));
check("R4: кладовщик — чекбокс в очереди", queuePending(), 1);
check("R4: поле намерения = HANDOFF", firstPending()[Q.FIELD - 1], "HANDOFF");
check("R4: источник = PICKING", firstPending()[Q.SOURCE - 1], "PICKING");

asUser(U.procurement);
resetQueue(); resetPicking();
PK._setCell(2, K.CHECKBOX, false);
N.v12OnEdit(cellEvent(PK, 2, K.CHECKBOX, true, false));
check("R4: снабженец — чекбокс ОТБОРКИ отклонён (очередь пуста)", queuePending(), 0);

asUser(U.production);
resetQueue(); resetPicking();
PK._setCell(2, K.CHECKBOX, true);
N.v12OnEdit(cellEvent(PK, 2, K.CHECKBOX, true, false));
check("R4: производство — чекбокс ОТБОРКИ в очереди", queuePending(), 1);

// ---------- R5: Dashboard ----------
// Чекбокс «Выполнено» обрабатывается ТАК ЖЕ, как чекбоксы «Сводки дефицитов»:
// onEdit только фиксирует намерение DASHBOARD_DONE в очереди PENDING_EDITS, а
// применяет его кнопка «ПРИМЕНИТЬ» (v12ApplyChanges → v12DrainPendingEdits).
// После применения BOM попадает в EXCLUDED_BOMS и УХОДИТ из активного дашборда.
console.log("=== R5: «Dashboard» — права ===");
asUser(U.production);
resetListSheets(); resetQueue(); resetDashboard();
{
  const row = findDashRow("B1");
  check("R5: строка дашборда найдена", row > 1, true);
  DBs._setCell(row, DB.DONE, true);
  N.v12OnEdit(cellEvent(DBs, row, DB.DONE, true, false));
  check("R5: производство — намерение DASHBOARD_DONE зафиксировано", queuePending(), 1);
  check("R5: поле намерения = DASHBOARD_DONE", firstPending()[Q.FIELD - 1], "DASHBOARD_DONE");
  check("R5: источник намерения = DASHBOARD", firstPending()[Q.SOURCE - 1], "DASHBOARD");
  check("R5: до применения BOM ещё в активном дашборде", findDashRow("B1") > 1, true);
  const drain = N.v12DrainPendingEdits();
  check("R5: производство — «Выполнено» применено", drain.drained >= 1, true);
  check("R5: BOM отмечен выполненным (EXCLUDED_BOMS)", N.v12BuildExcludedMap()["B1"] === true, true);
  check("R5: BOM убран из активного дашборда", findDashRow("B1"), -1);
  check("R5: очередь очищена", queuePending(), 0);
}

asUser(U.economist);
resetListSheets(); resetQueue(); resetDashboard();
{
  const row = findDashRow("B1");
  DBs._setCell(row, DB.DONE, true);
  N.v12OnEdit(cellEvent(DBs, row, DB.DONE, true, false));
  check("R5: экономист — «Выполнено» отклонено (очередь пуста)", queuePending(), 0);
  check("R5: экономист — галочка откатана", DBs.getRange(row, DB.DONE).getValue(), false);
}

asUser(U.admin);
resetListSheets(); resetQueue(); resetDashboard();
{
  const row = findDashRow("B1");
  DBs._setCell(row, DB.DONE, true);
  N.v12OnEdit(cellEvent(DBs, row, DB.DONE, true, false));
  check("R5: админ — намерение DASHBOARD_DONE зафиксировано", queuePending(), 1);
  const drain = N.v12DrainPendingEdits();
  check("R5: админ — «Выполнено» применено", drain.drained >= 1, true);
  check("R5: админ — BOM убран из активного дашборда", findDashRow("B1"), -1);
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
