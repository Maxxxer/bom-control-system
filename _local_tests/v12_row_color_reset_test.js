/**
 * ЛОКАЛЬНЫЙ тест: сброс заливки «освободившихся» строк при сокращении числа
 * строк проекции (Сводка дефицитов / ОТБОРКА / WORKING BOM / Dashboard).
 *
 * Проверяет механизм: clearBody/clearRange очищают ЗНАЧЕНИЯ и дополнительно
 * выставляют БЕЛЫЙ фон на весь очищаемый диапазон. Без этого при удалении
 * позиций строки ниже нового числа данных сохраняли бы цвет прежних позиций.
 *
 *   C1 — clearBody по телу из 3 строк: clearContent И setBackground(#FFFFFF)
 *        вызваны ровно один раз на диапазон (2,1,3,lastCol);
 *   C2 — на пустом теле (только заголовок) вызовов нет;
 *   C3 — сброс фона идёт ПОСЛЕ очистки значений (порядок операций).
 *
 * ВАЖНО: файл — Node-скрипт и НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_row_color_reset_test.js
 */

const fs = require("fs");
const vm = require("vm");

// Стенограмма вызовов на диапазоне.
const record = [];

function makeSheet(name, dataRows) {
  return {
    _name: name,
    _data: dataRows,
    getName() { return this._name; },
    getLastRow() { return this._data.length; },
    getLastColumn() {
      let lc = 0;
      for (let i = 0; i < this._data.length; i++) {
        const r = this._data[i] || [];
        if (r.length > lc) { lc = r.length; }
      }
      return lc;
    },
    getRange(row, col, numRows, numCols) {
      numRows = numRows || 1;
      numCols = numCols || 1;
      const self = this;
      return {
        getSheet() { return self; },
        clearContent() {
          record.push({ op: "clearContent", row: row, col: col, numRows: numRows, numCols: numCols });
          return this;
        },
        setBackground(color) {
          record.push({ op: "setBackground", row: row, col: col, numRows: numRows, numCols: numCols, color: color });
          return this;
        }
      };
    }
  };
}

const sheets = {};
globalThis.SpreadsheetApp = {
  getActive() {
    return {
      getSheetByName(n) { return sheets[n] || null; },
      insertSheet(n) { return makeSheet(n, []); }
    };
  }
};

vm.runInThisContext(fs.readFileSync("sheet_service.js", "utf8"), { filename: "sheet_service.js" });

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

function lastOp(opName) {
  for (let i = record.length - 1; i >= 0; i--) {
    if (record[i].op === opName) { return record[i]; }
  }
  return null;
}

console.log("=== C1: clearBody из 3 строк -> очистка + белый фон на (2,1,3,lastCol) ===");
record.length = 0;
const s1 = makeSheet("DEFICIT_SUMMARY", [
  ["h1", "h2", "h3", "h4", "h5"],   // заголовок
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 5]
]);
globalThis.clearBody(s1);
const cc = lastOp("clearContent");
const bg = lastOp("setBackground");
check("C1: clearContent вызван", cc !== null, true);
check("C1: clearContent диапазон = (2,1,3,5)", cc && (cc.row + "," + cc.col + "," + cc.numRows + "," + cc.numCols), "2,1,3,5");
check("C1: setBackground вызван", bg !== null, true);
check("C1: setBackground диапазон = (2,1,3,5)", bg && (bg.row + "," + bg.col + "," + bg.numRows + "," + bg.numCols), "2,1,3,5");
check("C1: цвет = #FFFFFF", bg && bg.color, "#FFFFFF");

console.log("=== C2: пустое тело (только заголовок) -> вызовов нет ===");
record.length = 0;
const s2 = makeSheet("PICKING", [["h1", "h2"]]);
globalThis.clearBody(s2);
check("C2: операций на диапазоне нет", record.length, 0);

console.log("=== C3: порядок — сначала clearContent, затем setBackground ===");
record.length = 0;
const s3 = makeSheet("WORKING_BOM", [["h1"], [1], [2]]);
globalThis.clearBody(s3);
check("C3: порядок операций", record.map(function (r) { return r.op; }).join(","), "clearContent,setBackground");

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED"); } else { console.log("FAILURES: " + failures); process.exitCode = 1; }
