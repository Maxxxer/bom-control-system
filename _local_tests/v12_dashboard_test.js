/**
 * ЛОКАЛЬНЫЙ тест дашборда V12 (колонка «Статус» + «На складе»).
 *
 * Проверяет:
 *   D) Схема дашборда: 10 колонок, «На складе» после «Позиций»,
 *      «Недостающие материалы» последняя, нет «Прогресс»/«Обновлено»;
 *   E) Цвет статуса BOM по состоянию (BOM_STATUS_COLOR);
 *   F) Текст «Недостающие материалы»: список недостач и отметка «Скомплектовано»;
 *   G) Определение BOM-статуса по агрегату (5 состояний + «Ошибка данных»);
 *   H) Сборка строки дашборда (статус/«На складе»/«Собрано»);
 *   I) Гейт «Выполнено» и отметка «Скомплектовано» после передачи производству.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm), НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_dashboard_test.js
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
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, v12BuildPositionRow: v12BuildPositionRow,"
  + " v12RefreshDashboard: v12RefreshDashboard, v12AggregateBomStates: v12AggregateBomStates,"
  + " v12ComputeBomStatus: v12ComputeBomStatus, v12BuildMissingItemsText: v12BuildMissingItemsText,"
  + " v12BomStatusColor: v12BomStatusColor, v12FormatDateTime: v12FormatDateTime,"
  + " v12BuildDashboardMissingCell: v12BuildDashboardMissingCell, v12ProcurementOutcome: v12ProcurementOutcome,"
  + " v12IsBomReadyForDone: v12IsBomReadyForDone, v12FormatDateOnly: v12FormatDateOnly,"
  + " v12MarkReceivedByProduction: v12MarkReceivedByProduction };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const D = C.DASHBOARD_COLUMNS;
const P = C.POSITION_COLUMNS;
const BS = C.BOM_STATUS;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

["POSITION_STATE", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "DEFICIT_SUMMARY",
  "PICKING", "WORKING_BOM", "SUPPLY", "ARCHIVE", "MATERIAL_STATE",
  "MATERIAL_HISTORY", "AUDIT_LOG", "EVENT_LOG"].forEach(function (k) {
  makeSheet(C.SHEETS[k], C.HEADERS[k]);
});

// RBAC в тесте не проверяем — считаем пользователя администратором.
globalThis.v12GetCurrentUserRole = function () { return C.ROLES.ADMIN; };
globalThis.v12RequireRole = function () {};
globalThis.v12CanEditField = function () { return true; };

const PS = sheets[C.SHEETS.POSITION_STATE];
const DB = sheets[C.SHEETS.DASHBOARD];

function mkPosition(bomId, code, idx, required, reserved, opts) {
  const o = opts || {};
  return N.v12BuildPositionRow(bomId, {
    bomName: bomId, row: idx, code: code, name: "M-" + code, model: o.model === undefined ? "M1" : o.model,
    unit: "шт", requiredQty: required, reservedQty: reserved, deadline: o.deadline || ""
  }, bomId + ":" + code, 1, {
    orderedQty: o.ordered || 0,
    expectedDate: o.expectedDate || "",
    receivedByProduction: o.received || false,
    receivedByProductionQty: o.receivedQty || 0
  });
}

function resetPositions() { PS._data = [C.HEADERS.POSITION_STATE.slice()]; }

function statusOf(data) {
  const agg = N.v12AggregateBomStates(data);
  return N.v12ComputeBomStatus(agg["BOM1"]);
}

// ---------- D) Схема ----------
console.log("=== D: схема Dashboard ===");
check("D1: COLUMN_COUNT.DASHBOARD = 10", C.COLUMN_COUNT.DASHBOARD, 10);
check("D2: HEADERS.DASHBOARD длина = 10", C.HEADERS.DASHBOARD.length, 10);
check("D3: последний заголовок = «Недостающие материалы»", C.HEADERS.DASHBOARD[9], "Недостающие материалы");
check("D4: ON_SHELF = 6", D.ON_SHELF, 6);
check("D5: заголовок колонки 6 = «На складе»", C.HEADERS.DASHBOARD[5], "На складе");
check("D6: MISSING_ITEMS = 10", D.MISSING_ITEMS, 10);
check("D7: нет ключа PROGRESS", Object.prototype.hasOwnProperty.call(D, "PROGRESS"), false);
check("D8: нет ключа UPDATED_AT", Object.prototype.hasOwnProperty.call(D, "UPDATED_AT"), false);

// ---------- E) Цвет статуса ----------
console.log("=== E: цвет статуса BOM ===");
check("E1: незаказанные → красный", N.v12BomStatusColor(BS.NOT_ORDERED), C.COLORS.RED);
check("E2: опаздывает → оранжевый", N.v12BomStatusColor(BS.WAITING_LATE), C.COLORS.ORANGE);
check("E3: в срок → жёлтый", N.v12BomStatusColor(BS.WAITING_ON_TIME), C.COLORS.YELLOW);
check("E4: на складе → голубой", N.v12BomStatusColor(BS.ON_SHELF), C.COLORS.STOCK);
check("E5: скомплектован → зелёный", N.v12BomStatusColor(BS.READY), C.COLORS.GREEN);
check("E6: ошибка данных → серый", N.v12BomStatusColor(BS.ERROR), C.COLORS.GRAY);
check("E7: неизвестный статус → белый", N.v12BomStatusColor("???"), C.COLORS.WHITE);

// ---------- F) «Недостающие материалы» ----------
console.log("=== F: недостающие материалы / Скомплектовано ===");
const missingText = N.v12BuildMissingItemsText([
  { qty: 1, model: "A", expectedDate: "2026-10-01" },
  { qty: 2, model: "B", expectedDate: "2026-12-01" },
  { qty: 3, model: "C", expectedDate: "" }
]);
check("F1: список недостач (сортировка по сроку убыв.)",
  missingText,
  "2 - B - 01.12.2026\n1 - A - 01.10.2026\n3 - C");
check("F2: пустой список → пустая строка", N.v12BuildMissingItemsText([]), "");
check("F3: формат даты-времени", N.v12FormatDateTime(new Date(2026, 8, 10, 14, 30)), "10.09.2026 14:30");
check("F4: собран BOM → «Скомплектовано - дата/время»",
  N.v12BuildDashboardMissingCell({ total: 2, collected: 2, maxReceivedAt: new Date(2026, 8, 10, 14, 30), missing: [] }),
  "Скомплектовано - 10.09.2026 14:30");
check("F5: собран, но время неизвестно → «Скомплектовано»",
  N.v12BuildDashboardMissingCell({ total: 2, collected: 2, maxReceivedAt: null, missing: [] }),
  "Скомплектовано");
check("F6: собран не полностью → список недостач",
  N.v12BuildDashboardMissingCell({ total: 2, collected: 1, maxReceivedAt: null, missing: [{ qty: 1, model: "A", expectedDate: "" }] }),
  "1 - A");

// ---------- G) Определение статуса ----------
console.log("=== G: определение BOM-статуса ===");
resetPositions();
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 0, { deadline: "2026-09-01" }));
check("G1: не заказано → «Есть незаказанные компоненты»", statusOf(PS._data), BS.NOT_ORDERED);

resetPositions();
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 0, { ordered: 10, expectedDate: "2026-08-30", deadline: "2026-09-01" }));
check("G2: заказано в срок → «(В срок)»", statusOf(PS._data), BS.WAITING_ON_TIME);

resetPositions();
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 0, { ordered: 10, expectedDate: "2026-09-10", deadline: "2026-09-01" }));
check("G3: заказано, поставка позже → «(Опаздывает)»", statusOf(PS._data), BS.WAITING_LATE);

resetPositions();
// Заказано, но дата ожидаемой поставки не указана → «Есть незаказанные компоненты».
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 0, { ordered: 10, deadline: "2026-09-01" }));
check("G4: заказано без даты → «Есть незаказанные компоненты»", statusOf(PS._data), BS.NOT_ORDERED);

resetPositions();
// Зарезервировано полностью → материал на складе (READY_FOR_HANDOFF).
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 10, { deadline: "2026-09-01" }));
check("G5: всё на складе → «На складе, ждет отборки»", statusOf(PS._data), BS.ON_SHELF);

resetPositions();
PS._data.push(mkPosition("BOM1", "C1", 1, 5, 5, { received: true, receivedQty: 5, deadline: "2026-09-01" }));
check("G6: всё получено → «Скомплектован, готов к работе»", statusOf(PS._data), BS.READY);

resetPositions();
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 0, { model: "", deadline: "2026-09-01" }));
check("G7: ошибка данных → «Ошибка данных»", statusOf(PS._data), BS.ERROR);

// Частично: одна на складе, одна не заказана → красный (не все на складе).
resetPositions();
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 10, { deadline: "2026-09-01" }));
PS._data.push(mkPosition("BOM1", "C2", 2, 10, 0, { deadline: "2026-09-01" }));
check("G8: часть на складе, часть не заказана → красный", statusOf(PS._data), BS.NOT_ORDERED);

// ---------- H) Сборка строки дашборда ----------
console.log("=== H: сборка строки дашборда ===");
resetPositions();
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 10, { deadline: "2026-09-01" }));
PS._data.push(mkPosition("BOM1", "C2", 2, 10, 0, { deadline: "2026-09-01" }));
N.v12RefreshDashboard();

check("H1: BOM ID", DB.getRange(2, D.BOM_ID).getValue(), "BOM1");
check("H2: всего позиций", DB.getRange(2, D.TOTAL_POSITIONS).getValue(), 2);
check("H3: «На складе» = 1", DB.getRange(2, D.ON_SHELF).getValue(), 1);
check("H4: «Собрано» = 0", DB.getRange(2, D.COLLECTED_POSITIONS).getValue(), 0);
check("H5: статус = «Есть незаказанные компоненты»", DB.getRange(2, D.STATUS).getValue(), BS.NOT_ORDERED);
check("H6: крайний срок только датой", DB.getRange(2, D.DEADLINE).getValue(), "01.09.2026");
check("H7: недостающие материалы (только дефицитная позиция)",
  DB.getRange(2, D.MISSING_ITEMS).getValue(), "10 - M1");

// ---------- I) Скомплектован + гейт «Выполнено» ----------
console.log("=== I: комплектация и гейт «Выполнено» ===");
check("I1: не готов (есть несобранные)", N.v12IsBomReadyForDone("BOM1"), false);

resetPositions();
const posReady = mkPosition("BOM2", "D1", 1, 5, 5, { received: true, receivedQty: 5, deadline: "2026-09-01" });
posReady[P.RECEIVED_BY_PRODUCTION_AT - 1] = new Date(2026, 8, 10, 14, 30);
PS._data.push(posReady);
N.v12RefreshDashboard();

check("I2: статус собранного BOM", DB.getRange(2, D.STATUS).getValue(), BS.READY);
check("I3: «Собрано» = 1", DB.getRange(2, D.COLLECTED_POSITIONS).getValue(), 1);
check("I4: «На складе» = 0", DB.getRange(2, D.ON_SHELF).getValue(), 0);
check("I5: отметка «Скомплектовано - дата/время»",
  DB.getRange(2, D.MISSING_ITEMS).getValue(), "Скомплектовано - 10.09.2026 14:30");
check("I6: готов к «Выполнено»", N.v12IsBomReadyForDone("BOM2"), true);
check("I7: неизвестный BOM → не готов", N.v12IsBomReadyForDone("NOPE"), false);

// ---------- J) Регрессия: передача производству обновляет Dashboard ----------
console.log("=== J: передача производству обновляет Dashboard ===");
resetPositions();
PS._data.push(mkPosition("BOM3", "E1", 1, 10, 10, { deadline: "2026-09-01" }));
N.v12RefreshDashboard();
check("J1: до передачи productionState = READY_FOR_HANDOFF",
  PS._data[1][P.PRODUCTION_STATE - 1], C.PRODUCTION_STATE.READY_FOR_HANDOFF);
check("J2: до передачи «На складе» = 1", DB.getRange(2, D.ON_SHELF).getValue(), 1);

const handoff = N.v12MarkReceivedByProduction("BOM3:E1", C.SOURCE_UI.PICKING, false);
check("J3: передача применена", handoff.status, "handoff");
check("J4: POSITION_STATE.PRODUCTION_STATE = RECEIVED",
  PS._data[1][P.PRODUCTION_STATE - 1], C.PRODUCTION_STATE.RECEIVED);
check("J5: Dashboard «Собрано» = 1", DB.getRange(2, D.COLLECTED_POSITIONS).getValue(), 1);
check("J6: Dashboard статус = «Скомплектован, готов к работе»", DB.getRange(2, D.STATUS).getValue(), BS.READY);
check("J7: в «Недостающие материалы» — «Скомплектовано …»",
  String(DB.getRange(2, D.MISSING_ITEMS).getValue()).indexOf("Скомплектовано") === 0, true);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
