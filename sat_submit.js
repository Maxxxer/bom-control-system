/**
 * BOM CONTROL SYSTEM V12 — ЛИЧНЫЙ ФАЙЛ ОТБОРЩИКА (САТЕЛЛИТ)
 * FILE: sat_submit.js
 * Исключён из выгрузки в мастер: .claspignore -> sat_*.js
 *
 * ОТПРАВКА ЛОТА — кнопка «ПРИМЕНИТЬ».
 * Уходят ТОЛЬКО галочки ЭТОГО файла, и мастер применяет ТОЛЬКО этот лот:
 * раньше кнопка в общем листе сливала всю очередь и применяла чужую работу.
 * Идемпотентность: повторная отправка того же набора в пределах 2 минут
 * использует тот же BATCH_ID, и мастер возвращает прежний результат — двойного
 * применения при двойном клике или обрыве связи не будет.
 */

const SAT_PROP_LAST_BATCH = "SAT_LAST_BATCH_ID";
const SAT_PROP_LAST_SIG = "SAT_LAST_BATCH_SIG";
const SAT_PROP_LAST_AT = "SAT_LAST_BATCH_AT";
const SAT_DOUBLE_CLICK_WINDOW_MS = 120000;

/** Номер лота: уникальный, содержит время (виден в журнале мастера). */
function satNewBatchId() {
  const tz = Session.getScriptTimeZone() || "GMT+3";
  const stamp = Utilities.formatDate(new Date(), tz, "yyyyMMdd-HHmmss");
  const rand = Math.floor(Math.random() * 100000);
  return "SAT-" + stamp + "-" + rand + "-" + (satGetActor() || "picker");
}

/** Подпись набора отправляемых позиций (для защиты от двойного нажатия). */
function satItemsSignature(items) {
  const ids = (items || []).map(function (it) { return String(it.positionId || ""); });
  ids.sort();
  return ids.join("|");
}

/** Тот же набор, отправленный только что, использует тот же номер лота. */
function satResolveBatchId(signature) {
  const lastSig = satGetProp(SAT_PROP_LAST_SIG);
  const lastId = satGetProp(SAT_PROP_LAST_BATCH);
  const lastAt = Number(satGetProp(SAT_PROP_LAST_AT)) || 0;
  const fresh = (new Date().getTime() - lastAt) < SAT_DOUBLE_CLICK_WINDOW_MS;
  if (lastId && lastSig === signature && fresh) {
    return { batchId: lastId, reused: true };
  }
  return { batchId: satNewBatchId(), reused: false };
}

/** Запомнить отправленный лот. */
function satRememberBatch(batchId, signature) {
  satSetProp(SAT_PROP_LAST_BATCH, batchId);
  satSetProp(SAT_PROP_LAST_SIG, signature);
  satSetProp(SAT_PROP_LAST_AT, String(new Date().getTime()));
}

/**
 * Строка позиции из ответа мастера. Поля читаются «мягко» (positionId/id,
 * error/code/reason): сателлит не должен падать из-за иного имени поля — он
 * обязан ПОКАЗАТЬ проблему.
 */
function satFormatItemError(item) {
  if (!item) {
    return "";
  }
  const id = item.positionId || item.position_id || item.id || "";
  const raw = item.error || item.code || item.reason || item.message || "";
  const label = satItemErrorLabel(raw) || String(raw);
  return id ? (id + " — " + label) : label;
}

/** Показать результат применения лота. */
function satShowBatchResult(data) {
  const applied = Number(data.applied) || 0;
  const failed = Number(data.failed) || 0;
  const total = Number(data.total) || (applied + failed);
  const errors = (data.errors || []).map(satFormatItemError).filter(function (s) { return !!s; });
  let text = "Лот " + satBatchStatusLabel(data.status) + ": отмечено " + total +
    ", передано производству " + applied;
  if (failed > 0) {
    text += ", не передано " + failed;
  }
  if (data.error) {
    text += ". " + data.error;
  }
  if (errors.length) {
    text += ". Проблемы: " + errors.slice(0, 5).join("; ") +
      (errors.length > 5 ? " и др." : "");
  }
  satToast(text, failed > 0 ? SAT_CONFIG.UI.TOAST_SECONDS_ERROR : SAT_CONFIG.UI.TOAST_SECONDS);
  return text;
}

/**
 * Дождаться применения отложенного лота: мастер отвечает retryAfterSec, когда в
 * момент приёма занят замок (чужая отправка или синхронизация).
 */
function satAwaitBatch(batchId, attempts) {
  const maxTries = Math.max(1, attempts || 4);
  for (let i = 0; i < maxTries; i++) {
    Utilities.sleep(4000);
    const status = satFetchBatchStatus(batchId);
    if (!status.ok) {
      return null;
    }
    const found = (status.data.batches || []).filter(function (b) {
      return satNorm(b.batchId) === satNorm(batchId);
    })[0];
    if (found && found.status !== SAT_CONFIG.BATCH_STATUS.PENDING) {
      return found;
    }
  }
  return null;
}

/** Обработчик кнопки «ПРИМЕНИТЬ» и пункта меню. */
function satSubmit() {
  const sheet = satEnsureSheet();
  const project = satGetProject();
  const collected = satCollectChecked(sheet);

  if (!collected.count) {
    satToast("Нет отмеченных позиций: поставьте галочки в колонке «Отметка получено»");
    return { ok: false, error: "nothing_checked" };
  }

  const signature = satItemsSignature(collected.items);
  const batchId = satResolveBatchId(signature).batchId;
  satRememberBatch(batchId, signature);

  const res = satFetchSubmit(batchId, project, collected.items);
  if (!res.ok) {
    // Мастер синхронизируется: лот НЕ отправлен, галочки НЕ снимаем.
    if (res.errorCode === "sync_in_progress") {
      satToast(res.error, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
      satSetNotice(sheet, "Мастер синхронизируется. Отправьте лот повторно через 1–2 минуты.", true);
      return { ok: false, error: res.error, batchId: batchId };
    }
    satToast(res.error, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    satSetNotice(sheet, "Лот не отправлен: " + res.error, true);
    return { ok: false, error: res.error, batchId: batchId };
  }

  const data = res.data;

  // Лот принят, но применится позже (был занят замок).
  if (Number(data.retryAfterSec) > 0 || data.status === SAT_CONFIG.BATCH_STATUS.PENDING) {
    const waited = satAwaitBatch(batchId, 5);
    if (waited) {
      satShowBatchResult(waited);
      if ((Number(waited.applied) || 0) > 0) {
        satClearChecked(sheet);
      }
      satRefresh({ silent: true, skipClaim: true });
      return { ok: true, batchId: batchId, status: waited.status, applied: waited.applied };
    }
    satToast("Лот принят и будет применён автоматически в течение нескольких минут. " +
      "Галочки сохранены — можно закрыть файл.", SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    satSetNotice(sheet, "Лот " + batchId + " принят, применяется. Проверить: «Статус лота».", false);
    return { ok: true, batchId: batchId, pending: true };
  }

  if (data.warning && data.warning.claimedBy) {
    satToast("Внимание: проект одновременно отбирает " + data.warning.claimedBy +
      ". Лот всё равно применён.", SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
  }
  satShowBatchResult(data);

  const applied = Number(data.applied) || 0;
  if (applied > 0) {
    // Галочки снимаем ТОЛЬКО по факту применения: если ничего не прошло,
    // отборщик должен иметь возможность разобраться и повторить.
    if (satClearChecked(sheet) > 0) {
      satSetNotice(sheet, "Лот применён: передано " + applied + " позиций", false);
    }
  } else {
    satSetNotice(sheet, "Лот не применён: ни одна позиция не передана. См. подсказки выше.", true);
  }

  satRefresh({ silent: true, skipClaim: true });
  return { ok: true, batchId: batchId, status: data.status, applied: applied,
    failed: Number(data.failed) || 0 };
}

/** Пункт меню «Статус последнего лота» (проверка отложенного применения). */
function satLastBatchStatusUI() {
  const batchId = satGetProp(SAT_PROP_LAST_BATCH);
  if (!batchId) {
    satToast("Вы ещё не отправляли лот из этого файла");
    return null;
  }
  const res = satFetchBatchStatus(batchId);
  if (!res.ok) {
    satToast(res.error, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    return null;
  }
  const found = (res.data.batches || []).filter(function (b) {
    return satNorm(b.batchId) === satNorm(batchId);
  })[0];
  if (!found) {
    satToast("Лот " + batchId + " не найден в журнале мастера (журнал ограничен " +
      "последними лотами)");
    return null;
  }
  satShowBatchResult({ status: found.status, applied: found.applied, failed: found.failed,
    total: found.total, error: found.error, errors: [] });
  return found;
}
