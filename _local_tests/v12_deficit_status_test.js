/**
 * ЛОКАЛЬНЫЙ тест статусов и раскраски «Сводки дефицитов» (DEFICIT_SUMMARY).
 *
 * Проверяет:
 *   - v12DeficitStatusDisplay:
 *       нет заказа                          → «Не заказано»;
 *       заказ есть, но нет ожидаемой даты   → «Не заказано» (не «Заказано»);
 *       ordered < дефицит (дата есть)       → «Заказано частично»;
 *       ordered >= дефицит, дата <= срок    → «Ожидание поставки (в Срок)»;
 *       ordered >= дефицит, дата > срок     → «Ожидание поставки (Опаздывает)»;
 *       ошибка валидации                    → «Ошибка данных»;
 *   - v12DeficitStatusColor — единый источник правды:
 *       «Не заказано» / «Заказано частично» → RED;
 *       «Ожидание поставки (в Срок)»        → YELLOW;
 *       «Ожидание поставки (Опаздывает)»    → ORANGE;
 *       «Ошибка данных»                     → GRAY;
 *       иначе                               → WHITE;
 *   - интеграция: v12RefreshDeficitSummary красит строку «Не заказано» в красный
 *     (регрессия: ранее такие строки оставались белыми).
 *
 * ВАЖНО: Node-скрипт (require/vm), НЕ выгружается в Apps Script.
 *
 * Запуск из корня проекта: node _local_tests/v12_deficit_status_test.js
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
        setBackgrounds(colors) { globalThis.__bg = (globalThis.__bg || []).concat(colors); return this; },
        setBackground() { return this; }, setFontWeight() { return this; }, setNotes() { return this; },
        setWrapStrategy() { return this; }, setHorizontalAlignment() { return this; }, setVerticalAlignment() { return this; }
      };
    },
    _setCell(r, c, v) {
      const ri = r - 1, ci = c - 1;
      while (this._data.length <= ri) { this._data.push([]); }
      const rowArr = this._data[ri];
      while (rowArr.length <= ci) { rowArr.push(""); }
      rowArr[ci] = v;
    },
    setFrozenRows() {}, setConditionalFormatRules() {}, getConditionalFormatRules() { return []; },
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
  + " v12DeficitStatusDisplay: v12DeficitStatusDisplay, v12DeficitStatusColor: v12DeficitStatusColor,"
  + " v12RefreshDeficitSummary: v12RefreshDeficitSummary };";

vm.runInThisContext(src, { filename: "v12-bundle.js" });
const N = globalThis.__V12;
const C = N.V12_CONFIG;
const P = C.POSITION_COLUMNS;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

function mkRow(opts) {
  const o = opts || {};
  const row = N.v12BuildPositionRow(o.bomId || "AAA-100", {
    bomName: o.bomName || "AAA-100", row: 1, code: o.code || "C1",
    name: "M-C1", model: "M1", unit: "шт",
    requiredQty: o.required == null ? 10 : o.required,
    reservedQty: o.reserved == null ? 0 : o.reserved,
    deadline: o.deadline || "2026-09-30"
  }, (o.bomId || "AAA-100") + ":" + (o.code || "C1"), 1, {
    orderedQty: o.ordered || 0,
    expectedDate: o.expected || ""
  });
  if (o.validationError) {
    row[P.VALIDATION_STATUS - 1] = C.VALIDATION_STATUS.ERROR;
  }
  return row;
}

console.log("=== D1: v12DeficitStatusDisplay ===");
check("нет заказа → «Не заказано»",
  N.v12DeficitStatusDisplay(mkRow({ ordered: 0, expected: "" })), "Не заказано");
check("заказ есть, нет ожидаемой даты → «Не заказано»",
  N.v12DeficitStatusDisplay(mkRow({ ordered: 10, expected: "" })), "Не заказано");
check("ordered < дефицит (дата есть) → «Заказано частично»",
  N.v12DeficitStatusDisplay(mkRow({ ordered: 3, expected: "2026-09-10" })), "Заказано частично");
check("ordered >= дефицит, дата <= срок → «Ожидание поставки (в Срок)»",
  N.v12DeficitStatusDisplay(mkRow({ ordered: 10, expected: "2026-09-10", deadline: "2026-09-30" })),
  "Ожидание поставки (в Срок)");
check("ordered >= дефицит, дата > срок → «Ожидание поставки (Опаздывает)»",
  N.v12DeficitStatusDisplay(mkRow({ ordered: 10, expected: "2026-10-05", deadline: "2026-09-30" })),
  "Ожидание поставки (Опаздывает)");
check("ошибка валидации → «Ошибка данных»",
  N.v12DeficitStatusDisplay(mkRow({ ordered: 0, validationError: true })), "Ошибка данных");

console.log("=== D2: v12DeficitStatusColor ===");
check("«Не заказано» → RED", N.v12DeficitStatusColor("Не заказано"), C.COLORS.RED);
check("«Заказано частично» → RED", N.v12DeficitStatusColor("Заказано частично"), C.COLORS.RED);
check("«Ожидание поставки (в Срок)» → YELLOW", N.v12DeficitStatusColor("Ожидание поставки (в Срок)"), C.COLORS.YELLOW);
check("«Ожидание поставки (Опаздывает)» → ORANGE", N.v12DeficitStatusColor("Ожидание поставки (Опаздывает)"), C.COLORS.ORANGE);
check("«Ошибка данных» → GRAY", N.v12DeficitStatusColor("Ошибка данных"), C.COLORS.GRAY);
check("неизвестный статус → WHITE", N.v12DeficitStatusColor("Что-то иное"), C.COLORS.WHITE);

console.log("=== D3: v12RefreshDeficitSummary красит «Не заказано» в красный ===");
["POSITION_STATE", "DEFICIT_SUMMARY", "MATERIAL_STATE", "SUPPLY", "DASHBOARD", "BOM_REVISION", "EXCLUDED_BOMS", "AUDIT_LOG", "ARCHIVE", "MATERIAL_HISTORY", "WORKING_BOM", "PICKING", "EVENT_LOG"]
  .forEach(function (k) { makeSheet(C.SHEETS[k], C.HEADERS[k]); });
{
  const PS = sheets[C.SHEETS.POSITION_STATE];
  PS._data = [C.HEADERS.POSITION_STATE.slice()];
  PS._data.push(mkRow({ ordered: 0, expected: "" }));   // «Не заказано»

  globalThis.__bg = [];
  N.v12RefreshDeficitSummary();

  const firstRowColor = globalThis.__bg[0] && globalThis.__bg[0][0];
  check("строка «Не заказано» окрашена в RED", firstRowColor, C.COLORS.RED);
  const D = C.DEFICIT_COLUMNS;
  check("статус в строке = «Не заказано»",
    sheets[C.SHEETS.DEFICIT_SUMMARY]._data[1][D.STATUS - 1], "Не заказано");
}

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
