/**
 * ЛОКАЛЬНЫЙ тест схемы листа СНАБЖЕНИЕ (SUPPLY).
 *
 * Проверяет:
 *   - конфиг: COLUMN_COUNT.SUPPLY = 12; SUPPLY_COLUMNS без TOTAL_REQUIRED и
 *     TOTAL_RESERVED; PROJECTS = 11, UPDATED_AT = 12; HEADERS.SUPPLY без
 *     «Всего требуется»/«Всего зарезервировано», но с «Проекты» (кол. 11)
 *     и «Обновлено» (кол. 12);
 *   - миграцию v12MigrateSupplySchema(): удаление устаревших колонок и
 *     приведение заголовка к канону (12 колонок), в т.ч. из старой 11-колоночной
 *     схемы (до появления «Проекты»);
 *   - идемпотентность миграции (повторный запуск на корректном листе — no-op);
 *   - запись проекции v12RefreshSupply(): 12 колонок; кол. 11 = «Проекты» —
 *     по строке на проект «<дефицит> - <номер> - <крайняя дата поставки>»,
 *     отсортировано по дате по возрастанию (самый ранний сверху); при
 *     нескольких BOM одного проекта дефицит суммируется, дата — самая поздняя;
 *   - v12FormatSupplySheet() не падает и настраивает wrap/ширину колонки;
 *   - закрытие позиций: в СНАБЖЕНИЕ попадают только позиции с непокрытым
 *     дефицитом; после полной поставки (чекбокс «Реальная поставка» →
 *     realDelivery = required) позиция и весь материал выпадают из листа.
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
    setColumnWidth() { globalThis.__colWidthCalls = (globalThis.__colWidthCalls || 0) + 1; },
    getFilter() { return this._filter || null; },
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
        setBackgrounds() { return this; }, setBackground() { return this; }, setFontWeight() { return this; }, setNotes() { return this; },
        setWrapStrategy() { globalThis.__wrapCalls = (globalThis.__wrapCalls || 0) + 1; return this; },
        setHorizontalAlignment(a) { (globalThis.__alignCalls = globalThis.__alignCalls || []).push({ sheet: self._name, col: col, value: a }); return this; },
        setVerticalAlignment(a) { (globalThis.__vAlignCalls = globalThis.__vAlignCalls || []).push({ sheet: self._name, value: a }); return this; },
        createFilter() {
          const filter = {
            getRange() {
              return {
                getRow() { return row; }, getColumn() { return col; },
                getLastRow() { return row + numRows - 1; }, getLastColumn() { return col + numCols - 1; }
              };
            },
            remove() { self._filter = null; globalThis.__filterRemoveCalls = (globalThis.__filterRemoveCalls || 0) + 1; }
          };
          self._filter = filter;
          globalThis.__filterCreateCalls = (globalThis.__filterCreateCalls || 0) + 1;
          return filter;
        }
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
  WrapStrategy: { WRAP: "WRAP", OVERFLOW: "OVERFLOW" },
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
  "v12_handoff.js", "v12_change_engine.js", "v12_events.js", "lock.js", "v12_trigger.js",
  "v12_queue.js"
];

const src = files.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n")
  + "\n;globalThis.__V12 = { V12_CONFIG: V12_CONFIG, v12BuildPositionRow: v12BuildPositionRow,"
  + " v12MigrateSupplySchema: v12MigrateSupplySchema, v12RefreshSupply: v12RefreshSupply,"
  + " v12BuildSupplyProjectsText: v12BuildSupplyProjectsText, v12FormatSupplySheet: v12FormatSupplySheet,"
  + " v12ApplyTableAlignment: v12ApplyTableAlignment };";

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
// Схема 13 колонок: с двумя устаревшими колонками.
const LEGACY_13 = ["Material Key", "Код", "Наименование", "Модель", "Ед.изм",
  "Всего требуется", "Всего зарезервировано", "Всего дефицит",
  "Всего заказано", "Всего поставлено", "Всего непокрыто",
  "BOM (кол-во)", "Обновлено"];
// Схема 11 колонок: прежний канон БЕЗ колонки «Проекты».
const LEGACY_11 = ["Material Key", "Код", "Наименование", "Модель", "Ед.изм",
  "Всего дефицит", "Всего заказано", "Всего поставлено",
  "Всего непокрыто", "BOM (кол-во)", "Обновлено"];

console.log("=== S1: конфиг колонок СНАБЖЕНИЯ ===");
check("COLUMN_COUNT.SUPPLY = 12", C.COLUMN_COUNT.SUPPLY, 12);
check("HEADERS.SUPPLY.length = 12", CANON.length, 12);
check("SUPPLY_COLUMNS.TOTAL_REQUIRED отсутствует", C.SUPPLY_COLUMNS.TOTAL_REQUIRED, undefined);
check("SUPPLY_COLUMNS.TOTAL_RESERVED отсутствует", C.SUPPLY_COLUMNS.TOTAL_RESERVED, undefined);
check("SUPPLY_COLUMNS.TOTAL_DEFICIT = 6", C.SUPPLY_COLUMNS.TOTAL_DEFICIT, 6);
check("SUPPLY_COLUMNS.TOTAL_ORDERED = 7", C.SUPPLY_COLUMNS.TOTAL_ORDERED, 7);
check("SUPPLY_COLUMNS.TOTAL_REAL_DELIVERY = 8", C.SUPPLY_COLUMNS.TOTAL_REAL_DELIVERY, 8);
check("SUPPLY_COLUMNS.TOTAL_UNCOVERED = 9", C.SUPPLY_COLUMNS.TOTAL_UNCOVERED, 9);
check("SUPPLY_COLUMNS.BOM_COUNT = 10", C.SUPPLY_COLUMNS.BOM_COUNT, 10);
check("SUPPLY_COLUMNS.PROJECTS = 11", C.SUPPLY_COLUMNS.PROJECTS, 11);
check("SUPPLY_COLUMNS.UPDATED_AT = 12", C.SUPPLY_COLUMNS.UPDATED_AT, 12);
check("HEADERS.SUPPLY без «Всего требуется»", CANON.indexOf("Всего требуется"), -1);
check("HEADERS.SUPPLY без «Всего зарезервировано»", CANON.indexOf("Всего зарезервировано"), -1);
check("HEADERS.SUPPLY[5] = «Всего дефицит»", CANON[5], "Всего дефицит");
check("HEADERS.SUPPLY[9] = «BOM (кол-во)»", CANON[9], "BOM (кол-во)");
check("HEADERS.SUPPLY[10] = «Проекты»", CANON[10], "Проекты");
check("HEADERS.SUPPLY[11] = «Обновлено»", CANON[11], "Обновлено");
check("Legacy-13 = 13 колонок (setup sanity)", LEGACY_13.length, 13);
check("Legacy-11 = 11 колонок (setup sanity)", LEGACY_11.length, 11);

// Остальные листы пустые (по заголовку), чтобы refresh не падал.
["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "WORKING_BOM", "PICKING", "EVENT_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });

console.log("=== S2: миграция схемы 13 -> 12 ===");
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
  check("заголовок = 12 колонок", header.length, 12);
  check("«Всего требуется» удалён", header.indexOf("Всего требуется"), -1);
  check("«Всего зарезервировано» удалён", header.indexOf("Всего зарезервировано"), -1);
  check("кол. 11 = «Проекты»", header[10], "Проекты");
  check("кол. 12 = «Обновлено»", header[11], "Обновлено");
  check("заголовок совпал с каноном", JSON.stringify(header), JSON.stringify(CANON));
}

console.log("=== S2b: миграция схемы 11 -> 12 (прежний канон без «Проекты») ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, LEGACY_11);
  N.v12MigrateSupplySchema();
  const header = SP._data[0];
  check("заголовок = 12 колонок", header.length, 12);
  check("кол. 11 = «Проекты»", header[10], "Проекты");
  check("кол. 12 = «Обновлено»", header[11], "Обновлено");
  check("заголовок совпал с каноном", JSON.stringify(header), JSON.stringify(CANON));
}

console.log("=== S3: миграция идемпотентна (12 -> 12, no-op) ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  N.v12MigrateSupplySchema();
  check("заголовок не изменился (12 колонок)", SP._data[0].length, 12);
  check("заголовок совпал с каноном", JSON.stringify(SP._data[0]), JSON.stringify(CANON));
}

console.log("=== S4: v12RefreshSupply пишет 12 колонок + «Проекты» ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  // Один материал (код C1) в двух проектах. Даты поставки = EXPECTED_DATE (нет резерва/поставки):
  // BBB-200 -> 05.09.2026, AAA-100 -> 10.09.2026.
  PS._data.push(N.v12BuildPositionRow("BBB-200", {
    bomName: "BBB-200", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 5, reservedQty: 0, deadline: "2026-09-20"
  }, "BBB-200:C1", 1, { expectedDate: "2026-09-05" }));
  PS._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 0, deadline: "2026-09-20"
  }, "AAA-100:C1", 1, { expectedDate: "2026-09-10" }));

  N.v12RefreshSupply();

  const S = C.SUPPLY_COLUMNS;
  check("в СНАБЖЕНИИ 1 строка данных", SP._data.length, 2);
  const row = SP._data[1];
  check("тело строки = 12 колонок", row.length, 12);
  check("кол. 1 = Material Key", row[S.MATERIAL_KEY - 1], "C1");
  check("кол. 6 = «Всего дефицит» = 15", row[S.TOTAL_DEFICIT - 1], 15);
  check("кол. 10 = BOM (кол-во) = 2", row[S.BOM_COUNT - 1], 2);
  check("кол. 11 = «Проекты»: <дефицит> - <проект> - <дата>, ранний сверху",
    row[S.PROJECTS - 1], "5 - BBB - 05.09.2026\n10 - AAA - 10.09.2026");
  check("кол. 12 = «Обновлено» (Date)", row[S.UPDATED_AT - 1] instanceof Date, true);
}

console.log("=== S5: несколько BOM одного проекта -> берётся самая поздняя дата ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  // Проект AAA в двух BOM: сроки 10.09 и 25.09 -> «крайняя» = 25.09.
  PS._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 5, reservedQty: 0, deadline: "2026-09-30"
  }, "AAA-100:C1", 1, { expectedDate: "2026-09-10" }));
  PS._data.push(N.v12BuildPositionRow("AAA-200", {
    bomName: "AAA-200", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 5, reservedQty: 0, deadline: "2026-09-30"
  }, "AAA-200:C1", 1, { expectedDate: "2026-09-25" }));

  N.v12RefreshSupply();
  const S = C.SUPPLY_COLUMNS;
  check("один проект, дефицит суммирован, крайняя дата",
    SP._data[1][S.PROJECTS - 1], "10 - AAA - 25.09.2026");
}

console.log("=== S6: v12BuildSupplyProjectsText сортирует и форматирует ===");
{
  const txt = N.v12BuildSupplyProjectsText({
    "BBB": { project: "BBB", date: "2026-09-05", deficit: 5 },
    "AAA": { project: "AAA", date: "2026-09-10", deficit: 10 },
    "CCC": { project: "CCC", date: "", deficit: 7 }
  });
  check("«<дефицит> - <проект> - <дата>», сортировка, без-даты в конец",
    txt, "5 - BBB - 05.09.2026\n10 - AAA - 10.09.2026\n7 - CCC");
}

console.log("=== S7: v12FormatSupplySheet настраивает wrap/ширину ===");
{
  makeSheet(C.SHEETS.SUPPLY, CANON);
  globalThis.__wrapCalls = 0;
  globalThis.__colWidthCalls = 0;
  N.v12FormatSupplySheet();
  check("wrap применён (>=1)", globalThis.__wrapCalls >= 1, true);
  check("ширина колонки применена (>=1)", globalThis.__colWidthCalls >= 1, true);
}

console.log("=== S8: закрытие по поставке (только позиции с непокрытым дефицитом) ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  // C-A: дефицита нет (reserved == required) — не попадает.
  PS._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 1, code: "C-A", name: "M-A", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 10, deadline: "2026-09-30"
  }, "AAA-100:C-A", 1, {}));
  // C-B: частичная поставка (4 < дефицита 10) — остаётся.
  PS._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 2, code: "C-B", name: "M-B", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 0, deadline: "2026-09-30"
  }, "AAA-100:C-B", 1, { realDeliveryQty: 4 }));
  // C-C: полная поставка (10 == required) — «Реальная поставка» отмечена — выпадает.
  PS._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 3, code: "C-C", name: "M-C", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 0, deadline: "2026-09-30"
  }, "AAA-100:C-C", 1, { realDeliveryQty: 10 }));

  N.v12RefreshSupply();

  const S = C.SUPPLY_COLUMNS;
  check("в СНАБЖЕНИИ 1 материал (только частично обеспеченный)", SP.getLastRow() - 1, 1);
  check("материал = C-B", SP._data[1][S.MATERIAL_KEY - 1], "C-B");
  check("«Всего дефицит» = 10 (C-B)", SP._data[1][S.TOTAL_DEFICIT - 1], 10);
}

console.log("=== S9: закрытый проект выпадает из колонки «Проекты» ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  // Проект AAA: поставка закрыта (realDelivery = required) — выпадает.
  PS._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 10, reservedQty: 0, deadline: "2026-09-30"
  }, "AAA-100:C1", 1, { realDeliveryQty: 10 }));
  // Проект BBB: дефицит 5, поставки нет — остаётся.
  PS._data.push(N.v12BuildPositionRow("BBB-200", {
    bomName: "BBB-200", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 5, reservedQty: 0, deadline: "2026-09-30"
  }, "BBB-200:C1", 1, { expectedDate: "2026-09-05" }));

  N.v12RefreshSupply();
  const S = C.SUPPLY_COLUMNS;
  check("материал C1 остаётся (есть незакрытый проект)", SP._data.length, 2);
  check("в «Проекты» только незакрытый проект",
    SP._data[1][S.PROJECTS - 1], "5 - BBB - 05.09.2026");
  check("«Всего дефицит» = 5", SP._data[1][S.TOTAL_DEFICIT - 1], 5);
}

console.log("=== S10: автофильтр на СНАБЖЕНИЕ (сортировка по столбцам) ===");
{
  const SP = makeSheet(C.SHEETS.SUPPLY, CANON);
  const PS = sheets[C.SHEETS.POSITION_STATE];
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  PS._data.push(N.v12BuildPositionRow("AAA-100", {
    bomName: "AAA-100", row: 1, code: "C1", name: "M-C1", model: "M1", unit: "шт",
    requiredQty: 5, reservedQty: 0, deadline: "2026-09-30"
  }, "AAA-100:C1", 1, { expectedDate: "2026-09-05" }));

  globalThis.__filterCreateCalls = 0;
  globalThis.__filterRemoveCalls = 0;

  N.v12RefreshSupply();   // 1 материал -> фильтр на строки 1..2
  const f1 = SP.getFilter();
  check("автофильтр создан", f1 !== null, true);
  check("диапазон начинается со строки 1, кол. 1",
    f1.getRange().getRow() === 1 && f1.getRange().getColumn() === 1, true);
  check("последняя строка диапазона = 2", f1.getRange().getLastRow(), 2);
  check("последняя колонка диапазона = 12", f1.getRange().getLastColumn(), 12);
  check("createFilter вызван 1 раз", globalThis.__filterCreateCalls, 1);

  // Повторный пересчёт с тем же числом строк — фильтр не пересоздаётся
  // (не сбрасываем пользовательскую сортировку/фильтр).
  N.v12RefreshSupply();
  check("повторный пересчёт не пересоздаёт фильтр", globalThis.__filterCreateCalls, 1);
  check("фильтр не удалялся", globalThis.__filterRemoveCalls, 0);

  // Появился второй материал — диапазон расширяется (пересоздание фильтра).
  PS._data.push(N.v12BuildPositionRow("BBB-200", {
    bomName: "BBB-200", row: 1, code: "C2", name: "M-C2", model: "M1", unit: "шт",
    requiredQty: 3, reservedQty: 0, deadline: "2026-09-30"
  }, "BBB-200:C2", 1, {}));
  N.v12RefreshSupply();   // 2 материала -> строки 1..3
  check("фильтр пересоздан под новый диапазон", globalThis.__filterCreateCalls, 2);
  check("старый фильтр удалён", globalThis.__filterRemoveCalls, 1);
  check("новая последняя строка = 3", SP.getFilter().getRange().getLastRow(), 3);
}

console.log("=== S11: выравнивание (центр для количеств/ед.изм./дат, слева для наименований) ===");
{
  makeSheet(C.SHEETS.SUPPLY, CANON);
  globalThis.__alignCalls = [];
  globalThis.__vAlignCalls = [];
  N.v12ApplyTableAlignment();
  const name = C.SHEETS.SUPPLY;
  const sup = globalThis.__alignCalls.filter(function (a) { return a.sheet === name; });
  function alignOf(col) { const e = sup.find(function (a) { return a.col === col; }); return e ? e.value : null; }
  // Количества и ед.изм. — по центру.
  check("Ед.изм (5) — center", alignOf(5), "center");
  check("Всего дефицит (6) — center", alignOf(6), "center");
  check("BOM (кол-во) (10) — center", alignOf(10), "center");
  check("Обновлено/дата (12) — center", alignOf(12), "center");
  // Наименования, модели, проекты — слева.
  check("Наименование (3) — left", alignOf(3), "left");
  check("Модель (4) — left", alignOf(4), "left");
  check("Проекты (11) — left", alignOf(11), "left");
  // По вертикали — по центру.
  const vSup = globalThis.__vAlignCalls.filter(function (v) { return v.sheet === name; });
  check("вертикальное выравнивание = middle",
    vSup.length > 0 && vSup.every(function (v) { return v.value === "middle"; }), true);
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
