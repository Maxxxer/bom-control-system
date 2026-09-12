/**
 * ЛОКАЛЬНЫЙ тест редизайна листа Dashboard.
 *
 * Проверяет:
 *   D) Схема дашборда: 9 колонок, нет «Прогресс»/«Обновлено»,
 *      «Недостающие материалы», палитра прогресса;
 *   E) Текст статуса (процент + прогрессбар) и цвет «от красного к зелёному»;
 *   F) Текст недостающих материалов: формат «кол-во - модель - дата» и
 *      сортировка по ожидаемому сроку по убыванию (самый поздний сверху);
 *   G) Сборка листа: процент в «Статусе», крайний срок только датой,
 *      многострочный столбец «Недостающие материалы»;
 *   H) Гейт «Выполнено»: готовность считается из состояния.
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
    setColumnWidth() {}, hideColumns() {}, showColumns() {}, deleteColumn() {},
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
  + " v12DashboardStatusText: v12DashboardStatusText, v12DashboardPercentColor: v12DashboardPercentColor,"
  + " v12IsBomReadyForDone: v12IsBomReadyForDone, v12FormatDateOnly: v12FormatDateOnly,"
  + " v12MarkReceivedByProduction: v12MarkReceivedByProduction };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const D = C.DASHBOARD_COLUMNS;

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

// RBAC в тесте не проверяем — считаем пользователя администратором (иначе
// v12MarkReceivedByProduction бросит «нет права PICKING_CHECKBOX»).
globalThis.v12GetCurrentUserRole = function () { return C.ROLES.ADMIN; };
globalThis.v12RequireRole = function () {};
globalThis.v12CanEditField = function () { return true; };

const PS = sheets[C.SHEETS.POSITION_STATE];
const DB = sheets[C.SHEETS.DASHBOARD];

function mkPosition(bomId, code, idx, required, reserved, opts) {
  const o = opts || {};
  return N.v12BuildPositionRow(bomId, {
    bomName: bomId, row: idx, code: code, name: "M-" + code, model: o.model || "M1", unit: "шт",
    requiredQty: required, reservedQty: reserved, deadline: o.deadline || ""
  }, bomId + ":" + code, 1, {
    orderedQty: o.ordered || 0,
    expectedDate: o.expectedDate || "",
    receivedByProduction: o.received || false,
    receivedByProductionQty: o.receivedQty || 0
  });
}

function resetPositions() { PS._data = [C.HEADERS.POSITION_STATE.slice()]; }

// ---------- D) Схема ----------
console.log("=== D: схема Dashboard ===");
check("D1: COLUMN_COUNT.DASHBOARD = 9", C.COLUMN_COUNT.DASHBOARD, 9);
check("D2: HEADERS.DASHBOARD длина = 9", C.HEADERS.DASHBOARD.length, 9);
check("D3: последний заголовок = «Недостающие материалы»", C.HEADERS.DASHBOARD[8], "Недостающие материалы");
check("D4: нет ключа PROGRESS", Object.prototype.hasOwnProperty.call(D, "PROGRESS"), false);
check("D5: нет ключа UPDATED_AT", Object.prototype.hasOwnProperty.call(D, "UPDATED_AT"), false);
check("D6: MISSING_ITEMS = 9", D.MISSING_ITEMS, 9);

// ---------- E) Статус: процент + прогрессбар и цвет ----------
console.log("=== E: статус (процент + прогрессбар, красный→зелёный) ===");
check("E1: 0% → пустой бар", N.v12DashboardStatusText(0), "0% \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591");
check("E2: 100% → полный бар", N.v12DashboardStatusText(100), "100% \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588");
check("E3: 40% → 4 сегмента", N.v12DashboardStatusText(40), "40% \u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591\u2591\u2591");
check("E4: 0% → красный", N.v12DashboardPercentColor(0), C.COLORS.PROGRESS_LOW);
check("E5: 50% → жёлтый", N.v12DashboardPercentColor(50), C.COLORS.PROGRESS_MID);
check("E6: 100% → зелёный", N.v12DashboardPercentColor(100), C.COLORS.PROGRESS_HIGH);

// ---------- F) Текст недостающих материалов ----------
console.log("=== F: недостающие материалы (формат + сортировка) ===");
const missingText = N.v12BuildMissingItemsText([
  { qty: 1, model: "A", expectedDate: "2026-10-01" },
  { qty: 2, model: "B", expectedDate: "2026-12-01" },
  { qty: 3, model: "C", expectedDate: "" }
]);
check("F1: сортировка по сроку убыв. + без даты в конце",
  missingText,
  "2 - B - 01.12.2026\n1 - A - 01.10.2026\n3 - C");
check("F2: пустой список → пустая строка", N.v12BuildMissingItemsText([]), "");

// ---------- G) Сборка листа ----------
console.log("=== G: сборка строки дашборда ===");
resetPositions();
// BOM1: C1 — дефицит (не собрано), C2 — передано производству (собрано).
PS._data.push(mkPosition("BOM1", "C1", 1, 10, 0, { expectedDate: "2026-10-01", deadline: "2026-09-01" }));
PS._data.push(mkPosition("BOM1", "C2", 2, 5, 5, { received: true, receivedQty: 5, deadline: "2026-09-01" }));
N.v12RefreshDashboard();

check("G1: BOM ID", DB.getRange(2, D.BOM_ID).getValue(), "BOM1");
check("G2: всего позиций", DB.getRange(2, D.TOTAL_POSITIONS).getValue(), 2);
check("G3: собрано", DB.getRange(2, D.COLLECTED_POSITIONS).getValue(), 1);
check("G4: статус = 50% + бар", DB.getRange(2, D.STATUS).getValue(), "50% \u2588\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591\u2591");
check("G5: крайний срок только датой", DB.getRange(2, D.DEADLINE).getValue(), "01.09.2026");
check("G6: недостающие материалы", DB.getRange(2, D.MISSING_ITEMS).getValue(), "10 - M1 - 01.10.2026");
check("G7: нота статуса = текст недостач",
  DB.getRange(2, D.STATUS).getValue() !== "" && DB._notes && DB._notes[0] === "10 - M1 - 01.10.2026", true);

// ---------- H) Гейт «Выполнено» ----------
console.log("=== H: гейт готовности (по состоянию, не по тексту) ===");
check("H1: не готов (есть несобранные)", N.v12IsBomReadyForDone("BOM1"), false);
resetPositions();
PS._data.push(mkPosition("BOM2", "D1", 1, 5, 5, { received: true, receivedQty: 5, deadline: "2026-09-01" }));
check("H2: готов (все собраны)", N.v12IsBomReadyForDone("BOM2"), true);
check("H3: неизвестный BOM → не готов", N.v12IsBomReadyForDone("NOPE"), false);

// ---------- I) Регрессия: передача производству обновляет Dashboard ----------
// Причина исходного дефекта: v12MarkReceivedByProduction писал только сырые
// поля и НЕ пересчитывал производные (PRODUCTION_STATE/DEFICIT_QTY), поэтому
// Dashboard (считает по производным) не обновлялся после «Отметка получено».
console.log("=== I: передача производству обновляет Dashboard ===");
const P = C.POSITION_COLUMNS;
resetPositions();
// Позиция готова к передаче: доступно (reserved) >= требуется.
PS._data.push(mkPosition("BOM3", "E1", 1, 10, 10, { deadline: "2026-09-01" }));
N.v12RefreshDashboard();

check("I1: до передачи productionState = READY_FOR_HANDOFF",
  PS._data[1][P.PRODUCTION_STATE - 1], C.PRODUCTION_STATE.READY_FOR_HANDOFF);
check("I2: до передачи «Собрано» = 0", DB.getRange(2, D.COLLECTED_POSITIONS).getValue(), 0);

const handoff = N.v12MarkReceivedByProduction("BOM3:E1", C.SOURCE_UI.PICKING, false);
check("I3: передача применена", handoff.status, "handoff");
check("I4: POSITION_STATE.PRODUCTION_STATE = RECEIVED (пересчёт производных)",
  PS._data[1][P.PRODUCTION_STATE - 1], C.PRODUCTION_STATE.RECEIVED);
check("I5: Dashboard «Собрано» = 1", DB.getRange(2, D.COLLECTED_POSITIONS).getValue(), 1);
check("I6: Dashboard статус начинается с «100%»",
  String(DB.getRange(2, D.STATUS).getValue()).indexOf("100%") === 0, true);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
