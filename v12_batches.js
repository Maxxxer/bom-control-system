/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_batches.js
 *
 * ЛОТЫ ОТБОРКИ (PICKING_BATCHES) и МЯГКИЙ ЗАХВАТ ПРОЕКТОВ
 * (PICKING_CLAIMS) — транспорт «личный файл отборщика -> мастер».
 *
 * ЗАЧЕМ ЛОТ. Раньше кнопка «ПРИМЕНИТЬ» сливала ВСЮ очередь PENDING_EDITS,
 * поэтому один отборщик мог закоммитить незавершённую работу коллег (конфликт
 * A3). Теперь каждая отправка из личного файла приходит со своим BATCH_ID, и
 * применяется ТОЛЬКО она (см. v12DrainPendingEdits(batchId)).
 *
 * ИДЕМПОТЕНТНОСТЬ. Повторная отправка того же BATCH_ID (повторное нажатие
 * кнопки, ретрай сети, дубль HTTP-запроса) НЕ применяется второй раз: лот со
 * статусом APPLIED/PARTIAL/FAILED возвращает прежний результат как есть.
 *
 * ЗАХВАТ — СТРОГО МЯГКИЙ. Конфликт по проекту НЕ блокируется: мастер сообщает
 * «проект уже отбирает ivan@… до 12:30», а сателлит показывает это отборщику.
 * Строка захвата перезаписывается на последнего, кто взял проект; просроченные
 * (EXPIRES_AT < now) автоматически считаются EXPIRED, чтобы забытая заявка не
 * мешала работать.
 * =====================================================
 */

/**
 * Строка лота по batchId. Возвращает { row, values } или null.
 */
function v12GetBatch(batchId) {
  const id = v12Norm(batchId);
  if (!id) {
    return null;
  }
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_BATCHES);
  if (!sheet) {
    return null;
  }
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  const data = readSheetValues(sheet);
  for (let i = 1; i < data.length; i++) {
    if (v12Norm(data[i][B.BATCH_ID - 1]) === id) {
      return { row: i + 1, values: data[i] };
    }
  }
  return null;
}

/**
 * Числовое поле лота (по индексу колонки).
 */
function v12BatchNumber(values, col) {
  return toNumber(values ? values[col - 1] : 0);
}

/**
 * Текстовое поле лота (по индексу колонки).
 */
function v12BatchText(values, col) {
  return String((values ? values[col - 1] : "") || "").trim();
}

/**
 * Число лотов в статусе PENDING (для диагностики и health-эндпоинта).
 */
function v12CountPendingBatches() {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_BATCHES);
  if (!sheet) {
    return 0;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  const statuses = sheet.getRange(2, B.STATUS, lastRow - 1, 1).getValues();
  const pending = V12_CONFIG.PICKING_BATCH_STATUS.PENDING;
  let count = 0;
  for (let i = 0; i < statuses.length; i++) {
    if (String(statuses[i][0]).trim() === pending) {
      count++;
    }
  }
  return count;
}

/**
 * Последние лоты (свежие — сверху) для журнала и эндпоинта status.
 *
 * limit — сколько вернуть (по умолчанию 20).
 */
function v12CollectBatches(limit) {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_BATCHES);
  if (!sheet) {
    return [];
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  const data = sheet.getRange(2, 1, lastRow - 1, V12_CONFIG.COLUMN_COUNT.PICKING_BATCHES).getValues();
  const out = [];
  for (let i = data.length - 1; i >= 0; i--) {
    const r = data[i];
    const batchId = v12BatchText(r, B.BATCH_ID);
    if (!batchId) {
      continue;
    }
    out.push({
      batchId: batchId,
      submittedAt: r[B.SUBMITTED_AT - 1],
      actor: v12BatchText(r, B.ACTOR),
      project: v12BatchText(r, B.PROJECT),
      spreadsheetId: v12BatchText(r, B.SPREADSHEET_ID),
      status: v12BatchText(r, B.STATUS),
      appliedAt: r[B.APPLIED_AT - 1],
      appliedBy: v12BatchText(r, B.APPLIED_BY),
      total: v12BatchNumber(r, B.TOTAL),
      applied: v12BatchNumber(r, B.APPLIED),
      failed: v12BatchNumber(r, B.FAILED),
      error: v12BatchText(r, B.ERROR)
    });
    if (limit && out.length >= limit) {
      break;
    }
  }
  return out;
}

/**
 * Человеческое описание статуса лота.
 */
function v12BatchStatusDisplay(status) {
  const S = V12_CONFIG.PICKING_BATCH_STATUS;
  if (status === S.APPLIED) {
    return "Применён полностью";
  }
  if (status === S.PARTIAL) {
    return "Применён частично";
  }
  if (status === S.FAILED) {
    return "Не применён";
  }
  if (status === S.PENDING) {
    return "В обработке";
  }
  return status || "";
}

/**
 * Собрать текст колонки «Ошибка» лота из отчёта по позициям.
 *
 * Показываем не более V12_BATCH_ERROR_LINES строк — иначе ячейка раздувается
 * на сотни строк и превращается в нечитаемую «простыню».
 */
const V12_BATCH_ERROR_LINES = 15;

function v12FormatBatchError(errors) {
  if (!errors || !errors.length) {
    return "";
  }
  const lines = errors.slice(0, V12_BATCH_ERROR_LINES).map(function (e) {
    return (e.positionId || "?") + " — " + (e.reason || "заблокировано");
  });
  const rest = errors.length - lines.length;
  return rest > 0 ? (lines.join("\n") + "\n…и ещё " + rest) : lines.join("\n");
}

/**
 * Разбор элементов лота: оставить только реально отмеченные позиции.
 *
 * Отборщик отправляет позиции, которые он отметил галочкой. Элементы с
 * checked=false игнорируются (в личном файле снятие галочки означает «не
 * передавать», а не «отменить ранее переданное»: передача идемпотентна и
 * отменяется только возвратом из архива).
 */
function v12BatchCheckedPositionIds(items) {
  const out = [];
  const seen = {};
  (items || []).forEach(function (it) {
    if (!it || !it.checked) {
      return;
    }
    const pid = normalizeMaterialId(it.positionId);
    if (!pid || seen[pid]) {
      return;
    }
    seen[pid] = true;
    out.push(pid);
  });
  return out;
}

/**
 * ====================================================
 * ПРИЁМ ЛОТА
 * ====================================================
 */

/**
 * Принять лот от личного файла отборщика.
 *
 * Шаги:
 *   1) идемпотентность — по batchId; уже обработанный лот не переигрывается;
 *   2) ограничение размера — MAX_ITEMS (защита от лимита исполнения 6 минут);
 *   3) МЯГКИЙ захват проекта — конфликт возвращается как warning, не как отказ;
 *   4) фиксация намерений HANDOFF со ссылкой на лот (BATCH_ID, PROJECT);
 *   5) запись шапки лота.
 *
 * Возвращает { ok, batchId, warning?, total? } либо { ok:false, error }.
 */
function v12SubmitPickingBatch(req) {
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  const actor = String((req && req.actor) || "").trim().toLowerCase();
  const batchId = String((req && req.batchId) || "").trim();
  const project = String((req && req.project) || "").trim();
  const spreadsheetId = String((req && req.spreadsheetId) || "").trim();
  const items = (req && req.items) || [];

  if (!batchId) {
    return { ok: false, error: "batch_id_required" };
  }
  if (!actor) {
    return { ok: false, error: "actor_required" };
  }
  if (items.length > V12_CONFIG.BATCH.MAX_ITEMS) {
    return { ok: false, error: "batch_too_large", limit: V12_CONFIG.BATCH.MAX_ITEMS };
  }

  // 1. Идемпотентность: обработанный лот возвращает прежний результат.
  const existing = v12GetBatch(batchId);
  const PENDING = V12_CONFIG.PICKING_BATCH_STATUS.PENDING;
  if (existing) {
    const status = v12BatchText(existing.values, B.STATUS);
    if (status && status !== PENDING) {
      return {
        ok: true,
        already: true,
        batchId: batchId,
        status: status,
        total: v12BatchNumber(existing.values, B.TOTAL),
        applied: v12BatchNumber(existing.values, B.APPLIED),
        failed: v12BatchNumber(existing.values, B.FAILED),
        error: v12BatchText(existing.values, B.ERROR),
        warning: null
      };
    }
  }

  // 2. Мягкий захват проекта: сначала СМОТРИМ, кто взял, потом перезаписываем.
  let warning = null;
  if (project) {
    const claim = v12GetActiveClaim(project);
    if (claim && v12Norm(claim.actor) !== v12Norm(actor)) {
      warning = {
        claimedBy: claim.actor,
        claimedAt: claim.claimedAt,
        expiresAt: claim.expiresAt
      };
    }
    v12ClaimProject(project, actor, spreadsheetId);
  }

  // 3. Намерения (только отмеченные позиции).
  const positionIds = v12BatchCheckedPositionIds(items);
  const pendingRows = [];
  const editIdBase = generateEventId();
  positionIds.forEach(function (pid, i) {
    pendingRows.push(v12BuildPendingRow(
      V12_CONFIG.SOURCE_UI.PICKING,
      pid,
      V12_CONFIG.PENDING_FIELD.HANDOFF,
      true,
      actor,
      editIdBase + "-" + (i + 1),
      batchId,
      project
    ));
  });
  if (pendingRows.length) {
    v12EnqueuePendingRows(pendingRows);
  }

  // 4. Шапка лота.
  v12WriteBatchHeader(existing, {
    batchId: batchId,
    actor: actor,
    project: project,
    spreadsheetId: spreadsheetId,
    total: pendingRows.length
  });

  logSystem("v12SubmitPickingBatch",
    "Лот принят: " + batchId + ", позиций: " + pendingRows.length +
    ", проект: " + (project || "-") + ", отборщик: " + actor, "INFO");

  return {
    ok: true,
    already: false,
    batchId: batchId,
    total: pendingRows.length,
    warning: warning
  };
}

/**
 * Записать (создать или обновить) шапку лота.
 */
function v12WriteBatchHeader(existing, info) {
  const sheet = v12GetSheetByKey("PICKING_BATCHES");
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.PICKING_BATCHES).fill("");
  row[B.BATCH_ID - 1] = info.batchId;
  row[B.SUBMITTED_AT - 1] = new Date();
  row[B.ACTOR - 1] = info.actor;
  row[B.PROJECT - 1] = info.project || "";
  row[B.SPREADSHEET_ID - 1] = info.spreadsheetId || "";
  row[B.STATUS - 1] = V12_CONFIG.PICKING_BATCH_STATUS.PENDING;
  row[B.APPLIED_AT - 1] = "";
  row[B.APPLIED_BY - 1] = "";
  row[B.TOTAL - 1] = info.total;
  row[B.APPLIED - 1] = "";
  row[B.FAILED - 1] = "";
  row[B.ERROR - 1] = "";

  if (existing) {
    writeValues(sheet, existing.row, 1, [row]);
    return existing.row;
  }
  const startRow = sheet.getLastRow() + 1;
  writeValues(sheet, startRow, 1, [row]);
  return startRow;
}

/**
 * ====================================================
 * ПРИМЕНЕНИЕ ЛОТА
 * ====================================================
 */

/**
 * Статус лота по итогам применения.
 */
function v12BatchStatusFromResult(total, applied, failed, hasError) {
  const S = V12_CONFIG.PICKING_BATCH_STATUS;
  if (hasError && applied === 0) {
    return S.FAILED;
  }
  if (failed === 0 && applied >= total) {
    return S.APPLIED;
  }
  if (failed === 0 && applied > 0) {
    return S.APPLIED;
  }
  if (applied === 0) {
    return S.FAILED;
  }
  return S.PARTIAL;
}

/**
 * Применить лот: слить ТОЛЬКО его намерения и записать результат.
 *
 * Возвращает { status, applied, failed, errors, total, error?, retryAfterSec? }.
 */
function v12ApplyBatch(batchId) {
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  const found = v12GetBatch(batchId);
  if (!found) {
    return {
      status: V12_CONFIG.PICKING_BATCH_STATUS.FAILED,
      applied: 0, failed: 0, errors: [], total: 0,
      error: "Лот не найден: " + batchId
    };
  }
  const total = v12BatchNumber(found.values, B.TOTAL);
  const res = v12DrainPendingEdits(batchId);

  if (res && res.skipped) {
    // Лок занят (идёт чужое применение или синхронизация) — лот остаётся
    // PENDING, его добьёт дежурный дренаж v12ScheduledBatchDrain.
    return {
      status: V12_CONFIG.PICKING_BATCH_STATUS.PENDING,
      applied: 0, failed: 0, errors: [], total: total,
      retryAfterSec: 30
    };
  }

  const errors = (res && res.errors) || [];
  const applied = toNumber(res && res.drained);
  // «Уже передано» — не ошибка: позиция закрыта ранее, отборщику достаточно
  // увидеть это отдельной строкой отчёта.
  const realErrors = errors.filter(function (e) { return !e.already; });
  const failed = realErrors.length;
  const hasError = !!(res && res.error);

  const status = v12BatchStatusFromResult(total, applied, failed, hasError);
  const errorText = hasError
    ? String(res.error)
    : v12FormatBatchError(realErrors);

  v12WriteBatchResult(found.row, status, applied, failed, errorText);

  return {
    status: status,
    applied: applied,
    failed: failed,
    errors: errors,
    total: total,
    error: hasError ? String(res.error) : ""
  };
}

/**
 * Записать результат применения лота.
 */
function v12WriteBatchResult(rowNumber, status, applied, failed, errorText) {
  const sheet = v12GetSheetByKey("PICKING_BATCHES");
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  batchWrite(sheet, [
    { row: rowNumber, col: B.STATUS, value: status },
    { row: rowNumber, col: B.APPLIED, value: applied },
    { row: rowNumber, col: B.FAILED, value: failed },
    { row: rowNumber, col: B.ERROR, value: errorText || "" },
    { row: rowNumber, col: B.APPLIED_AT, value: new Date() },
    { row: rowNumber, col: B.APPLIED_BY, value: v12CurrentActor() }
  ]);
  SpreadsheetApp.flush();
}

/**
 * Страховка от «зависших» лотов: если лот в статусе PENDING, но намерений его
 * партии в очереди уже НЕТ (их кто-то слил или они не записались), статус
 * приводится к APPLIED/FAILED по фактическим счётчикам. Без этого лот навсегда
 * остался бы «В обработке» и сателлит не увидел бы результат.
 *
 * Возвращает число исправленных лотов.
 */
function v12RecoverStuckBatches() {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_BATCHES);
  if (!sheet) {
    return 0;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  const B = V12_CONFIG.PICKING_BATCH_COLUMNS;
  const S = V12_CONFIG.PICKING_BATCH_STATUS;
  const data = sheet.getRange(2, 1, lastRow - 1, V12_CONFIG.COLUMN_COUNT.PICKING_BATCHES).getValues();
  let fixed = 0;
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (v12BatchText(r, B.STATUS) !== S.PENDING) {
      continue;
    }
    const batchId = v12BatchText(r, B.BATCH_ID);
    if (!batchId || v12HasPendingEditsForBatch(batchId)) {
      continue;
    }
    const applied = v12BatchNumber(r, B.APPLIED);
    const failed = v12BatchNumber(r, B.FAILED);
    const status = applied > 0 ? S.APPLIED : S.FAILED;
    v12WriteBatchResult(i + 2, status, applied, failed,
      applied > 0 ? v12BatchText(r, B.ERROR) : "Лот не применён: намерения не найдены");
    fixed++;
  }
  if (fixed) {
    logSystem("v12RecoverStuckBatches", "Восстановлено лотов: " + fixed, "WARNING");
  }
  return fixed;
}

/**
 * ====================================================
 * ЗАХВАТ ПРОЕКТА (МЯГКИЙ)
 * ====================================================
 */

/**
 * Момент истечения захвата.
 */
function v12ClaimExpiry(from) {
  const base = from ? new Date(from) : new Date();
  const ttlMs = V12_CONFIG.BATCH.CLAIM_TTL_MIN * 60 * 1000;
  return new Date(base.getTime() + ttlMs);
}

/**
 * Строка захвата проекта. Возвращает { row, values } или null.
 */
function v12GetClaimRow(project) {
  const norm = v12Norm(project);
  if (!norm) {
    return null;
  }
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_CLAIMS);
  if (!sheet) {
    return null;
  }
  const C = V12_CONFIG.PICKING_CLAIM_COLUMNS;
  const data = readSheetValues(sheet);
  for (let i = 1; i < data.length; i++) {
    if (v12Norm(data[i][C.PROJECT - 1]) === norm) {
      return { row: i + 1, values: data[i] };
    }
  }
  return null;
}

/**
 * Активный (не истёкший) захват проекта.
 *
 * Возвращает { actor, claimedAt, expiresAt, row } либо null. Просроченный
 * захват не считается активным — забытая заявка не должна мешать работать.
 */
function v12GetActiveClaim(project) {
  const found = v12GetClaimRow(project);
  if (!found) {
    return null;
  }
  const C = V12_CONFIG.PICKING_CLAIM_COLUMNS;
  const status = String(found.values[C.STATUS - 1] || "").trim();
  if (status !== V12_CONFIG.PICKING_CLAIM_STATUS.ACTIVE) {
    return null;
  }
  const expiresAt = found.values[C.EXPIRES_AT - 1];
  const exp = expiresAt ? new Date(expiresAt) : null;
  if (!exp || isNaN(exp.getTime()) || exp.getTime() <= new Date().getTime()) {
    return null;
  }
  return {
    actor: String(found.values[C.ACTOR - 1] || "").trim(),
    claimedAt: found.values[C.CLAIMED_AT - 1],
    expiresAt: expiresAt,
    row: found.row
  };
}

/**
 * МЯГКО взять проект: записать/продлить заявку от actor.
 *
 * Конфликт НЕ блокируется — функция всегда записывает текущего актора и
 * продлевает срок. Кто был до — возвращается вызывающему как предупреждение
 * (см. v12SubmitPickingBatch -> warning.claimedBy).
 *
 * Возвращает { status: "claimed", previousActor }.
 */
function v12ClaimProject(project, actor, spreadsheetId) {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_CLAIMS);
  if (!sheet || !v12Norm(project)) {
    return { status: "skipped", previousActor: "" };
  }
  const C = V12_CONFIG.PICKING_CLAIM_COLUMNS;
  const found = v12GetClaimRow(project);
  const previousActor = found ? String(found.values[C.ACTOR - 1] || "").trim() : "";
  const row = new Array(V12_CONFIG.COLUMN_COUNT.PICKING_CLAIMS).fill("");
  row[C.PROJECT - 1] = project;
  row[C.ACTOR - 1] = actor || v12CurrentActor();
  row[C.SPREADSHEET_ID - 1] = spreadsheetId || "";
  row[C.CLAIMED_AT - 1] = new Date();
  row[C.EXPIRES_AT - 1] = v12ClaimExpiry(null);
  row[C.STATUS - 1] = V12_CONFIG.PICKING_CLAIM_STATUS.ACTIVE;

  if (found) {
    writeValues(sheet, found.row, 1, [row]);
  } else {
    writeValues(sheet, sheet.getLastRow() + 1, 1, [row]);
  }
  SpreadsheetApp.flush();
  return { status: "claimed", previousActor: previousActor };
}

/**
 * Освободить проект (отборщик закончил работу).
 */
function v12ReleaseProject(project, actor) {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_CLAIMS);
  if (!sheet) {
    return 0;
  }
  const C = V12_CONFIG.PICKING_CLAIM_COLUMNS;
  const found = v12GetClaimRow(project);
  if (!found) {
    return 0;
  }
  const current = String(found.values[C.ACTOR - 1] || "").trim();
  if (actor && v12Norm(current) !== v12Norm(actor)) {
    return 0;   // чужую заявку не снимаем
  }
  batchWrite(sheet, [
    { row: found.row, col: C.STATUS, value: V12_CONFIG.PICKING_CLAIM_STATUS.RELEASED }
  ]);
  SpreadsheetApp.flush();
  return 1;
}

/**
 * Освободить ВСЕ активные захваты (пункт меню, для ADMIN).
 */
function v12ReleaseAllClaims() {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_CLAIMS);
  if (!sheet) {
    return 0;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  const C = V12_CONFIG.PICKING_CLAIM_COLUMNS;
  const statuses = sheet.getRange(2, C.STATUS, lastRow - 1, 1).getValues();
  const writes = [];
  for (let i = 0; i < statuses.length; i++) {
    if (String(statuses[i][0]).trim() === V12_CONFIG.PICKING_CLAIM_STATUS.ACTIVE) {
      writes.push({
        row: i + 2, col: C.STATUS,
        value: V12_CONFIG.PICKING_CLAIM_STATUS.RELEASED
      });
    }
  }
  if (writes.length) {
    batchWrite(sheet, writes);
    SpreadsheetApp.flush();
  }
  return writes.length;
}

/**
 * Пометить просроченные захваты как EXPIRED.
 *
 * Возвращает число просроченных заявок.
 */
function v12ExpireStaleClaims() {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_CLAIMS);
  if (!sheet) {
    return 0;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  const C = V12_CONFIG.PICKING_CLAIM_COLUMNS;
  const data = sheet.getRange(2, 1, lastRow - 1, V12_CONFIG.COLUMN_COUNT.PICKING_CLAIMS).getValues();
  const now = new Date().getTime();
  const writes = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const status = String(r[C.STATUS - 1] || "").trim();
    if (status !== V12_CONFIG.PICKING_CLAIM_STATUS.ACTIVE) {
      continue;
    }
    const expiresAt = r[C.EXPIRES_AT - 1];
    const exp = expiresAt ? new Date(expiresAt) : null;
    if (exp && !isNaN(exp.getTime()) && exp.getTime() > now) {
      continue;
    }
    writes.push({
      row: i + 2, col: C.STATUS,
      value: V12_CONFIG.PICKING_CLAIM_STATUS.EXPIRED
    });
  }
  if (writes.length) {
    batchWrite(sheet, writes);
    SpreadsheetApp.flush();
  }
  return writes.length;
}

/**
 * Все активные захваты (для эндпоинта status и уведомлений в сателлите).
 *
 * Возвращает [{ project, actor, claimedAt, expiresAt }].
 */
function v12CollectActiveClaims() {
  v12ExpireStaleClaims();
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING_CLAIMS);
  if (!sheet) {
    return [];
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  const C = V12_CONFIG.PICKING_CLAIM_COLUMNS;
  const data = sheet.getRange(2, 1, lastRow - 1, V12_CONFIG.COLUMN_COUNT.PICKING_CLAIMS).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (String(r[C.STATUS - 1] || "").trim() !== V12_CONFIG.PICKING_CLAIM_STATUS.ACTIVE) {
      continue;
    }
    out.push({
      project: String(r[C.PROJECT - 1] || "").trim(),
      actor: String(r[C.ACTOR - 1] || "").trim(),
      claimedAt: r[C.CLAIMED_AT - 1],
      expiresAt: r[C.EXPIRES_AT - 1]
    });
  }
  return out;
}
