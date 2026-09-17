/**
 * ЛОКАЛЬНЫЙ тест ЛИЧНОГО ФАЙЛА ОТБОРЩИКА (сателлита).
 *
 * Мастер подменяется заглушкой UrlFetchApp: проверяется поведение сателлита
 * «от имени мастера» — сбор строк, хранение галочек, отправка лота, сообщения.
 *
 *   S1 — проверка настроек (адрес мастера, секрет, e-mail);
 *   S2 — обновление списка: галочки СОХРАНЯЮТСЯ по Position ID;
 *   S3 — сбор отмеченного в лот;
 *   S4 — отправка лота: успех, галочки снимаются, итог показан;
 *   S5 — двойное нажатие: тот же номер лота;
 *   S6 — мягкий захват: предупреждение мастера показано, работа продолжается;
 *   S7 — отказ мастера переводится в понятный текст, галочка НЕ снимается;
 *   S8 — синхронизация мастера: лот не отправлен, галочка сохранена;
 *   S9 — установка: фильтр проекта в B1 и кнопка «ПРИМЕНИТЬ».
 *
 * Файл — Node-скрипт (require/vm), в Apps Script НЕ выгружается.
 * Запуск: node _local_tests/sat_gate_test.js
 */

const fs = require("fs");
const vm = require("vm");

const sheets = {};
let props = {};

function makeSheet(name, header) {
  const data = header ? [header.slice()] : [];
  const sheet = {
    _name: name, _data: data, _images: [], _validations: 0,
    getName() { return this._name; },
    getLastRow() {
      let last = 0;
      for (let r = 0; r < this._data.length; r++) {
        const row = this._data[r] || [];
        for (let c = 0; c < row.length; c++) {
          const v = row[c];
          if (v !== "" && v !== null && v !== undefined) { last = r + 1; break; }
        }
      }
      return last;
    },
    getMaxRows() { return Math.max(1000, this._data.length + 1); },
    getMaxColumns() { return 40; },
    getRange(row, col, numRows, numCols) {
      numRows = numRows || 1; numCols = numCols || 1;
      const self = this;
      return {
        getValue() { const r = self._data[row - 1]; return r ? (r[col - 1] === undefined || r[col - 1] === null ? "" : r[col - 1]) : ""; },
        getValues() { const out = []; for (let i = 0; i < numRows; i++) { const s = self._data[row - 1 + i] || [], rr = []; for (let j = 0; j < numCols; j++) { const v = s[col - 1 + j]; rr.push(v === undefined || v === null ? "" : v); } out.push(rr); } return out; },
        setValue(v) { self._setCell(row, col, v); return this; },
        setValues(vals) { for (let i = 0; i < vals.length; i++) { for (let j = 0; j < vals[i].length; j++) { self._setCell(row + i, col + j, vals[i][j]); } } return this; },
        clearContent() { for (let i = 0; i < numRows; i++) { for (let j = 0; j < numCols; j++) { self._setCell(row + i, col + j, ""); } } return this; },
        clearDataValidations() { return this; }, getDataValidations() { return []; },
        setDataValidation() { self._validations++; return this; },
        setBackground() { return this; }, setBackgrounds() { return this; },
        setFontWeight() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; }
      };
    },
    _setCell(r, c, v) {
      const ri = r - 1, ci = c - 1;
      while (this._data.length <= ri) { this._data.push([]); }
      const rowArr = this._data[ri];
      while (rowArr.length <= ci) { rowArr.push(""); }
      rowArr[ci] = v;
    },
    setFrozenRows() {}, setColumnWidth() {}, getImages() { return this._images; },
    insertImage() {
      const self = this;
      const img = {
        _script: "",
        assignScript(s) { img._script = s; return img; },
        getScript() { return img._script; },
        setAltTextTitle() { return img; }, setAltTextDescription() { return img; },
        setWidth() { return img; }, setHeight() { return img; },
        remove() { self._images = self._images.filter(function (x) { return x !== img; }); }
      };
      this._images.push(img);
      return img;
    }
  };
  sheets[name] = sheet;
  return sheet;
}

globalThis.__toasts = [];
globalThis.SpreadsheetApp = {
  getActive() {
    return {
      getId() { return "sat-sheet-id"; },
      getSheetByName(n) { return sheets[n] || null; },
      insertSheet(n) { return makeSheet(n); },
      toast(msg) { globalThis.__toasts.push(String(msg)); }
    };
  },
  getUi() {
    return {
      alert() {}, prompt() { return { getSelectedButton() { return null; }, getResponseText() { return ""; } }; },
      createMenu() { return this; }, addItem() { return this; }, addSeparator() { return this; },
      addToUi() {}, ButtonSet: {}, Button: {}
    };
  },
  newDataValidation() {
    return { requireCheckbox() { return this; }, requireValueInList() { return this; }, build() { return {}; } };
  },
  flush() {}
};

globalThis.PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(k) { return props[k] === undefined ? null : props[k]; },
      setProperty(k, v) { props[k] = String(v); },
      deleteProperty(k) { delete props[k]; }
    };
  }
};

globalThis.Session = {
  getActiveUser() { return { getEmail() { return "picker-a@test.local"; } }; },
  getScriptTimeZone() { return "Europe/Moscow"; }
};

globalThis.Utilities = {
  getUuid() { return "uuid-" + Math.random().toString(16).slice(2); },
  formatDate(d) {
    const p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  },
  sleep() {}, newBlob() { return {}; }, base64Decode() { return []; }
};

globalThis.ScriptApp = {
  getProjectTriggers() { return []; }, deleteTrigger() {},
  newTrigger(handler) {
    const t = { forSpreadsheet() { return t; }, onOpen() { return t; }, onEdit() { return t; },
      create() { return t; }, getHandlerFunction() { return handler; } };
    return t;
  }
};

globalThis.logSystem = function () {};
globalThis.flushSystemLog = function () {};

// -------------------------------------------------------- заглушка мастера
globalThis.__master = { submitCalls: 0, lastPayload: null, lastBatchId: "" };
globalThis.__masterConflict = null;
globalThis.__masterError = null;

function masterReply(payload) {
  const H = ["Position ID", "BOM", "№ п/п", "Артикул", "Производитель", "Наименование",
    "Модель", "Ед.изм", "Кол-во", "Доступно для производства", "Состояние поставки",
    "Дата поставки", "Отметка получено"];
  if (payload.action === "pickers") {
    return { ok: true, pickers: [{ email: "picker-a@test.local", role: "warehouse" }],
      projects: ["P1", "P2"], claims: [] };
  }
  if (payload.action === "rows") {
    return { ok: true, project: payload.project || "", headers: H, rows: [
      { values: ["BOM1:C1", "BOM1", 1, "C1", "Изг", "Материал C1", "M1", "шт", 5, 5, "В пути", "2026-09-10"], color: "#FFF2CC" },
      { values: ["BOM1:C2", "BOM1", 2, "C2", "Изг", "Материал C2", "M1", "шт", 3, 3, "В пути", "2026-09-11"], color: "#FFFFFF" }
    ], claims: [] };
  }
  if (payload.action === "claim") {
    return { ok: true, project: payload.project, expiresAt: "2026-09-17T14:00:00Z",
      warning: globalThis.__masterConflict };
  }
  if (payload.action === "release") {
    return { ok: true, project: payload.project, released: 1 };
  }
  if (payload.action === "submit") {
    globalThis.__master.submitCalls++;
    const total = (payload.items || []).length;
    // Запоминаем размер лота отдельно: сразу после отправки сателлит сам
    // обновляет список, и lastPayload перезаписывается запросом строк.
    globalThis.__master.lastSubmitItems = total;
    const again = globalThis.__master.submitCalls > 1 && payload.batchId === globalThis.__master.lastBatchId;
    globalThis.__master.lastBatchId = payload.batchId;
    return { ok: true, already: again, batchId: payload.batchId, status: "APPLIED",
      applied: total, failed: 0, errors: [], total: total, error: "",
      retryAfterSec: 0, warning: globalThis.__masterConflict };
  }
  if (payload.action === "status") {
    return { ok: true, batches: [{ batchId: globalThis.__master.lastBatchId, status: "APPLIED",
      applied: 1, failed: 0, total: 1, error: "" }], claims: [], projects: ["P1"] };
  }
  return { ok: false, error: "unknown_action:" + payload.action };
}

globalThis.UrlFetchApp = {
  fetch(url, options) {
    const payload = JSON.parse(options.payload);
    globalThis.__master.lastPayload = payload;
    if (globalThis.__masterError) {
      const err = globalThis.__masterError;
      globalThis.__masterError = null;
      return { getResponseCode() { return 200; }, getContentText() { return JSON.stringify(err); } };
    }
    return { getResponseCode() { return 200; },
      getContentText() { return JSON.stringify(masterReply(payload)); } };
  }
};

// --------------------------------------------------------- загрузка сателлита
const SAT_FILES = ["sat_config.js", "sat_api.js", "sat_sheet.js", "sat_refresh.js",
  "sat_submit.js", "sat_menu.js", "sat_install.js"];
const NAMES = ["SAT_CONFIG", "satCall", "satCheckConfigured", "satRefresh", "satSubmit",
  "satCollectChecked", "satClearChecked", "satCountChecked", "satEnsureSheet",
  "satInstallProjectFilter", "satInstallButton", "satResolveBatchId", "satItemsSignature",
  "satGetActor", "satExplainError"];

vm.runInThisContext(
  SAT_FILES.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n") +
  "\n;globalThis.__S = { " + NAMES.map(function (n) { return n + ": " + n; }).join(", ") + " };",
  { filename: "sat-bundle.js" }
);
const S = globalThis.__S;
const CFG = S.SAT_CONFIG;
const COL = CFG.COLUMNS;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

PropertiesService.getScriptProperties().setProperty(CFG.PROP.MASTER_URL, "https://master/exec");
PropertiesService.getScriptProperties().setProperty(CFG.PROP.TOKEN, "PBT-test");
PropertiesService.getScriptProperties().setProperty(CFG.PROP.ACTOR, "picker-a@test.local");

console.log("=== S1: настройки файла ===");
check("S1: настройки заполнены", S.satCheckConfigured().ok, true);
check("S1: отборщик прочитан", S.satGetActor(), "picker-a@test.local");
check("S1: понятный текст об отказе",
  S.satExplainError("unauthorized").indexOf("Неверный секрет") === 0, true);

console.log("=== S2: обновление списка и сохранение галочек ===");
const sheet = S.satEnsureSheet();
// Первое обновление: строки приходят от мастера (витрина наполняется).
const first = S.satRefresh({ silent: true, skipClaim: true });
check("S2: обновление прошло", first.ok, true);
check("S2: строк записано", first.written, 2);
check("S2: первая строка — из мастера", sheet.getRange(2, COL.POSITION_ID).getValue(), "BOM1:C1");
// Отборщик отмечает позицию, затем обновляет список ещё раз.
sheet.getRange(2, COL.CHECKBOX).setValue(true);
const refreshed = S.satRefresh({ silent: true, skipClaim: true });
check("S2: строка перезаписана", refreshed.written, 2);
check("S2: галочка сохранена по Position ID", refreshed.keptChecked, 1);
check("S2: галочка осталась на своём ID", sheet.getRange(2, COL.CHECKBOX).getValue(), true);
check("S2: у второй позиции галочки нет", sheet.getRange(3, COL.CHECKBOX).getValue(), false);
check("S2: уведомление показано",
  String(sheet.getRange(1, 15).getValue()).indexOf("Позиций") >= 0, true);

console.log("=== S3: сбор отмеченного в лот ===");
const collected = S.satCollectChecked(sheet);
check("S3: отмечена одна позиция", collected.count, 1);
check("S3: в лот ушёл её Position ID", collected.items[0].positionId, "BOM1:C1");
check("S3: элемент помечен отмеченным", collected.items[0].checked, true);

console.log("=== S4: отправка лота ===");
globalThis.__toasts = [];
const sent = S.satSubmit();
check("S4: лот отправлен", sent.ok, true);
check("S4: применено позиций", sent.applied, 1);
check("S4: мастеру ушёл один item", globalThis.__master.lastSubmitItems, 1);
check("S4: галочек на листе не осталось", S.satCountChecked(sheet), 0);
check("S4: показан итог",
  globalThis.__toasts.join(" | ").indexOf("передано производству") >= 0, true);
check("S4: в запросе был секрет", globalThis.__master.lastPayload.token, "PBT-test");
check("S4: в запросе был отборщик", globalThis.__master.lastPayload.actor, "picker-a@test.local");

console.log("=== S5: защита от двойного нажатия ===");
const sig = S.satItemsSignature([{ positionId: "BOM1:C1", checked: true }]);
check("S5: тот же набор — тот же номер лота",
  S.satResolveBatchId(sig).batchId === S.satResolveBatchId(sig).batchId, true);
sheet.getRange(2, COL.CHECKBOX).setValue(true);
const again = S.satSubmit();
check("S5: повторная отправка не сломалась", again.ok, true);
check("S5: мастер получил повторный запрос", globalThis.__master.submitCalls >= 2, true);
S.satClearChecked(sheet);

console.log("=== S6: мягкий захват (предупреждение мастера) ===");
// Захват берётся по выбранному проекту, поэтому проект должен быть задан.
sheet.getRange(1, 2).setValue("P1");
globalThis.__masterConflict = { claimedBy: "picker-b@test.local",
  claimedAt: "2026-09-17T10:00:00Z", expiresAt: "2026-09-17T12:00:00Z" };
globalThis.__toasts = [];
const warned = S.satRefresh({ silent: false });
check("S6: обновление НЕ отменено", warned.ok, true);
check("S6: предупреждение получено", !!warned.warning, true);
check("S6: в тексте — кто занял",
  globalThis.__toasts.join(" | ").indexOf("picker-b@test.local") >= 0, true);
check("S6: работа продолжается, строки записаны", warned.written, 2);
globalThis.__masterConflict = null;

console.log("=== S7: отказ мастера при отправке ===");
sheet.getRange(2, COL.CHECKBOX).setValue(true);
globalThis.__masterError = { ok: false, error: "unauthorized" };
globalThis.__toasts = [];
const denied = S.satSubmit();
check("S7: отправка не удалась", denied.ok, false);
check("S7: показан понятный текст",
  globalThis.__toasts.join(" | ").indexOf("Неверный секрет") >= 0, true);
check("S7: галочка НЕ снята — можно повторить", S.satCountChecked(sheet), 1);

console.log("=== S8: мастер синхронизируется ===");
globalThis.__masterError = { ok: false, error: "sync_in_progress", retryAfterSec: 60 };
globalThis.__toasts = [];
const blocked = S.satSubmit();
check("S8: лот не отправлен", blocked.ok, false);
check("S8: сказано повторить",
  globalThis.__toasts.join(" | ").indexOf("синхронизац") >= 0, true);
check("S8: галочка сохранена", S.satCountChecked(sheet), 1);
S.satClearChecked(sheet);

console.log("=== S9: установка фильтра и кнопки ===");
const pickers = S.satCall(CFG.ACTIONS.PICKERS, {});
check("S9: список проектов получен", pickers.ok, true);
check("S9: проектов два", (pickers.data.projects || []).length, 2);
S.satInstallProjectFilter(sheet, pickers.data.projects);
check("S9: подпись фильтра в A1", sheet.getRange(1, 1).getValue(), "Проект →");
check("S9: выбранный проект сохранён (он есть в списке)", sheet.getRange(1, 2).getValue(), "P1");
// Если в B1 остался проект, которого больше нет у мастера, фильтр сбрасывается —
// иначе отборщик остался бы с пустым списком и не понял почему.
sheet.getRange(1, 2).setValue("P9");
S.satInstallProjectFilter(sheet, pickers.data.projects);
check("S9: неизвестный проект сброшен на «Все проекты»",
  sheet.getRange(1, 2).getValue(), CFG.FILTER.ALL);
const button = S.satInstallButton();
check("S9: кнопка поставлена", button.ok, true);
check("S9: кнопка привязана к отправке лота", button.bound, true);
check("S9: кнопок на листе — одна", sheet.getImages().length, 1);
check("S9: скрипт кнопки", sheet.getImages()[0].getScript(), CFG.UI.BUTTON_SCRIPT);

console.log("");
if (failures === 0) {
  console.log("ALL TESTS PASSED");
} else {
  console.log("FAILURES: " + failures);
  process.exitCode = 1;
}
