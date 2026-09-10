/**
 * ЛОКАЛЬНЫЙ тест схемы листа ОТБОРКА (PICKING).
 *
 * Проверяет:
 *   - конфиг: COLUMN_COUNT.PICKING = 13; PICKING_COLUMNS без RECEIVED_QTY и
 *     WAREHOUSE_QTY; HEADERS.PICKING без «Передано (кол-во)» и «Складской остаток»;
 *   - миграцию v12MigratePickingSchema(): удаление устаревших колонок
 *     «Передано (кол-во)» и «Складской остаток» (из схем 15 и 14 колонок)
 *     и канонический заголовок (UPDATED_AT на кол. 13);
 *   - идемпотентность миграции (повторный запуск на корректном листе — no-op);
 *   - запись проекции v12RefreshPicking(): тело строки содержит ровно 13 ячеек,
 *     кол. 11 = статус, кол. 12 = чекбокс false, кол. 13 = дата обновления.
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
  + " v12MigratePickingSchema: v12MigratePickingSchema, v12RefreshPicking: v12RefreshPicking,"
  + " v12ExtractBomProjectCode: v12ExtractBomProjectCode };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

// Канонический заголовок ОТБОРКИ и устаревшие варианты.
const CANON = C.HEADERS.PICKING;
// Схема 15 колонок: с обеими устаревшими колонками.
const LEGACY_15 = ["Position ID", "BOM", "Строка", "Код", "Наименование", "Модель", "Ед.изм",
  "Требуется", "Зарезервировано", "Доступно для производства", "Складской остаток",
  "ProductionState", "Отметка получено", "Передано (кол-во)", "Обновлено"];
// Схема 14 колонок: «Передано (кол-во)» уже удалён, но «Складской остаток» ещё есть.
const LEGACY_14 = ["Position ID", "BOM", "Строка", "Код", "Наименование", "Модель", "Ед.изм",
  "Требуется", "Зарезервировано", "Доступно для производства", "Складской остаток",
  "ProductionState", "Отметка получено", "Обновлено"];

console.log("=== C1: конфиг колонок ОТБОРКИ ===");
check("COLUMN_COUNT.PICKING = 13", C.COLUMN_COUNT.PICKING, 13);
check("HEADERS.PICKING.length = 13", CANON.length, 13);
check("PICKING_COLUMNS.UPDATED_AT = 13", C.PICKING_COLUMNS.UPDATED_AT, 13);
check("PICKING_COLUMNS.RECEIVED_QTY отсутствует", C.PICKING_COLUMNS.RECEIVED_QTY, undefined);
check("PICKING_COLUMNS.WAREHOUSE_QTY отсутствует", C.PICKING_COLUMNS.WAREHOUSE_QTY, undefined);
check("HEADERS.PICKING без «Передано (кол-во)»", CANON.indexOf("Передано (кол-во)"), -1);
check("HEADERS.PICKING без «Складской остаток»", CANON.indexOf("Складской остаток"), -1);
check("Legacy-15 = 15 колонок (setup sanity)", LEGACY_15.length, 15);
check("Legacy-14 = 14 колонок (setup sanity)", LEGACY_14.length, 14);

// Остальные листы пустые (по заголовку), чтобы refresh не падал.
["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "WORKING_BOM"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

console.log("=== C2: миграция схемы 15 -> 13 ===");
{
  const PK = makeSheet(C.SHEETS.PICKING, LEGACY_15);
  const bodyRow = new Array(15).fill("");
  bodyRow[0] = "BOM1:C1";
  bodyRow[10] = 100;            // «Складской остаток» — удаляется
  bodyRow[12] = false;          // чекбокс
  bodyRow[13] = 0;              // «Передано (кол-во)» — удаляется
  bodyRow[14] = new Date();     // «Обновлено»
  PK._data.push(bodyRow);

  N.v12MigratePickingSchema();

  const header = PK._data[0];
  check("заголовок = 13 колонок", header.length, 13);
  check("«Передано (кол-во)» удалён", header.indexOf("Передано (кол-во)"), -1);
  check("«Складской остаток» удалён", header.indexOf("Складской остаток"), -1);
  check("кол. 13 = «Обновлено»", header[12], "Обновлено");
  check("заголовок совпал с каноном", JSON.stringify(header), JSON.stringify(CANON));
  check("физически последняя колонка = 13", PK.getLastColumn(), 13);
}

console.log("=== C3: миграция схемы 14 -> 13 (остался только «Складской остаток») ===");
{
  const PK = makeSheet(C.SHEETS.PICKING, LEGACY_14);
  N.v12MigratePickingSchema();
  const header = PK._data[0];
  check("заголовок = 13 колонок", header.length, 13);
  check("«Складской остаток» удалён", header.indexOf("Складской остаток"), -1);
  check("заголовок совпал с каноном", JSON.stringify(header), JSON.stringify(CANON));
}

console.log("=== C4: миграция идемпотентна (13 -> 13, no-op) ===");
{
  const PK = makeSheet(C.SHEETS.PICKING, CANON);
  N.v12MigratePickingSchema();
  check("заголовок не изменился (13 колонок)", PK._data[0].length, 13);
  check("заголовок совпал с каноном", JSON.stringify(PK._data[0]), JSON.stringify(CANON));
}

console.log("=== C5: проекция v12RefreshPicking пишет 13 колонок ===");
{
  const PK = makeSheet(C.SHEETS.PICKING, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
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
  check("тело строки = 13 колонок", row.length, 13);
  check("кол. 1 = Position ID", row[K.POSITION_ID - 1], "BOM1:C1");
  check("кол. 11 = «На складе»", row[K.PRODUCTION_STATE - 1], "На складе");
  check("кол. 12 = чекбокс false", row[K.CHECKBOX - 1], false);
  check("кол. 13 (UPDATED_AT) — дата", row[K.UPDATED_AT - 1] instanceof Date, true);
}

console.log("=== C7: разбор кода проекта (до пробела/дефиса/подчёркивания) ===");
{
  const E = N.v12ExtractBomProjectCode;
  check("«1234.АБВ-5678 Щит» -> «1234.АБВ»", E("1234.АБВ-5678 Щит"), "1234.АБВ");
  check("«1234 АБВ» -> «1234»", E("1234 АБВ"), "1234");
  check("«1234_АБВ» -> «1234»", E("1234_АБВ"), "1234");
  check("«АБВ-100» -> «АБВ»", E("АБВ-100"), "АБВ");
  check("«1234.АБВ» (без разделителя) -> «1234.АБВ»", E("1234.АБВ"), "1234.АБВ");
  check("пусто -> «»", E(""), "");
}

console.log("=== C6: фильтр по проекту (B1) и порядок сортировки ===");
{
  const K = C.PICKING_COLUMNS;
  const F = C.PICKING_FILTER;
  const PK = makeSheet(C.SHEETS.PICKING, CANON);
  const PS2 = sheets[C.SHEETS.POSITION_STATE];
  PS2._data = [C.HEADERS.POSITION_STATE.slice()];
  // Проект AAA: строка 5 — нет в наличии (reserved=0), строка 1 — «На складе» (reserved=10).
  PS2._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 5, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 0, deadline: "2026-09-01"
  }, "AAA-100:C1", 1, {}));
  PS2._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 1, code: "C2", name: "M-C2", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 10, deadline: "2026-09-01"
  }, "AAA-100:C2", 1, {}));
  // Проект BBB: одна строка, нет в наличии.
  PS2._data.push(N.v12BuildPositionRow("BBB-200", {
    bomName: "BBB-200", row: 1, code: "C3", name: "M-C3", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 0, deadline: "2026-09-01"
  }, "BBB-200:C1", 1, {}));

  // «Все проекты» → 3 строки.
  PK._setCell(F.CELL_ROW, F.CELL_COL, F.ALL);
  N.v12RefreshPicking();
  check("Все проекты: 3 строки", PK.getLastRow() - 1, 3);

  // Фильтр «AAA» → 2 строки, «На складе» сверху.
  PK._setCell(F.CELL_ROW, F.CELL_COL, "AAA");
  N.v12RefreshPicking();
  check("AAA: 2 строки", PK.getLastRow() - 1, 2);
  check("AAA: 1-я строка «На складе»", PK._data[1][K.PRODUCTION_STATE - 1], "На складе");
  check("AAA: 1-я строка = C2", PK._data[1][K.MATERIAL_CODE - 1], "C2");
  check("AAA: 2-я строка = C1", PK._data[2][K.MATERIAL_CODE - 1], "C1");

  // Фильтр «BBB» → 1 строка.
  PK._setCell(F.CELL_ROW, F.CELL_COL, "BBB");
  N.v12RefreshPicking();
  check("BBB: 1 строка", PK.getLastRow() - 1, 1);
  check("BBB: код = C3", PK._data[1][K.MATERIAL_CODE - 1], "C3");

  // Выбор несуществующего проекта → сброс на «Все проекты», 3 строки.
  PK._setCell(F.CELL_ROW, F.CELL_COL, "ZZZ");
  N.v12RefreshPicking();
  check("ZZZ: значение сброшено на «Все проекты»", PK._data[0][F.CELL_COL - 1], F.ALL);
  check("ZZZ: 3 строки (сброс)", PK.getLastRow() - 1, 3);
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
