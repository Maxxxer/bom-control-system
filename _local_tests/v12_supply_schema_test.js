/**
 * ЛОКАЛЬНЫЙ тест схемы листа СНАБЖЕНИЕ (SUPPLY).
 *
 * Проверяет:
 *   - конфиг: COLUMN_COUNT.SUPPLY = 11; SUPPLY_COLUMNS без TOTAL_REQUIRED и
 *     TOTAL_RESERVED; TOTAL_DEFICIT = 6 ... UPDATED_AT = 11;
 *     HEADERS.SUPPLY без «Всего требуется» и «Всего зарезервировано»;
 *   - миграцию v12MigrateSupplySchema(): удаление устаревших колонок
 *     «Всего требуется» и «Всего зарезервировано» из схемы 13 колонок и
 *     канонический заголовок (11 колонок);
 *   - идемпотентность миграции (повторный запуск на корректном листе — no-op);
 *   - запись проекции v12RefreshSupply(): тело строки содержит ровно 11 ячеек,
 *     кол. 6 = «Всего дефицит», кол. 7 = «Всего заказано», кол. 10 = BOM (кол-во),
 *     кол. 11 = «Обновлено».
 *
 * ВАЖНО: файл — Node-скрипт (require/vm) и НЕ выгружается в Apps Script
 * (лежит в _local_tests/ и исключён через .claspignore).
 *
 * Запуск из корня проекта: node _local_tests/v12_supply_schema_test.js
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

const files = [
  "v12_config.js", "utils.js", "sheet_service.js", "v12_utils.js", "v12_calculate.js",
  "v12_position_state.js", "v12_material_state.js", "v12_audit.js", "v12_roles.js",
  "v12_source.js", "v12_sheet_service.js", "v12_projections.js", "v12_operations.js",
  "v12_handoff.js", "v12_change_engine.js", "v12_events.js", "lock.js", "v12_trigger.js"
];

const src = files.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n")
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, v12BuildPositionRow: v12BuildPositionRow,"
  + " v12MigrateSupplySchema: v12MigrateSupplySchema, v12RefreshSupply: v12RefreshSupply };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

const CANON = C.HEADERS.SUPPLY;
// Схема 13 колонок: с обеими устаревшими колонками.
const LEGACY_13 = ["Material Key", "Код", "Наименование", "Модель", "Ед.изм",
  "Всего требуется", "Всего зарезервировано", "Всего дефицит",
  "Всего заказано", "Всего поставлено", "Всего непокрыто",
  "BOM (кол-во)", "Обновлено"];

console.log("=== S1: конфиг колонок СНАБЖЕНИЯ ===");
check("COLUMN_COUNT.SUPPLY = 11", C.COLUMN_COUNT.SUPPLY, 11);
check("HEADERS.SUPPLY.length = 11", CANON.length, 11);
check("SUPPLY_COLUMNS.TOTAL_REQUIRED отсутствует", C.SUPPLY_COLUMNS.TOTAL_REQUIRED, undefined);
check("SUPPLY_COLUMNS.TOTAL_RESERVED отсутствует", C.SUPPLY_COLUMNS.TOTAL_RESERVED, undefined);
check("SUPPLY_COLUMNS.TOTAL_DEFICIT = 6", C.SUPPLY_COLUMNS.TOTAL_DEFICIT, 6);
check("SUPPLY_COLUMNS.TOTAL_ORDERED = 7", C.SUPPLY_COLUMNS.TOTAL_ORDERED, 7);
check("SUPPLY_COLUMNS.TOTAL_REAL_DELIVERY = 8", C.SUPPLY_COLUMNS.TOTAL_REAL_DELIVERY, 8);
check("SUPPLY_COLUMNS.TOTAL_UNCOVERED = 9", C.SUPPLY_COLUMNS.TOTAL_UNCOVERED, 9);
check("SUPPLY_COLUMNS.BOM_COUNT = 10", C.SUPPLY_COLUMNS.BOM_COUNT, 10);
check("SUPPLY_COLUMNS.UPDATED_AT = 11", C.SUPPLY_COLUMNS.UPDATED_AT, 11);
check("HEADERS.SUPPLY без «Всего требуется»", CANON.indexOf("Всего требуется"), -1);
check("HEADERS.SUPPLY без «Всего зарезервировано»", CANON.indexOf("Всего зарезервировано"), -1);
check("HEADERS.SUPPLY[5] = «Всего дефицит»", CANON[5], "Всего дефицит");
check("HEADERS.SUPPLY[6] = «Всего заказано»", CANON[6], "Всего заказано");
check("HEADERS.SUPPLY[9] = «BOM (кол-во)»", CANON[9], "BOM (кол-во)");
check("HEADERS.SUPPLY[10] = «Обновлено»", CANON[10], "Обновлено");
check("Legacy-13 = 13 колонок (setup sanity)", LEGACY_13.length, 13);

// Остальные листы пустые (по заголовку), чтобы refresh не падал.
["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "WORKING_BOM", "PICKING", "EVENT_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

console.log("=== S2: миграция схемы 13 -> 11 ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, LEGACY_13);
  const bodyRow = new Array(13).fill("");
  bodyRow[0] = "C1";             // Material Key
  bodyRow[5] = 100;              // «Всего требуется» — удаляется
  bodyRow[6] = 20;               // «Всего зарезервировано» — удаляется
  bodyRow[7] = 80;               // «Всего дефицит» — остаётся
  SP._data.push(bodyRow);

  N.v12MigrateSupplySchema();

  const header = SP._data[0];
  check("заголовок = 11 колонок", header.length, 11);
  check("«Всего требуется» удалён", header.indexOf("Всего требуется"), -1);
  check("«Всего зарезервировано» удалён", header.indexOf("Всего зарезервировано"), -1);
  check("кол. 6 = «Всего дефицит»", header[5], "Всего дефицит");
  check("кол. 7 = «Всего заказано»", header[6], "Всего заказано");
  check("кол. 11 = «Обновлено»", header[10], "Обновлено");
  check("заголовок совпал с каноном", JSON.stringify(header), JSON.stringify(CANON));
  check("физически последняя колонка = 11", SP.getLastColumn(), 11);
}

console.log("=== S3: миграция идемпотентна (11 -> 11, no-op) ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  N.v12MigrateSupplySchema();
  check("заголовок не изменился (11 колонок)", SP._data[0].length, 11);
  check("заголовок совпал с каноном", JSON.stringify(SP._data[0]), JSON.stringify(CANON));
}

console.log("=== S4: проекция v12RefreshSupply пишет 11 колонок ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  // Дефицит: required=10, reserved=0 -> deficit=10.
  PS._data.push(N.v12BuildPositionRow("BOM1", {
    bomName: "BOM1", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 0, deadline: "2026-09-10"
  }, "BOM1:C1", 1, { orderedQty: 4 }));

  N.v12RefreshSupply();

  const S = C.SUPPLY_COLUMNS;
  check("в СНАБЖЕНИИ 1 строка данных", SP._data.length, 2);
  const row = SP._data[1];
  check("тело строки = 11 колонок", row.length, 11);
  check("кол. 1 = Material Key", row[S.MATERIAL_KEY - 1], "C1");
  check("кол. 6 = «Всего дефицит» = 10", row[S.TOTAL_DEFICIT - 1], 10);
  check("кол. 7 = «Всего заказано» = 4", row[S.TOTAL_ORDERED - 1], 4);
  check("кол. 10 = BOM (кол-во) = 1", row[S.BOM_COUNT - 1], 1);
  check("кол. 11 = «Обновлено» (Date)", row[S.UPDATED_AT - 1] instanceof Date, true);
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
