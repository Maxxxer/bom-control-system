/**
 * ЛОКАЛЬНЫЙ тест ЛОТОВ ОТБОРКИ и МЯГКИХ ЗАХВАТОВ (мастер).
 *
 *   B1 — приём лота: шапка PENDING + намерения с привязкой к лоту;
 *   B2 — применяется ТОЛЬКО этот лот;
 *   B3 — идемпотентность повторной отправки;
 *   B4 — мягкий захват: конфликт = предупреждение, а не отказ;
 *   B5 — освобождение проекта (чужую заявку снять нельзя);
 *   B6 — просроченный захват не активен и помечается EXPIRED;
 *   B7 — ограничения запроса (нет номера/актора, слишком большой лот);
 *   B8 — веб-API: секрет, права, маршрутизация, флаг синхронизации, health.
 *
 * Файл — Node-скрипт (require/vm) и в Apps Script НЕ выгружается.
 * Запуск: node _local_tests/v12_batches_test.js
 */

const fs = require("fs");
const vm = require("vm");

// ---------------------------------------------------------------- стабы Sheets
const sheets = {};
let props = {};

function makeSheet(name, header) {
  const data = header ? [header.slice()] : [];
  const sheet = {
    _name: name,
    _data: data,
    _notes: [],
    _validations: 0,
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
    getLastColumn() {
      let last = 0;
      for (let r = 0; r < this._data.length; r++) {
        const row = this._data[r] || [];
        for (let c = 0; c < row.length; c++) {
          const v = row[c];
          if (v !== "" && v !== null && v !== undefined && c + 1 > last) { last = c + 1; }
        }
      }
      return last;
    },
    getMaxRows() { return Math.max(1000, this._data.length + 1); },
    getMaxColumns() { return 40; },
    getDataRange() {
      const lastRow = this.getLastRow(), lastCol = this.getLastColumn(), src = this._data, out = [];
      for (let r = 0; r < lastRow; r++) {
        const row = src[r] || [], rr = [];
        for (let c = 0; c < lastCol; c++) {
          const v = row[c];
          rr.push(v === undefined || v === null ? "" : v);
        }
        out.push(rr);
      }
      return { getValues() { return out; } };
    },
    getRange(row, col, numRows, numCols) {
      numRows = numRows || 1;
      numCols = numCols || 1;
      const self = this;
      const ref = {
        getSheet() { return self; },
        getRow() { return row; },
        getColumn() { return col; },
        getNumRows() { return numRows; },
        getNumColumns() { return numCols; },
        getA1Notation() { return "R" + row + "C" + col; },
        getValue() {
          const r = self._data[row - 1];
          return r ? (r[col - 1] === undefined || r[col - 1] === null ? "" : r[col - 1]) : "";
        },
        getValues() {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const s = self._data[row - 1 + i] || [], rr = [];
            for (let j = 0; j < numCols; j++) {
              const v = s[col - 1 + j];
              rr.push(v === undefined || v === null ? "" : v);
            }
            out.push(rr);
          }
          return out;
        },
        setValue(v) { self._setCell(row, col, v); return ref; },
        setValues(vals) {
          for (let i = 0; i < vals.length; i++) {
            for (let j = 0; j < vals[i].length; j++) { self._setCell(row + i, col + j, vals[i][j]); }
          }
          return ref;
        },
        clearContent() {
          for (let i = 0; i < numRows; i++) {
            for (let j = 0; j < numCols; j++) { self._setCell(row + i, col + j, ""); }
          }
          return ref;
        },
        clearDataValidations() { return ref; },
        getDataValidations() { return []; },
        setDataValidation() { self._validations++; return ref; },
        setDataValidations() { return ref; },
        setBackgrounds() { return ref; },
        setBackground() { return ref; },
        setFontWeight() { return ref; },
        setFontColor() { return ref; },
        setNote() { return ref; },
        setNotes(notes) {
          self._notes = (notes || []).map(function (r) { return r[0]; });
          return ref;
        },
        setNumberFormat() { return ref; },
        setHorizontalAlignment() { return ref; },
        setVerticalAlignment() { return ref; },
        setWrapStrategy() { return ref; },
        setFontStyle() { return ref; },
        setFontSize() { return ref; }
      };
      return ref;
    },
    _setCell(r, c, v) {
      const ri = r - 1, ci = c - 1;
      while (this._data.length <= ri) { this._data.push([]); }
      const rowArr = this._data[ri];
      while (rowArr.length <= ci) { rowArr.push(""); }
      rowArr[ci] = v;
    },
    setFrozenRows() {}, setFrozenColumns() {}, setColumnWidth() {}, setRowHeight() {},
    hideColumns() {}, showColumns() {}, deleteColumn() {}, deleteColumns() {},
    insertColumnBefore() {}, insertColumnAfter() {}, insertRowBefore() {}, insertRowAfter() {},
    deleteRow() {}, deleteRows() {},
    setConditionalFormatRules() {}, getConditionalFormatRules() { return []; },
    protect() { return { setWarningOnly() { return this; }, setDescription() { return this; } }; },
    getProtections() { return []; },
    getImages() { return this._images || []; },
    appendRow(row) { this._data.push(row.slice ? row.slice() : row); },
    setName(n) { this._name = n; }
  };
  sheets[name] = sheet;
  return sheet;
}

globalThis.SpreadsheetApp = {
  getActive() {
    return {
      getId() { return "test-spreadsheet-id"; },
      getName() { return "Тестовая таблица"; },
      getSheetByName(n) { return sheets[n] || null; },
      insertSheet(n) { return makeSheet(n); },
      getSheets() { return Object.keys(sheets).map(function (k) { return sheets[k]; }); },
      toast() {}
    };
  },
  getUi() {
    return {
      alert() {},
      prompt() { return { getSelectedButton() { return null; }, getResponseText() { return ""; } }; },
      createMenu() { return this; }, addItem() { return this; }, addSeparator() { return this; },
      addToUi() {}, ButtonSet: { OK: "OK", OK_CANCEL: "OK_CANCEL" }, Button: { OK: "OK" }
    };
  },
  newDataValidation() {
    return {
      requireCheckbox() { return this; },
      requireValueInList() { return this; },
      build() { return {}; }
    };
  },
  newConditionalFormatRule() {
    return {
      whenTextContains() { return this; }, whenFormulaSatisfied() { return this; },
      setBackground() { return this; }, setFontColor() { return this; },
      setRanges() { return this; }, build() { return {}; }
    };
  },
  WrapStrategy: { WRAP: "WRAP", OVERFLOW: "OVERFLOW" },
  flush() {}
};

globalThis.LockService = {
  getScriptLock() {
    return { waitLock() {}, tryLock() { return true; }, releaseLock() {}, hasLock() { return true; } };
  },
  getDocumentLock() {
    return { waitLock() {}, tryLock() { return true; }, releaseLock() {} };
  }
};

globalThis.PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(k) { return props[k] === undefined ? null : props[k]; },
      setProperty(k, v) { props[k] = String(v); },
      deleteProperty(k) { delete props[k]; },
      getProperties() { return Object.assign({}, props); },
      setProperties(o) { Object.keys(o).forEach(function (k) { props[k] = String(o[k]); }); }
    };
  }
};

globalThis.CacheService = {
  getScriptCache() {
    const store = {};
    return {
      get(k) { return store[k] === undefined ? null : store[k]; },
      put(k, v) { store[k] = v; },
      remove(k) { delete store[k]; }
    };
  }
};

globalThis.__testUser = "test@example.com";
globalThis.Session = {
  getActiveUser() { return { getEmail() { return globalThis.__testUser; } }; },
  getEffectiveUser() { return { getEmail() { return globalThis.__testUser; } }; },
  getScriptTimeZone() { return "Europe/Moscow"; }
};

globalThis.Utilities = {
  getUuid() { return "uuid-" + Math.random().toString(16).slice(2); },
  formatDate(d) {
    const p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  },
  sleep() {},
  newBlob(bytes, type, name) {
    return { getBytes() { return bytes || []; }, getContentType() { return type; }, getName() { return name; } };
  },
  base64Decode() { return []; },
  base64Encode() { return ""; },
  computeDigest() { return [0]; },
  DigestAlgorithm: { MD5: "MD5" },
  Charset: { UTF_8: "UTF-8" }
};

globalThis.ContentService = {
  createTextOutput(s) {
    const o = { _s: String(s), setMimeType() { return o; }, getContent() { return o._s; } };
    return o;
  },
  MimeType: { JSON: "application/json", TEXT: "text/plain" }
};

globalThis.__triggers = [];
globalThis.ScriptApp = {
  getProjectTriggers() { return globalThis.__triggers.slice(); },
  deleteTrigger(t) {
    globalThis.__triggers = globalThis.__triggers.filter(function (x) { return x !== t; });
  },
  newTrigger(handler) {
    const t = {
      _handler: handler,
      forSpreadsheet() { return t; }, forDocument() { return t; },
      onOpen() { return t; }, onEdit() { return t; }, onFormSubmit() { return t; },
      timeBased() { return t; }, everyMinutes() { return t; }, everyHours() { return t; },
      everyDays() { return t; }, atHour() { return t; }, nearMinute() { return t; },
      between() { return t; }, onWeekDay() { return t; },
      create() { globalThis.__triggers.push(t); return t; },
      getHandlerFunction() { return t._handler; }
    };
    return t;
  },
  getScriptId() { return "test-script-id"; }
};

globalThis.UrlFetchApp = {
  fetch() { throw new Error("UrlFetchApp не заглушен в этом тесте"); }
};

globalThis.logSystem = function () {};
globalThis.flushSystemLog = function () {};

// ------------------------------------------------------------- загрузка проекта
const MASTER_FILES = [
  "v12_config.js", "utils.js", "sheet_service.js", "v12_utils.js", "v12_calculate.js",
  "v12_position_state.js", "v12_material_state.js", "v12_audit.js", "v12_roles.js",
  "v12_source.js", "v12_sheet_service.js", "v12_projections.js", "v12_operations.js",
  "v12_handoff.js", "v12_change_engine.js", "v12_events.js", "lock.js", "v12_trigger.js",
  "v12_queue.js", "v12_batches.js", "v12_webapp.js", "v12_ui.js", "v12_controller.js",
  "logger.js"
];

const NAMES = [
  "V12_CONFIG", "V12_ROLE_MAP", "v12SubmitPickingBatch", "v12ApplyBatch", "v12GetBatch",
  "v12CollectBatches", "v12CountPendingBatches", "v12GetActiveClaim", "v12ClaimProject",
  "v12ReleaseProject", "v12ExpireStaleClaims", "v12CollectActiveClaims",
  "v12SetSyncInProgress", "v12IsSyncInProgress", "v12BuildPositionRow", "v12OnEdit",
  "doPost", "doGet"
];

vm.runInThisContext(
  MASTER_FILES.map(function (f) { return fs.readFileSync(f, "utf8"); }).join("\n") +
  "\n;globalThis.__N = { " + NAMES.map(function (n) { return n + ": " + n; }).join(", ") + " };",
  { filename: "v12-bundle-batches.js" }
);
const N = globalThis.__N;
const CFG = N.V12_CONFIG;
const R = CFG.ROLES;
const B = CFG.PICKING_BATCH_COLUMNS;
const CL = CFG.PICKING_CLAIM_COLUMNS;
const Q = CFG.PENDING_EDIT_COLUMNS;

const PICKER_A = "picker-a@test.local";
const PICKER_B = "picker-b@test.local";
const VIEWER = "viewer@test.local";
V12_ROLE_MAP[PICKER_A] = R.WAREHOUSE;
V12_ROLE_MAP[PICKER_B] = R.PRODUCTION;
V12_ROLE_MAP[VIEWER] = R.VIEWER;

Object.keys(CFG.SHEETS).forEach(function (k) { makeSheet(CFG.SHEETS[k], CFG.HEADERS[k]); });
const PS = sheets[CFG.SHEETS.POSITION_STATE];
const BS = sheets[CFG.SHEETS.PICKING_BATCHES];
const CS = sheets[CFG.SHEETS.PICKING_CLAIMS];
const QS = sheets[CFG.SHEETS.PENDING_EDITS];

const POS_ID = "B1:C1";

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    "  (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}
function checkTrue(label, actual) { check(label, !!actual, true); }

/** Одна готовая к передаче позиция в POSITION_STATE. */
function seedPosition() {
  PS._data = [CFG.HEADERS.POSITION_STATE.slice()];
  PS._data.push(N.v12BuildPositionRow("B1", {
    bomName: "B1", row: 1, code: "C1", name: "Материал C1", model: "M1", unit: "шт",
    requiredQty: 5, reservedQty: 5, deadline: "2026-09-01"
  }, POS_ID, 1, { receivedByProduction: true, receivedByProductionQty: 5 }));
}

function resetLists() {
  seedPosition();
  QS._data = [CFG.HEADERS.PENDING_EDITS.slice()];
}

/** Число необработанных намерений указанного лота. */
function pendingForBatch(batchId) {
  let n = 0;
  for (let i = 1; i < QS._data.length; i++) {
    const r = QS._data[i] || [];
    if (String(r[Q.BATCH_ID - 1] || "").trim() === batchId &&
        String(r[Q.STATUS - 1] || "").trim() === CFG.PENDING_STATUS.PENDING) { n++; }
  }
  return n;
}

console.log("=== B1: приём лота ===");
resetLists();
BS._data = [CFG.HEADERS.PICKING_BATCHES.slice()];
CS._data = [CFG.HEADERS.PICKING_CLAIMS.slice()];

const sub1 = N.v12SubmitPickingBatch({
  batchId: "SAT-1", actor: PICKER_A, project: "P1",
  spreadsheetId: "sheet-a", items: [{ positionId: POS_ID, checked: true }]
});
check("B1: лот принят", sub1.ok, true);
check("B1: лот не был обработан ранее", sub1.already, false);
check("B1: позиций в лоте", sub1.total, 1);
const header1 = N.v12GetBatch("SAT-1");
check("B1: шапка лота записана", !!header1, true);
check("B1: статус шапки", String(header1.values[B.STATUS - 1]), CFG.PICKING_BATCH_STATUS.PENDING);
check("B1: отборщик в шапке", String(header1.values[B.ACTOR - 1]), PICKER_A);
check("B1: проект в шапке", String(header1.values[B.PROJECT - 1]), "P1");
check("B1: намерение привязано к лоту", pendingForBatch("SAT-1"), 1);
check("B1: лотов в статусе PENDING", N.v12CountPendingBatches(), 1);
check("B1: чужой лот не тронут", pendingForBatch("SAT-X"), 0);

console.log("=== B2: применение лота ===");
const app1 = N.v12ApplyBatch("SAT-1");
checkTrue("B2: позиция передана производству", app1.applied >= 1);
check("B2: намерений лота не осталось", pendingForBatch("SAT-1"), 0);
check("B2: статус шапки = статус применения",
  String(N.v12GetBatch("SAT-1").values[B.STATUS - 1]), app1.status);
check("B2: лотов в статусе PENDING больше нет", N.v12CountPendingBatches(), 0);
check("B2: лот попал в журнал", N.v12CollectBatches(10).length, 1);
check("B2: в журнале — наш номер лота", N.v12CollectBatches(10)[0].batchId, "SAT-1");

console.log("=== B3: идемпотентность ===");
const sub1again = N.v12SubmitPickingBatch({
  batchId: "SAT-1", actor: PICKER_A, project: "P1",
  spreadsheetId: "sheet-a", items: [{ positionId: POS_ID, checked: true }]
});
check("B3: повторный лот распознан как обработанный", sub1again.already, true);
check("B3: прежний статус возвращён", sub1again.status, app1.status);
check("B3: новых намерений не создано", pendingForBatch("SAT-1"), 0);

console.log("=== B4: мягкий захват проекта ===");
N.v12ClaimProject("P9", PICKER_A, "sheet-a");
check("B4: проект взят первым отборщиком", N.v12GetActiveClaim("P9").actor, PICKER_A);
const subB = N.v12SubmitPickingBatch({
  batchId: "SAT-2", actor: PICKER_B, project: "P9",
  spreadsheetId: "sheet-b", items: [{ positionId: POS_ID, checked: true }]
});
check("B4: второй отборщик НЕ получил отказ", subB.ok, true);
check("B4: предупреждение о конфликте", subB.warning && subB.warning.claimedBy, PICKER_A);
check("B4: захват перешёл ко второму", N.v12GetActiveClaim("P9").actor, PICKER_B);
check("B4: активный захват по P9 один", (function () {
  return N.v12CollectActiveClaims().filter(function (c) { return c.project === "P9"; }).length;
})(), 1);

console.log("=== B5: освобождение проекта ===");
check("B5: чужую заявку снять нельзя", N.v12ReleaseProject("P9", PICKER_A), 0);
check("B5: свою заявку снять можно", N.v12ReleaseProject("P9", PICKER_B), 1);
check("B5: после снятия захват не активен", N.v12GetActiveClaim("P9"), null);

console.log("=== B6: просроченный захват ===");
const expiredRow = new Array(CFG.COLUMN_COUNT.PICKING_CLAIMS).fill("");
expiredRow[CL.PROJECT - 1] = "P7";
expiredRow[CL.ACTOR - 1] = PICKER_A;
expiredRow[CL.CLAIMED_AT - 1] = new Date(new Date().getTime() - 5 * 60 * 60 * 1000);
expiredRow[CL.EXPIRES_AT - 1] = new Date(new Date().getTime() - 60 * 1000);
expiredRow[CL.STATUS - 1] = CFG.PICKING_CLAIM_STATUS.ACTIVE;
CS._data.push(expiredRow);
check("B6: просроченный захват не активен", N.v12GetActiveClaim("P7"), null);
check("B6: просроченных помечено", N.v12ExpireStaleClaims(), 1);
check("B6: просроченный захват вне списка активных", (function () {
  return N.v12CollectActiveClaims().filter(function (c) { return c.project === "P7"; }).length;
})(), 0);

console.log("=== B7: ограничения запроса ===");
check("B7: без номера лота — отказ",
  N.v12SubmitPickingBatch({ actor: PICKER_A, items: [] }).error, "batch_id_required");
check("B7: без отборщика — отказ",
  N.v12SubmitPickingBatch({ batchId: "SAT-3", items: [] }).error, "actor_required");
{
  const many = [];
  for (let i = 0; i <= CFG.BATCH.MAX_ITEMS; i++) { many.push({ positionId: "P" + i, checked: true }); }
  check("B7: слишком большой лот — отказ",
    N.v12SubmitPickingBatch({ batchId: "SAT-4", actor: PICKER_A, items: many }).error,
    "batch_too_large");
}
check("B7: лот с пустыми позициями принимается",
  N.v12SubmitPickingBatch({ batchId: "SAT-5", actor: PICKER_A, items: [] }).total, 0);

console.log("=== B8: веб-API ===");
const TOKEN = "PBT-test-token";
PropertiesService.getScriptProperties().setProperty(CFG.BATCH.TOKEN_PROPERTY, TOKEN);

function post(payload) {
  return JSON.parse(N.doPost({
    postData: { contents: JSON.stringify(payload), type: "application/json" },
    parameter: {}
  }).getContent());
}
function base(action, actor) { return { action: action, token: TOKEN, actor: actor }; }

check("B8: без секрета — отказ", post({ action: "pickers", actor: PICKER_A }).error, "unauthorized");
check("B8: с неверным секретом — отказ",
  post({ action: "pickers", token: "wrong", actor: PICKER_A }).error, "unauthorized");
check("B8: без актора — отказ",
  post({ action: "pickers", token: TOKEN }).error, "actor_required");
check("B8: нет прав на отборку", post(base("pickers", VIEWER)).error, "forbidden:" + R.VIEWER);
check("B8: неизвестное действие", post(base("nope", PICKER_A)).error, "unknown_action:nope");

const pickersRes = post(base("pickers", PICKER_A));
check("B8: список отборщиков получен", pickersRes.ok, true);
checkTrue("B8: проекты в ответе — массив", Array.isArray(pickersRes.projects));
checkTrue("B8: отборщики в ответе — массив", Array.isArray(pickersRes.pickers));

const rowsRes = post(base("rows", PICKER_A));
check("B8: строки отборки получены", rowsRes.ok, true);
check("B8: заголовки отборки в ответе", rowsRes.headers.length, CFG.COLUMN_COUNT.PICKING);
checkTrue("B8: строки — массив", Array.isArray(rowsRes.rows));
check("B8: захваты в ответе — массив", Array.isArray(rowsRes.claims), true);

const statusRes = post(base("status", PICKER_A));
check("B8: статус получен", statusRes.ok, true);
checkTrue("B8: журнал лотов — массив", Array.isArray(statusRes.batches));

check("B8: захват через веб-API выполнен",
  post({ action: "claim", token: TOKEN, actor: PICKER_A, project: "P5" }).ok, true);
check("B8: проект захвачен", N.v12GetActiveClaim("P5").actor, PICKER_A);
check("B8: без проекта захват отклонён",
  post({ action: "claim", token: TOKEN, actor: PICKER_A }).error, "project_required");

N.v12SetSyncInProgress(true);
const blocked = post(base("submit", PICKER_A));
check("B8: во время синхронизации лот отклонён", blocked.error, "sync_in_progress");
checkTrue("B8: указан срок повтора", Number(blocked.retryAfterSec) > 0);
PropertiesService.getScriptProperties().setProperty(CFG.BATCH.SYNC_FLAG_PROPERTY,
  String(new Date().getTime() - CFG.BATCH.SYNC_FLAG_TTL_MS - 1000));
check("B8: зависший флаг синхронизации игнорируется", N.v12IsSyncInProgress(), false);
N.v12SetSyncInProgress(false);
check("B8: флаг снят", N.v12IsSyncInProgress(), false);

const health = JSON.parse(N.doGet({ parameter: { action: "health" } }).getContent());
check("B8: health отвечает", health.ok, true);
check("B8: health сообщает про секрет", health.tokenConfigured, true);
check("B8: GET для прочих действий запрещён",
  JSON.parse(N.doGet({ parameter: { action: "rows" } }).getContent()).error, "use_post");

console.log("");
if (failures === 0) {
  console.log("ALL TESTS PASSED");
} else {
  console.log("FAILURES: " + failures);
  process.exitCode = 1;
}
