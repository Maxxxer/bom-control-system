/**
 * ЛОКАЛЬНЫЙ тест схемы листа ОТБОРКА (PICKING).
 *
 * Проверяет:
 *   - конфиг: COLUMN_COUNT.PICKING = 14, PICKING_COLUMNS.RECEIVED_QTY отсутствует,
 *     HEADERS.PICKING не содержит «Передано (кол-во)»;
 *   - миграцию v12MigratePickingSchema(): удаление устаревшей колонки 14
 *     «Передано (кол-во)» и канонический заголовок (UPDATED_AT на кол. 14);
 *   - идемпотентность миграции (повторный запуск на корректном листе — no-op);
 *   - запись проекции v12RefreshPicking(): тело строки содержит ровно 14 ячеек,
 *     кол. 12 = статус, кол. 13 = чекбокс false, кол. 14 = дата обновления.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script
 * (лежит в _local_tests/ и исключён через .claspignore).
 *
 * Запуск из корня проекта: node _local_tests/v12_picking_schema_test.js
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
    getMaxColumns() {
      let max = 0;
      for (let r = 0; r < this._data.length; r++) { const row = this._data[r] || []; if (row.length > max) { max = row.length; } }
      return max;
    },
    deleteColumn(colIndex) {
      const ci = colIndex - 1;
      for (let r = 0; r < this._data.length; r++) {
        const row = this._data[r] || [];
        if (row.length > ci) { row.splice(ci, 1); }
      }
    },
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
  newDataValidation() { return { requireCheckbox() { return this; }, build() { return {}; } }; },
  newConditionalFormatRule() { return { whenTextContains() { return this; }, setBackground() { return this; }, setRanges() { return this; }, build() { return {}; } }; },
  flush() {}
};
globalThis.LockService = { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } };
globalThis.PropertiesService = { getScriptProperties() { return { getProperty() { return null; }, setProperty() {}, deleteProperty() {} }; } };
globalThis.Session = { getActiveUser() { return { getEmail() { return "test@example.com"; } }; } };
globalThis.Utilities = { getUuid() { return "uuid-" + Math.random().toString(16).slice(2); } };
globalThis.logSystem = function () {};
globalThis.flushSystemLog = function () {};

const files = [
  "v12_config.js", "utils.js", "sheet_service.js", "v12_utils.js", "v12_calculate.js",
  "v12_position_state.js", "v12_material_state.js", "v12_audit.js", "v12_roles.js",
  "v12_source.js", "v12_sheet_service.js", "v12_projections.js", "v12_operations.js",
  "v12_handoff.js", "v12_change_engine.js", "lock.js", "v12_trigger.js"
];

const src = files.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n")
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, v12BuildPositionRow: v12BuildPositionRow,"
  + " v12MigratePickingSchema: v12MigratePickingSchema, v12RefreshPicking: v12RefreshPicking };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

// Канонический заголовок ОТБОРКИ и его устаревший (legacy) вариант с 15 колонками.
const CANON = C.HEADERS.PICKING;
const LEGACY = CANON.slice(0, 13).concat(["Передано (кол-во)", "Обновлено"]);

console.log("=== C1: конфиг колонок ОТБОРКИ ===");
check("COLUMN_COUNT.PICKING = 14", C.COLUMN_COUNT.PICKING, 14);
check("HEADERS.PICKING.length = 14", CANON.length, 14);
check("PICKING_COLUMNS.UPDATED_AT = 14", C.PICKING_COLUMNS.UPDATED_AT, 14);
check("PICKING_COLUMNS.RECEIVED_QTY отсутствует", C.PICKING_COLUMNS.RECEIVED_QTY, undefined);
check("HEADERS.PICKING без «Передано (кол-во)»", CANON.indexOf("Передано (кол-во)"), -1);
check("Legacy-заголовок = 15 колонок (setup sanity)", LEGACY.length, 15);

// Остальные листы пустые (по заголовку), чтобы refresh не падал.
["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "WORKING_BOM"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

console.log("=== C2: миграция устаревшего листа (15 -> 14) ===");
{
  const PK = makeSheet(C.SHEETS.PICKING, LEGACY);
  // Тело листа по старой схеме (значения в т.ч. в удаляемой кол. 14).
  const bodyRow = new Array(15).fill("");
  bodyRow[0] = "BOM1:C1";
  bodyRow[12] = false;          // чекбокс
  bodyRow[13] = 0;              // «Передано (кол-во)» — удаляется
  bodyRow[14] = new Date();     // «Обновлено»
  PK._data.push(bodyRow);

  N.v12MigratePickingSchema();

  const header = PK._data[0];
  check("заголовок = 14 колонок", header.length, 14);
  check("«Передано (кол-во)» удалён", header.indexOf("Передано (кол-во)"), -1);
  check("кол. 14 = «Обновлено»", header[13], "Обновлено");
  check("заголовок совпал с каноном", JSON.stringify(header), JSON.stringify(CANON));
  check("физически последняя колонка = 14", PK.getLastColumn(), 14);
}

console.log("=== C3: миграция идемпотентна (14 -> 14, no-op) ===");
{
  const PK = makeSheet(C.SHEETS.PICKING, CANON);
  N.v12MigratePickingSchema();
  check("заголовок не изменился (14 колонок)", PK._data[0].length, 14);
  check("заголовок совпал с каноном", JSON.stringify(PK._data[0]), JSON.stringify(CANON));
}

console.log("=== C4: проекция v12RefreshPicking пишет 14 колонок ===");
{
  // Пересоздаём ОТБОРКУ с каноническим заголовком.
  const PK = makeSheet(C.SHEETS.PICKING, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
  const P = C.POSITION_COLUMNS;
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  // Готовая к передаче позиция: reserved=10, required=10 -> READY_FOR_HANDOFF («На складе»).
  PS._data.push(N.v12BuildPositionRow("BOM1", {
    bomName: "BOM1", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 10, deadline: "2026-09-01"
  }, "BOM1:C1", 1, {}));

  N.v12RefreshPicking();

  const K = C.PICKING_COLUMNS;
  check("в ОТБОРКЕ 1 строка данных", PK._data.length, 2);
  const row = PK._data[1];
  check("тело строки = 14 колонок", row.length, 14);
  check("кол. 1 = Position ID", row[K.POSITION_ID - 1], "BOM1:C1");
  check("кол. 12 = «На складе»", row[K.PRODUCTION_STATE - 1], "На складе");
  check("кол. 13 = чекбокс false", row[K.CHECKBOX - 1], false);
  check("кол. 14 (UPDATED_AT) — дата", row[K.UPDATED_AT - 1] instanceof Date, true);
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
