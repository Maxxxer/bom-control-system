/**
 * ЛОКАЛЬНЫЙ регрессионный тест UI-слоя V3 (v12_ui.js).
 *
 * Проверяет:
 *   A) картинка-кнопка: base64 — валидный PNG 124x20 (размеры из V12_UI);
 *   B) v12Toast: всплывающее сообщение справа снизу, 3 с по умолчанию,
 *      8 с для ошибок, отсутствие UI не бросает исключение;
 *   C) v12InstallApplyButton: кнопка ставится на рабочие листы в A1,
 *      назначается скрипт v12ApplyChangesUI, расширяется колонка A;
 *   D) идемпотентность: повторная установка не плодит копии кнопки;
 *   E) если привязка скрипта не подтвердилась — лист попадает в unbound
 *      и пишется WARNING;
 *   F) удаление: чужие картинки не трогаются, null-лист безопасен;
 *   G/H) пункт меню v12InstallApplyButtonUI: всплывашка об успехе и об ошибке.
 *
 * ВАЖНО: файл — Node-скрипт (require/vm), НЕ выгружается в Apps Script.
 * Запуск: node _local_tests/v12_ui_test.js
 */

const fs = require("fs");
const vm = require("vm");

const state = {
  toasts: [],
  toastThrows: false,
  images: [],
  columnWidths: [],
  insertThrows: false,
  assignSticks: true
};

const sheets = {};

function makeSheet(name) {
  return {
    _name: name,
    getName() { return this._name; },
    setColumnWidth(col, width) {
      state.columnWidths.push({ sheet: name, col: col, width: width });
    },
    insertImage(blob, col, row, offsetX, offsetY) {
      if (state.insertThrows) {
        throw new Error("insertImage failed");
      }
      const image = {
        sheet: name, blob: blob, col: col, row: row,
        offsetX: offsetX, offsetY: offsetY,
        script: "", width: 0, height: 0, altTitle: "", altDesc: "",
        removed: false,
        setAltTextTitle(t) { this.altTitle = t; return this; },
        setAltTextDescription(d) { this.altDesc = d; return this; },
        assignScript(fn) { this.script = state.assignSticks ? fn : ""; return this; },
        getScript() { return this.script; },
        setWidth(w) { this.width = w; return this; },
        setHeight(h) { this.height = h; return this; },
        remove() { this.removed = true; }
      };
      state.images.push(image);
      return image;
    },
    getImages() {
      return state.images.filter(function (i) { return i.sheet === name && !i.removed; });
    }
  };
}

globalThis.SpreadsheetApp = {
  getActive() {
    return {
      getSheetByName(n) { return sheets[n] || null; },
      insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; },
      toast(msg, title, sec) {
        if (state.toastThrows) {
          throw new Error("no UI available");
        }
        state.toasts.push({ msg: msg, title: title, sec: sec });
      }
    };
  },
  getUi() { return { alert() {}, createMenu() { return this; } }; },
  newDataValidation() { return { requireCheckbox() { return this; }, requireValueInList() { return this; }, build() { return {}; } }; }
};
globalThis.LockService = { getScriptLock() { return { waitLock() {}, tryLock() { return true; }, releaseLock() {} }; } };
globalThis.PropertiesService = { getScriptProperties() { return { getProperty() { return null; }, setProperty() {}, deleteProperty() {} }; } };
globalThis.Session = { getActiveUser() { return { getEmail() { return "test@example.com"; } }; } };
globalThis.Utilities = {
  getUuid() { return "uuid-" + Math.random().toString(16).slice(2); },
  base64Decode(str) { return Array.from(Buffer.from(str, "base64")); },
  newBlob(bytes, mime, name) {
    return {
      bytes: bytes, mime: mime, name: name,
      getBytes() { return this.bytes; },
      getContentType() { return this.mime; },
      getName() { return this.name; }
    };
  }
};

const logEntries = [];
const LOG_LEVEL_NAMES = { INFO: true, ERROR: true, WARNING: true, WARN: true, DEBUG: true };
globalThis.logSystem = function (fn, message, data, level) {
  if (typeof data === "string" && Object.prototype.hasOwnProperty.call(LOG_LEVEL_NAMES, data)) {
    level = data;
    data = "";
  }
  logEntries.push({ fn: fn, message: message, level: level || "INFO" });
};
globalThis.flushSystemLog = function () {};

const files = ["v12_config.js", "sheet_service.js", "v12_ui.js"];
const src = files.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n")
  + "\n;globalThis.__UI = { V12_UI: V12_UI, v12Toast: v12Toast, v12BuildApplyButtonBlob: v12BuildApplyButtonBlob,"
  + " v12InstallApplyButton: v12InstallApplyButton, v12RemoveApplyButton: v12RemoveApplyButton,"
  + " v12RemoveApplyButtonFromSheet: v12RemoveApplyButtonFromSheet, v12InstallApplyButtonUI: v12InstallApplyButtonUI };";

vm.runInThisContext(src, { filename: "v12-ui-bundle.js" });
const N = globalThis.__UI;
// V12_CONFIG объявлен как const — в этом realm он доступен по имени, но не
// как свойство globalThis (как и в остальных тестах проекта).
const C = V12_CONFIG;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures++;
  }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

// Листы, на которые ставится кнопка.
N.V12_UI.BUTTON_SHEETS.forEach(function (key) { sheets[C.SHEETS[key]] = makeSheet(C.SHEETS[key]); });
const DEFICIT = C.SHEETS.DEFICIT_SUMMARY;
const PICKING = C.SHEETS.PICKING;
const WORKING = C.SHEETS.WORKING_BOM;

// ---------- A) картинка-кнопка ----------
console.log("=== A: PNG кнопки из base64 ===");
const blob = N.v12BuildApplyButtonBlob();
const bytes = blob.getBytes();
const magic = bytes.slice(0, 8).join(",");
check("A1: PNG-сигнатура", magic, "137,80,78,71,13,10,26,10");
check("A2: MIME-тип", blob.getContentType(), "image/png");
const pngWidth = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
const pngHeight = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
check("A3: ширина совпадает с V12_UI.BUTTON_WIDTH", pngWidth, N.V12_UI.BUTTON_WIDTH);
check("A4: высота совпадает с V12_UI.BUTTON_HEIGHT", pngHeight, N.V12_UI.BUTTON_HEIGHT);
check("A5: цветовой тип PNG = RGBA (6)", bytes[25], 6);

// ---------- B) toast ----------
console.log("=== B: v12Toast ===");
state.toasts.length = 0;
check("B1: v12Toast вернул true", N.v12Toast("Применено изменений: 5"), true);
check("B2: сообщений одно", state.toasts.length, 1);
check("B3: текст сообщения", state.toasts[0].msg, "Применено изменений: 5");
check("B4: заголовок", state.toasts[0].title, "BOM CONTROL V12");
check("B5: таймаут 3 секунды", state.toasts[0].sec, 3);

state.toasts.length = 0;
N.v12Toast("Ошибка: тест", N.V12_UI.TOAST_SECONDS_ERROR);
check("B6: таймаут ошибки 8 секунд", state.toasts[0].sec, 8);

state.toasts.length = 0;
N.v12Toast(null);
check("B7: null превращается в пустую строку", state.toasts[0].msg, "");

// Нет UI (фон): не бросаем, пишем в лог.
state.toastThrows = true;
logEntries.length = 0;
check("B8: без UI возвращает false", N.v12Toast("нет окна"), false);
check("B9: без UI пишется лог", logEntries.length >= 1, true);
check("B10: уровень лога ERROR", logEntries.length ? logEntries[0].level : "", "ERROR");
state.toastThrows = false;

// ---------- C) установка кнопки ----------
console.log("=== C: v12InstallApplyButton ===");
state.images.length = 0;
state.columnWidths.length = 0;
logEntries.length = 0;
const installResult = N.v12InstallApplyButton();

check("C1: установлено на 3 листа", installResult.installed.length, 3);
check("C2: непривязанных нет", installResult.unbound.length, 0);
check("C3: картинок ровно 3", state.images.length, 3);
check("C4: колонка A расширена на 3 листах", state.columnWidths.length, 3);
check("C5: ширина колонки", state.columnWidths[0].width, N.V12_UI.BUTTON_COLUMN_WIDTH);
check("C6: колонка A", state.columnWidths[0].col, 1);

const onDeficit = state.images.filter(function (i) { return i.sheet === DEFICIT; })[0];
check("C7: кнопка стоит на листе Сводка", Boolean(onDeficit), true);
check("C8: привязан якорь к A1", onDeficit.col === 1 && onDeficit.row === 1, true);
check("C9: смещения внутри ячейки", onDeficit.offsetX + ":" + onDeficit.offsetY, "2:1");
check("C10: назначен скрипт v12ApplyChangesUI", onDeficit.getScript(), "v12ApplyChangesUI");
check("C11: ширина картинки", onDeficit.width, N.V12_UI.BUTTON_WIDTH);
check("C12: высота картинки", onDeficit.height, N.V12_UI.BUTTON_HEIGHT);
check("C13: alt-подпись", onDeficit.altDesc, N.V12_UI.BUTTON_ALT);
check("C14: кнопки на всех трёх листах", state.images.map(function (i) { return i.sheet; }).sort().join("|"),
  [DEFICIT, PICKING, WORKING].sort().join("|"));
check("C15: лог об установке", logEntries.length >= 1 && logEntries[0].level, "INFO");

// ---------- D) идемпотентность ----------
console.log("=== D: повторная установка не плодит кнопки ===");
const secondInstall = N.v12InstallApplyButton();
check("D1: после повтора на каждом листе одна кнопка",
  sheets[DEFICIT].getImages().length + ":" + sheets[PICKING].getImages().length + ":" + sheets[WORKING].getImages().length,
  "1:1:1");
check("D2: повтор тоже отчитался об установке", secondInstall.installed.length, 3);
check("D3: старые кнопки удалены (3 удаления)", state.images.filter(function (i) { return i.removed; }).length, 3);

// ---------- E) привязка скрипта не подтвердилась ----------
console.log("=== E: unbound, если скрипт не назначился ===");
state.assignSticks = false;
state.images.length = 0;
state.columnWidths.length = 0;
logEntries.length = 0;
const unboundResult = N.v12InstallApplyButton();
check("E1: все листы в unbound", unboundResult.unbound.length, 3);
check("E2: installed пуст", unboundResult.installed.length, 0);
check("E3: WARNING в логе", logEntries.length ? logEntries[0].level : "", "WARNING");
state.assignSticks = true;

// ---------- F) удаление ----------
console.log("=== F: удаление кнопок ===");
check("F1: null-лист безопасен", N.v12RemoveApplyButtonFromSheet(null), 0);
check("F2: лист без getImages безопасен", N.v12RemoveApplyButtonFromSheet({}), 0);

state.images.length = 0;
const foreignSheet = makeSheet("ЧУЖОЙ_ЛИСТ");
foreignSheet.insertImage(blob, 1, 1);
foreignSheet.getImages()[0].assignScript("someOtherScript");
logEntries.length = 0;
check("F3: чужая картинка не удаляется", N.v12RemoveApplyButtonFromSheet(foreignSheet), 0);
check("F4: чужая картинка на месте", foreignSheet.getImages().length, 1);

state.images.length = 0;
N.v12InstallApplyButton();
check("F5: v12RemoveApplyButton удаляет все 3 кнопки", N.v12RemoveApplyButton(), 3);
check("F6: листы очищены", sheets[DEFICIT].getImages().length, 0);

// ---------- G/H) пункт меню ----------
console.log("=== G: пункт меню «Восстановить кнопку» ===");
state.images.length = 0;
state.toasts.length = 0;
const uiResult = N.v12InstallApplyButtonUI();
check("G1: вернул результат установки", uiResult && uiResult.installed.length, 3);
check("G2: всплывающее сообщение показано", state.toasts.length, 1);
check("G3: в сообщении перечислены листы", state.toasts[0].msg.indexOf(DEFICIT) >= 0, true);
check("G4: таймаут успеха 3 с", state.toasts[0].sec, 3);

state.toasts.length = 0;
state.insertThrows = true;
logEntries.length = 0;
check("H1: ошибка вставки → null", N.v12InstallApplyButtonUI(), null);
check("H2: всплывающее сообщение об ошибке", state.toasts.length, 1);
check("H3: текст ошибки", state.toasts[0].msg.indexOf("Не удалось поставить кнопку") === 0, true);
check("H4: таймаут ошибки 8 с", state.toasts[0].sec, 8);
check("H5: ошибка залогирована", logEntries.length ? logEntries[0].level : "", "ERROR");
state.insertThrows = false;

console.log("");
if (failures === 0) {
  console.log("ALL TESTS PASSED");
} else {
  console.log("FAILURES: " + failures);
  process.exitCode = 1;
}
