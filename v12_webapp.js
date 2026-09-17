/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_webapp.js
 *
 * ВЕБ-API ТРАНСПОРТА «личный файл отборщика -> мастер».
 *
 * ОДНО развёртывание веб-приложения = один URL и один эндпоинт; разные операции
 * различаются полем action (см. V12_CONFIG.WEB_ACTIONS):
 *   rows    — выдать сателлиту актуальные строки отборки по проекту;
 *   submit  — принять и применить лот отборки;
 *   status  — статус лотов, активные захваты, список проектов;
 *   claim   — мягко взять проект;
 *   release — освободить проект;
 *   pickers — список отборщиков и проектов (настройка сателлита).
 *
 * БЕЗОПАСНОСТЬ. Веб-приложение исполняется как ВЛАДЕЛЕЦ скрипта
 * (executeAs: USER_DEPLOYING), поэтому Session.getActiveUser() НЕ является
 * надёжным источником личности. Поэтому:
 *   1) запрос обязан нести общий секрет (PICKING_BATCH_TOKEN в Script
 *      Properties мастера и каждого сателлита) — без него отказ;
 *   2) актор передаётся в payload ЯВНО и проверяется по V12_ROLE_MAP: право
 *      работы с отборкой имеют WAREHOUSE / PRODUCTION / ADMIN;
 *   3) записи идут под актором лота (см. v12WithActor в v12_batches.js), поэтому
 *      аудит, история и журналы содержат реального отборщика.
 *
 * ФЛАГ СИНХРОНИЗАЦИИ. Пока идёт полная синхронизация (v12RunFullSync), приём
 * лотов отклоняется: иначе лот мог бы сослаться на позиции, которые
 * синхронизация вот-вот удалит. Флаг имеет TTL: упавшее исполнение не должно
 * «залипать» вечно.
 * =====================================================
 */

/**
 * Развернуть запрос в объект payload.
 *
 * Поддерживаются оба способа: JSON в теле (application/json — так шлёт сателлит)
 * и form-urlencoded (e.parameter — удобно для ручной проверки из браузера).
 */
function v12ParseWebRequest(e) {
  let payload = {};
  if (e && e.postData && e.postData.contents) {
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      payload = {};
    }
  } else if (e && e.parameter) {
    payload = e.parameter;
  }
  if (!payload || typeof payload !== "object") {
    payload = {};
  }
  payload.action = String(payload.action || V12_CONFIG.WEB_ACTIONS.STATUS).trim();
  return payload;
}

/**
 * JSON-ответ веб-приложения.
 */
function v12JsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Проверить секрет и актора запроса.
 *
 * Возвращает { ok: true, actor, role } либо { ok: false, reason }.
 */
function v12VerifyBatchRequest(req) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty(V12_CONFIG.BATCH.TOKEN_PROPERTY);
  if (!expected) {
    return { ok: false, reason: "token_not_configured" };
  }
  if (String((req && req.token) || "") !== expected) {
    return { ok: false, reason: "unauthorized" };
  }
  const actor = String((req && req.actor) || "").trim().toLowerCase();
  if (!actor) {
    return { ok: false, reason: "actor_required" };
  }
  const role = v12GetUserRole(actor);
  const R = V12_CONFIG.ROLES;
  const allowed = (role === R.WAREHOUSE || role === R.PRODUCTION || role === R.ADMIN);
  if (!allowed) {
    return { ok: false, reason: "forbidden:" + (role || "no_role") };
  }
  return { ok: true, actor: actor, role: role };
}

/**
 * Роутер действий веб-API.
 */
function v12RouteWebAction(req, check) {
  switch (req.action) {
    case V12_CONFIG.WEB_ACTIONS.ROWS:    return v12WebRows(req, check);
    case V12_CONFIG.WEB_ACTIONS.SUBMIT:  return v12WebSubmit(req, check);
    case V12_CONFIG.WEB_ACTIONS.STATUS:  return v12WebStatus(req, check);
    case V12_CONFIG.WEB_ACTIONS.CLAIM:   return v12WebClaim(req, check);
    case V12_CONFIG.WEB_ACTIONS.RELEASE: return v12WebRelease(req, check);
    case V12_CONFIG.WEB_ACTIONS.PICKERS: return v12WebPickers(req, check);
    default:
      return v12JsonResponse({ ok: false, error: "unknown_action:" + req.action });
  }
}

/**
 * POST — точка входа веб-приложения.
 */
function doPost(e) {
  let req = null;
  try {
    req = v12ParseWebRequest(e);
    const check = v12VerifyBatchRequest(req);
    if (!check.ok) {
      logSystem("doPost", "Отказ: " + check.reason +
        " (action: " + req.action + ", actor: " + (req.actor || "-") + ")", "WARNING");
      return v12JsonResponse({ ok: false, error: check.reason });
    }
    return v12RouteWebAction(req, check);
  } catch (err) {
    logSystem("doPost", err.message, err, "ERROR");
    return v12JsonResponse({ ok: false, error: "internal:" + err.message });
  } finally {
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * GET — health-check. Удобно открывать прямо в браузере после развёртывания:
 *   <WEB_APP_URL>?action=health
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "health";
  if (action !== "health") {
    return v12JsonResponse({ ok: false, error: "use_post" });
  }
  return v12JsonResponse({
    ok: true,
    service: "BOM CONTROL V12",
    version: V12_CONFIG.VERSION,
    syncInProgress: v12IsSyncInProgress(),
    tokenConfigured: !!v12GetBatchToken(),
    pending: v12CountPendingEdits(),
    batchesPending: v12CountPendingBatches()
  });
}
/**
 * rows — выдать сателлиту актуальные строки отборки по проекту.
 *
 * Сателлит живёт в отдельном файле и не имеет доступа к POSITION_STATE мастера,
 * поэтому «свежую копию» отборки отдаёт мастер. Строки считает ТА ЖЕ чистая
 * функция, что рисует мастерский лист (v12BuildPickingRecords) — иначе сателлит
 * и мастер разошлись бы в трактовке: какие позиции видны, в каком порядке, что
 * попадает в колонку «Дата поставки».
 *
 * project пустой => фильтра нет (все проекты). Отборщик всегда запрашивает
 * конкретный проект своего файла.
 *
 * Формат ответа «плоский» (заголовки + значения + цвет строки): сателлит не
 * должен знать про POSITION_STATE и его колонки.
 */
function v12WebRows(req, check) {
  const project = String((req && req.project) || "").trim();
  const posData = v12ReadSheet(V12_CONFIG.SHEETS.POSITION_STATE);
  const revDates = v12BuildRevisionDateMap();
  const records = v12BuildPickingRecords(posData, project, revDates);
  const rows = records.map(function (rec) {
    return { values: rec.row, color: rec.color };
  });
  return v12JsonResponse({
    ok: true,
    project: project,
    headers: V12_CONFIG.HEADERS.PICKING,
    rows: rows,
    // Галочки живут только в личном файле отборщика до отправки лота: в
    // POSITION_STATE их нет, поэтому здесь их быть не может.
    claims: v12CollectActiveClaims()
  });
}

/**
 * submit — принять и применить лот отборки.
 */
function v12WebSubmit(req, check) {
  if (v12IsSyncInProgress()) {
    // Полная синхронизация удаляет/переписывает позиции — принять лот сейчас
    // нельзя. Сателлит показывает отборщику «повторите через минуту».
    return v12JsonResponse({ ok: false, error: "sync_in_progress", retryAfterSec: 60 });
  }
  const res = v12SubmitPickingBatch(req);
  if (!res.ok) {
    return v12JsonResponse(res);
  }
  // Идемпотентность: повторная отправка того же лота НЕ применяется второй раз,
  // отборщику возвращается прежний результат.
  if (res.already) {
    return v12JsonResponse({
      ok: true,
      already: true,
      batchId: res.batchId,
      status: res.status,
      applied: res.applied || 0,
      failed: res.failed || 0,
      errors: [],
      total: res.total || 0,
      error: res.error || "",
      warning: null
    });
  }
  const applied = v12ApplyBatch(res.batchId);
  return v12JsonResponse({
    ok: true,
    already: false,
    batchId: res.batchId,
    status: applied.status,
    applied: applied.applied,
    failed: applied.failed,
    errors: applied.errors || [],
    total: applied.total,
    error: applied.error || "",
    retryAfterSec: applied.retryAfterSec || 0,
    warning: res.warning || null
  });
}

/**
 * status — вернуть всё, что нужно сателлиту одним вызовом.
 *
 * Если передан batchId — в batches будет только он (сателлит опрашивает
 * результат отложенного применения, когда мастер ответил retryAfterSec).
 */
function v12WebStatus(req, check) {
  let batches = v12CollectBatches(20);
  const batchId = String((req && req.batchId) || "").trim();
  if (batchId) {
    batches = batches.filter(function (b) {
      return v12Norm(b.batchId) === v12Norm(batchId);
    });
  }
  return v12JsonResponse({
    ok: true,
    version: V12_CONFIG.VERSION,
    syncInProgress: v12IsSyncInProgress(),
    pending: v12CountPendingEdits(),
    batchesPending: v12CountPendingBatches(),
    batches: batches,
    claims: v12CollectActiveClaims(),
    projects: v12GetBomProjectCodes()
  });
}

/**
 * claim — мягко взять проект.
 *
 * Конфликт НЕ блокируется: если проект уже взят другим, в ответе придёт
 * warning.claimedBy, а сателлит покажет отборщику предупреждение. Захват
 * продлевается при каждом взятии и автоматически истекает по TTL.
 */
function v12WebClaim(req, check) {
  const project = String((req && req.project) || "").trim();
  if (!project) {
    return v12JsonResponse({ ok: false, error: "project_required" });
  }
  const spreadsheetId = String((req && req.spreadsheetId) || "");
  const result = v12ClaimProject(project, check.actor, spreadsheetId);
  let warning = null;
  const previous = result && result.previousActor;
  if (previous && v12Norm(previous) !== v12Norm(check.actor)) {
    const existing = v12GetActiveClaim(project);
    warning = {
      claimedBy: previous,
      claimedAt: existing ? existing.claimedAt : "",
      expiresAt: existing ? existing.expiresAt : ""
    };
  }
  return v12JsonResponse({
    ok: true,
    project: project,
    actor: check.actor,
    expiresAt: v12ClaimExpiry(null),
    warning: warning
  });
}

/**
 * release — освободить проект.
 */
function v12WebRelease(req, check) {
  const project = String((req && req.project) || "").trim();
  if (!project) {
    return v12JsonResponse({ ok: false, error: "project_required" });
  }
  const released = v12ReleaseProject(project, check.actor);
  return v12JsonResponse({ ok: true, project: project, released: released });
}

/**
 * pickers — список отборщиков и проектов (настройка сателлита, выпадающий
 * список проектов в B1 личного файла).
 */
function v12WebPickers(req, check) {
  return v12JsonResponse({
    ok: true,
    pickers: v12ListPickerEmails(),
    projects: v12GetBomProjectCodes(),
    claims: v12CollectActiveClaims()
  });
}

/**
 * Список адресов с правом работы с отборкой (WAREHOUSE / PRODUCTION), плюс ADMIN.
 * Используется при настройке личного файла отборщика.
 */
function v12ListPickerEmails() {
  const R = V12_CONFIG.ROLES;
  const out = [];
  Object.keys(V12_ROLE_MAP || {}).forEach(function (email) {
    const role = V12_ROLE_MAP[email];
    if (role === R.WAREHOUSE || role === R.PRODUCTION || role === R.ADMIN) {
      out.push({ email: email, role: role });
    }
  });
  return out;
}
/**
 * ====================================================
 * Общий секрет транспорта
 * ====================================================
 */

/**
 * Текущий секрет транспорта (или "").
 * Секрет НИКОГДА не пишется в логи и в журналы.
 */
function v12GetBatchToken() {
  return PropertiesService.getScriptProperties()
    .getProperty(V12_CONFIG.BATCH.TOKEN_PROPERTY) || "";
}

/**
 * Сменить секрет транспорта (только ADMIN).
 *
 * Старый секрет сразу перестаёт работать — это и есть механизм ротации: после
 * смены секрет нужно раздать во все личные файлы отборщиков, иначе они получат
 * отказ «unauthorized».
 *
 * Возвращает новый секрет или null, если нет прав.
 */
function v12SetBatchTokenUI() {
  if (v12GetCurrentUserRole() !== V12_CONFIG.ROLES.ADMIN) {
    v12Toast("Только ADMIN может менять секрет отборщиков", V12_UI.TOAST_SECONDS_ERROR);
    return null;
  }
  const token = "PBT-" + Utilities.getUuid();
  PropertiesService.getScriptProperties()
    .setProperty(V12_CONFIG.BATCH.TOKEN_PROPERTY, token);
  logSystem("v12SetBatchTokenUI", "Секрет транспорта обновлён администратором", "WARNING");
  flushSystemLog();
  v12Toast("Секрет обновлён. Скопируйте его в настройки личных файлов отборщиков.",
    V12_UI.TOAST_SECONDS_ERROR);
  return token;
}

/**
 * ====================================================
 * Флаг «идёт полная синхронизация»
 * ====================================================
 */

/**
 * Выставить/снять флаг синхронизации.
 */
function v12SetSyncInProgress(flag) {
  const props = PropertiesService.getScriptProperties();
  if (flag) {
    props.setProperty(V12_CONFIG.BATCH.SYNC_FLAG_PROPERTY, String(new Date().getTime()));
  } else {
    props.deleteProperty(V12_CONFIG.BATCH.SYNC_FLAG_PROPERTY);
  }
}

/**
 * Идёт ли полная синхронизация (с защитой от «залипшего» флага).
 *
 * Если флаг старше SYNC_FLAG_TTL_MS — значит исполнение упало и снять его не
 * успело. Такой флаг игнорируется и удаляется: иначе приём лотов «залипнет»
 * навсегда и все личные файлы отборщиков перестанут работать.
 */
function v12IsSyncInProgress() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(V12_CONFIG.BATCH.SYNC_FLAG_PROPERTY);
  if (!raw) {
    return false;
  }
  const startedAt = Number(raw);
  if (!isFinite(startedAt)) {
    props.deleteProperty(V12_CONFIG.BATCH.SYNC_FLAG_PROPERTY);
    return false;
  }
  if (new Date().getTime() - startedAt > V12_CONFIG.BATCH.SYNC_FLAG_TTL_MS) {
    props.deleteProperty(V12_CONFIG.BATCH.SYNC_FLAG_PROPERTY);
    logSystem("v12IsSyncInProgress", "Снят зависший флаг синхронизации", "WARNING");
    return false;
  }
  return true;
}
