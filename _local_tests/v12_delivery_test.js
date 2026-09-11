/**
 * ЛОКАЛЬНЫЙ диагностический тест цепочки «Реальная поставка»
 * (чекбокс в сводке дефицитов).
 *
 * ВАЖНО: этот файл — Node-скрипт (require/vm) и НЕ должен выгружаться
 * в Apps Script. Он лежит в _local_tests/ и исключён через .claspignore.
 *
 * Запуск из корня проекта: node _local_tests/v12_delivery_test.js
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
globalThis.Session = { getActiveUser() { return { getEmail() { return "test@example.com"; } }; } };
globalThis.Utilities = { getUuid() { return "uuid-" + Math.random().toString(16).slice(2); } };
globalThis.logSystem = function () {};
globalThis.flushSystemLog = function () {};
globalThis.v12MarkReceivedByProduction = function () { return { status: "ok" }; };

const files = [
  "v12_config.js", "utils.js", "sheet_service.js", "v12_utils.js", "v12_calculate.js",
  "v12_position_state.js", "v12_material_state.js", "v12_audit.js", "v12_roles.js",
  "v12_source.js", "v12_sheet_service.js", "v12_projections.js", "v12_operations.js",
  "v12_handoff.js", "v12_change_engine.js", "v12_events.js", "lock.js", "v12_trigger.js"
];

const src = files.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n")
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, v12BuildPositionRow: v12BuildPositionRow,"
  + " v12RefreshDeficitSummary: v12RefreshDeficitSummary, v12OnEdit: v12OnEdit,"
  + " v12SetRealDeliveryQty: v12SetRealDeliveryQty, v12IsDeficitRowActive: v12IsDeficitRowActive,"
  + " v12GetDeficitRequiredQty: v12GetDeficitRequiredQty };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;

// Перехватываем передачу производству (записываем вызовы) — чтобы проверить
// обход ВСЕХ строк в массовом обработчике ОТБОРКИ без реальной архивации.
globalThis.__handoffCalls = [];
globalThis.v12MarkReceivedByProduction = function (positionId, sourceUI, skipRefresh) {
  globalThis.__handoffCalls.push({ positionId: positionId, sourceUI: sourceUI, skipRefresh: skipRefresh });
  return { status: "ok" };
};

["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "PICKING", "WORKING_BOM", "EVENT_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

const PS = sheets[C.SHEETS.POSITION_STATE];
const DS = sheets[C.SHEETS.DEFICIT_SUMMARY];
const P = C.POSITION_COLUMNS;
const D = C.DEFICIT_COLUMNS;
const IDS = ["BOM1:C1", "BOM1:C2", "BOM1:C3"];

function mkRow(code, idx, ordered) {
  return N.v12BuildPositionRow("BOM1", {
    bomName: "BOM1", row: idx, code: code, name: "M-" + code, model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 3, deadline: "2026-09-01"
  }, "BOM1:" + code, 1, { orderedQty: ordered });
}
function reset(ordered) {
  PS._data = [];
  PS._data.push(C.HEADERS.POSITION_STATE.slice());
  for (let i = 0; i < IDS.length; i++) { PS._data.push(mkRow("C" + (i + 1), i + 1, ordered)); }
  sheets[C.SHEETS.MATERIAL_STATE]._data = [C.HEADERS.MATERIAL_STATE.slice()];
  DS._data = [];
  DS._data.push(C.HEADERS.DEFICIT_SUMMARY.slice());
  N.v12RefreshDeficitSummary();
}

function dsHas(id) { for (let i = 1; i < DS._data.length; i++) { if (DS._data[i][D.POSITION_ID - 1] === id) { return true; } } return false; }
function dsRowNum(id) { for (let i = 1; i < DS._data.length; i++) { if (DS._data[i][D.POSITION_ID - 1] === id) { return i + 1; } } return -1; }
function psCell(id, col) { for (let i = 1; i < PS._data.length; i++) { if (PS._data[i][P.POSITION_ID - 1] === id) { return PS._data[i][col - 1]; } } return undefined; }

function checkEvent(col, val, row) {
  return { range: { getSheet() { return DS; }, getRow() { return row; }, getColumn() { return col; }, getNumRows() { return 1; }, getNumColumns() { return 1; }, getValue() { return val; }, setValue(v) { DS._setCell(row, col, v); } }, value: val };
}
function rangeEvent(col, values, firstRow) {
  return { range: { getSheet() { return DS; }, getRow() { return firstRow; }, getColumn() { return col; }, getNumRows() { return values.length; }, getNumColumns() { return values[0].length; }, getValues() { return values; }, setValue() {} }, values: values };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}
function whQty(materialKey) {
  const MS = sheets[C.SHEETS.MATERIAL_STATE];
  const M = C.MATERIAL_COLUMNS;
  for (let i = 1; i < MS._data.length; i++) {
    if (MS._data[i][M.MATERIAL_KEY - 1] === materialKey) { return MS._data[i][M.WAREHOUSE_QTY - 1]; }
  }
  return 0;
}

console.log("=== S1: одиночная отметка через onEdit, заказ задан (ordered=10) ===");
reset(10);
{
  const r = dsRowNum("BOM1:C1");
  DS._setCell(r, D.REAL_DELIVERY, true);
  N.v12OnEdit(checkEvent(D.REAL_DELIVERY, true, r));
}
check("S1: REAL_DELIVERY_QTY=10", psCell("BOM1:C1", P.REAL_DELIVERY_QTY), 10);
check("S1: позиция ушла из сводки", dsHas("BOM1:C1"), false);
check("S1: склад C1 = 10", whQty("C1"), 10);

console.log("=== S2: одиночная отметка, заказ НЕ задан (ordered=0) ===");
reset(0);
{
  const r = dsRowNum("BOM1:C1");
  DS._setCell(r, D.REAL_DELIVERY, true);
  N.v12OnEdit(checkEvent(D.REAL_DELIVERY, true, r));
}
check("S2: REAL_DELIVERY_QTY=10", psCell("BOM1:C1", P.REAL_DELIVERY_QTY), 10);
check("S2: позиция ушла из сводки", dsHas("BOM1:C1"), false);

console.log("=== S3: массовая отметка чекбоксов (кол. 12, 3 строки) ===");
reset(10);
{
  const firstRow = dsRowNum(IDS[0]);
  const values = IDS.map(function () { return [true]; });
  for (let i = 0; i < IDS.length; i++) { DS._setCell(firstRow + i, D.REAL_DELIVERY, true); }
  N.v12OnEdit(rangeEvent(D.REAL_DELIVERY, values, firstRow));
}
IDS.forEach(function (id) {
  check("S3: " + id + " REAL_DELIVERY_QTY=10", psCell(id, P.REAL_DELIVERY_QTY), 10);
  check("S3: " + id + " ушла из сводки", dsHas(id), false);
});

console.log("=== S4: одиночная отметка строковым \"TRUE\" (реальный формат чекбокса) ===");
reset(10);
{
  const r = dsRowNum("BOM1:C1");
  DS._setCell(r, D.REAL_DELIVERY, "TRUE");
  N.v12OnEdit(checkEvent(D.REAL_DELIVERY, "TRUE", r));
}
check("S4: REAL_DELIVERY_QTY=10", psCell("BOM1:C1", P.REAL_DELIVERY_QTY), 10);
check("S4: позиция ушла из сводки", dsHas("BOM1:C1"), false);

console.log("=== S5: массовая отметка строковым \"TRUE\" ===");
reset(10);
{
  const firstRow = dsRowNum(IDS[0]);
  const values = IDS.map(function () { return ["TRUE"]; });
  for (let i = 0; i < IDS.length; i++) { DS._setCell(firstRow + i, D.REAL_DELIVERY, "TRUE"); }
  N.v12OnEdit(rangeEvent(D.REAL_DELIVERY, values, firstRow));
}
IDS.forEach(function (id) {
  check("S5: " + id + " REAL_DELIVERY_QTY=10", psCell(id, P.REAL_DELIVERY_QTY), 10);
  check("S5: " + id + " ушла из сводки", dsHas(id), false);
});

console.log("=== S6: снятие поставки возвращает позицию в сводку (round-trip) ===");
reset(10);
{
  const r = dsRowNum("BOM1:C1");
  DS._setCell(r, D.REAL_DELIVERY, "TRUE");
  N.v12OnEdit(checkEvent(D.REAL_DELIVERY, "TRUE", r));
}
check("S6: после отметки позиции нет в сводке", dsHas("BOM1:C1"), false);
N.v12SetRealDeliveryQty("BOM1:C1", 0);
check("S6: REAL_DELIVERY_QTY=0", psCell("BOM1:C1", P.REAL_DELIVERY_QTY), 0);
check("S6: позиция вернулась в сводку", dsHas("BOM1:C1"), true);
check("S6: склад C1 = 0", whQty("C1"), 0);

console.log("=== S7: заказ + дата (строкой) + чекбокс (строкой) ===");
reset(0);
{
  let r = dsRowNum("BOM1:C1");
  DS._setCell(r, D.ORDERED_QTY, 7);
  N.v12OnEdit(checkEvent(D.ORDERED_QTY, 7, r));

  r = dsRowNum("BOM1:C1");
  DS._setCell(r, D.EXPECTED_DATE, "15.08.2026");
  N.v12OnEdit(checkEvent(D.EXPECTED_DATE, "15.08.2026", r));

  r = dsRowNum("BOM1:C1");
  DS._setCell(r, D.REAL_DELIVERY, "TRUE");
  N.v12OnEdit(checkEvent(D.REAL_DELIVERY, "TRUE", r));
}
check("S7: ORDERED_QTY=7", psCell("BOM1:C1", P.ORDERED_QTY), 7);
check("S7: REAL_DELIVERY_QTY=10", psCell("BOM1:C1", P.REAL_DELIVERY_QTY), 10);
check("S7: позиция ушла из сводки", dsHas("BOM1:C1"), false);

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
// === S8: реальный сценарий — несколько отмеченных чекбоксов, событие по первой строке ===
// (проверяет страховку harvest: pending-отметки не теряются при пересборке сводки)
console.log("=== S8: серия одиночных отметок (страховка harvest) ===");
reset(10);
{
  const rowNums = IDS.map(function (id) { return dsRowNum(id); });
  // Пользователь проставил отметки во всех трёх строках листа...
  rowNums.forEach(function (rowNum) { DS._setCell(rowNum, D.REAL_DELIVERY, "TRUE"); });
  // ...но onEdit пришёл только по первой строке (остальные ещё не обработаны).
  N.v12OnEdit(checkEvent(D.REAL_DELIVERY, "TRUE", rowNums[0]));
}
IDS.forEach(function (id) {
  check("S8: " + id + " REAL_DELIVERY_QTY=10", psCell(id, P.REAL_DELIVERY_QTY), 10);
  check("S8: " + id + " ушла из сводки", dsHas(id), false);
});
check("S8: склад C1 = 10", whQty("C1"), 10);
check("S8: склад C2 = 10", whQty("C2"), 10);
check("S8: склад C3 = 10", whQty("C3"), 10);

if (failures === 0) { console.log("ALL TESTS PASSED (final-2)"); } else { console.log("FAILURES(final-2): " + failures); process.exitCode = 1; }
// === S9: массовая отметка чекбоксов передачи в ОТБОРКЕ (диапазон) ===
console.log("=== S9: массовая отметка чекбоксов передачи (ОТБОРКА) ===");
{
  const PK = sheets[C.SHEETS.PICKING];
  const KC = C.PICKING_COLUMNS;
  // Три строки отборки с идентификаторами позиций.
  PK._data = [C.HEADERS.PICKING.slice()];
  IDS.forEach(function (id) {
    const row = new Array(C.COLUMN_COUNT.PICKING).fill("");
    row[KC.POSITION_ID - 1] = id;
    PK._data.push(row);
  });

  globalThis.__handoffCalls = [];
  const values = IDS.map(function () { return ["TRUE"]; });
  const ev = {
    range: {
      getSheet() { return PK; }, getRow() { return 2; }, getColumn() { return KC.CHECKBOX; },
      getNumRows() { return values.length; }, getNumColumns() { return 1; },
      getValues() { return values; }, setValue() {}
    },
    values: values
  };
  N.v12OnEdit(ev);

  const unique = {};
  globalThis.__handoffCalls.forEach(function (c) { unique[c.positionId] = true; });
  IDS.forEach(function (id) {
    check("S9: передача вызвана для " + id, unique[id] === true, true);
  });
  check("S9: всего уникальных позиций = 3", Object.keys(unique).length, 3);
}

if (failures === 0) { console.log("ALL TESTS PASSED (final-3)"); } else { console.log("FAILURES(final-3): " + failures); process.exitCode = 1; }
