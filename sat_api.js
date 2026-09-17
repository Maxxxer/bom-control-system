/**
 * =====================================================
 * BOM CONTROL SYSTEM V12 — ЛИЧНЫЙ ФАЙЛ ОТБОРЩИКА (САТЕЛЛИТ)
 *
 * FILE: sat_api.js
 *
 * ТРАНСПОРТ: обращения к веб-приложению мастера.
 *
 * Все запросы идут ОДНИМ вызовом UrlFetchApp.fetch на один и тот же URL:
 * действие выбирается полем action (см. sat_config.js -> ACTIONS). Так у
 * сателлита одна настройка («адрес мастера»), а не шесть.
 *
 * ЕДИНАЯ ТОЧКА ВЫХОДА. Никакой код сателлита не вызывает UrlFetchApp напрямую —
 * только satCall(). Это важно, потому что здесь сосредоточены:
 *   1) подстановка секрета и адреса отборщика (satGetToken/satGetActor);
 *   2) таймаут и повторные попытки при сетевых сбоях;
 *   3) разбор ответа мастера и человекочитаемая ошибка для отборщика.
 * =====================================================
 */

/**
 * Свойства скрипта личного файла.
 */
function satProps() {
  return PropertiesService.getScriptProperties();
}

/**
 * Прочитать свойство (или "").
 */
function satGetProp(name) {
  return satProps().getProperty(name) || "";
}

/**
 * Записать свойство. Пустое значение УДАЛЯЕТ свойство (так сбрасывается,
 * например, выбранный проект).
 */
function satSetProp(name, value) {
  const v = (value === null || value === undefined) ? "" : String(value);
  if (v) {
    satProps().setProperty(name, v);
  } else {
    satProps().deleteProperty(name);
  }
}

/**
 * Адрес веб-приложения мастера.
 */
function satGetMasterUrl() {
  return satGetProp(SAT_CONFIG.PROP.MASTER_URL);
}

/**
 * Общий секрет транспорта.
 */
function satGetToken() {
  return satGetProp(SAT_CONFIG.PROP.TOKEN);
}

/**
 * Адрес отборщика (e-mail). Мастер сам проверяет его по списку ролей — именно
 * этот адрес попадает в аудит и в журнал лотов как «кто отбирал».
 */
function satGetActor() {
  return satGetProp(SAT_CONFIG.PROP.ACTOR).trim().toLowerCase();
}

/**
 * Id личного файла отборщика — попадает в журнал мастера (PICKING_BATCHES),
 * чтобы администратор видел, из какого файла пришёл лот.
 */
function satGetSpreadsheetId() {
  try {
    return SpreadsheetApp.getActive().getId();
  } catch (e) {
    return "";
  }
}

/**
 * Проверить, что личный файл настроен.
 *
 * Возвращает { ok, missing: ["адрес мастера", "секрет", ...] }.
 */
function satCheckConfigured() {
  const missing = [];
  if (!satGetMasterUrl()) {
    missing.push("адрес веб-приложения мастера");
  }
  if (!satGetToken()) {
    missing.push("секрет (токен)");
  }
  if (!satGetActor()) {
    missing.push("ваш e-mail");
  }
  return { ok: missing.length === 0, missing: missing };
}

/**
 * Человекочитаемое сообщение об отказе мастера.
 */
function satExplainError(code) {
  const map = {
    token_not_configured: "На мастере не задан секрет отборщиков (меню мастера → «Задать/сменить секрет отборщиков»).",
    unauthorized: "Неверный секрет. Скопируйте актуальный секрет из мастера в этот файл.",
    actor_required: "Не указан ваш e-mail — заполните настройки файла отбора.",
    sync_in_progress: "Мастер выполняет полную синхронизацию. Повторите через минуту — данные обновятся.",
    project_required: "Не выбран проект (ячейка B1 листа ОТБОРКА).",
    batch_id_required: "Не удалось сформировать номер лота — повторите отправку.",
    batch_too_large: "В лоте слишком много позиций. Отправьте их частями.",
    use_post: "Неверный адрес мастера: откройте адрес веб-приложения (он заканчивается на /exec)."
  };
  const key = String(code || "");
  if (map[key]) {
    return map[key];
  }
  if (key.indexOf("forbidden:") === 0) {
    return "У вашего адреса нет прав на отбор (" + key + "). Обратитесь к администратору.";
  }
  if (key.indexOf("internal:") === 0) {
    return "Ошибка на стороне мастера. Повторите позже: " + key;
  }
  return key;
}

/**
 * Вызвать мастер.
 *
 * action  — действие из SAT_CONFIG.ACTIONS;
 * payload — дополнительные поля запроса (project, batchId, items, ...).
 *
 * Возвращает { ok: true, data } либо { ok: false, error, retryAfterSec }.
 * error — уже готовый текст для отборщика (см. satExplainError).
 */
function satCall(action, payload) {
  const check = satCheckConfigured();
  if (!check.ok) {
    return {
      ok: false,
      error: "Файл не настроен: укажите " + check.missing.join(", ") +
        " (меню «Отбор» → «Настройки файла отбора»)."
    };
  }

  const url = satGetMasterUrl();
  const body = {
    action: action,
    token: satGetToken(),
    actor: satGetActor(),
    spreadsheetId: satGetSpreadsheetId()
  };
  // Дополнительные поля кладём ПОСЛЕ служебных, но служебные не перетираем:
  // action/token/actor/spreadsheetId задаёт только транспорт.
  if (payload) {
    Object.keys(payload).forEach(function (k) {
      if (!(k in body)) {
        body[k] = payload[k];
      }
    });
  }

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    followRedirects: true
  };

  let lastError = "";
  const attempts = Math.max(1, Number(SAT_CONFIG.HTTP.MAX_RETRIES) + 1);
  for (let i = 0; i < attempts; i++) {
    let response = null;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      lastError = "Нет связи с мастером: " + e.message;
      if (i + 1 < attempts) {
        Utilities.sleep(SAT_CONFIG.HTTP.RETRY_DELAY_MS);
        continue;
      }
      return { ok: false, error: lastError };
    }

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code !== 200) {
      // Повторяем только на серверных сбоях: у 4xx смысла в повторе нет.
      lastError = "Мастер вернул код " + code + ". Проверьте адрес веб-приложения.";
      if (code >= 500 && i + 1 < attempts) {
        Utilities.sleep(SAT_CONFIG.HTTP.RETRY_DELAY_MS);
        continue;
      }
      return { ok: false, error: lastError };
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "Ответ мастера не распознан (ожидался JSON)." };
    }

    if (!data || typeof data !== "object") {
      return { ok: false, error: "Пустой ответ мастера." };
    }
    if (data.ok === false) {
      return {
        ok: false,
        error: satExplainError(data.error),
        errorCode: data.error || "",
        retryAfterSec: Number(data.retryAfterSec) || 0
      };
    }
    return { ok: true, data: data };
  }

  return { ok: false, error: lastError || "Не удалось связаться с мастером." };
}

/**
 * Запросить строки отборки по проекту.
 */
function satFetchRows(project) {
  return satCall(SAT_CONFIG.ACTIONS.ROWS, { project: project || "" });
}

/**
 * Запросить список проектов и активные захваты.
 */
function satFetchPickers() {
  return satCall(SAT_CONFIG.ACTIONS.PICKERS, {});
}

/**
 * Взять проект (МЯГКО: конфликт возвращается как warning, не как ошибка).
 */
function satFetchClaim(project) {
  return satCall(SAT_CONFIG.ACTIONS.CLAIM, { project: project || "" });
}

/**
 * Освободить проект.
 */
function satFetchRelease(project) {
  return satCall(SAT_CONFIG.ACTIONS.RELEASE, { project: project || "" });
}

/**
 * Отправить лот на применение.
 *
 * items — массив { positionId, checked } (только отмеченные позиции).
 */
function satFetchSubmit(batchId, project, items) {
  return satCall(SAT_CONFIG.ACTIONS.SUBMIT, {
    batchId: batchId,
    project: project || "",
    items: items || []
  });
}

/**
 * Узнать статус конкретного лота (когда мастер ответил «идёт синхронизация»).
 */
function satFetchBatchStatus(batchId) {
  return satCall(SAT_CONFIG.ACTIONS.STATUS, { batchId: batchId || "" });
}
