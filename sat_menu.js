/**
 * BOM CONTROL SYSTEM V12 — ЛИЧНЫЙ ФАЙЛ ОТБОРЩИКА (САТЕЛЛИТ)
 * FILE: sat_menu.js
 * Исключён из выгрузки в мастер: .claspignore -> sat_*.js
 *
 * МЕНЮ «ОТБОР», НАСТРОЙКИ ФАЙЛА И КНОПКА «ПРИМЕНИТЬ».
 *
 * Меню ставится ПРОСТЫМ триггером onOpen: он срабатывает при каждом открытии
 * файла без авторизации, и этого достаточно — меню только открывает функции.
 * А ОБНОВЛЕНИЕ списка и ОТПРАВКА лота требуют сети, поэтому они работают из
 * устанавливаемых триггеров и пунктов меню (там авторизация есть).
 */

/** Простой триггер открытия: строит меню «Отбор». */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Отбор")
    .addItem("✅ Отправить отмеченное мастеру", "satSubmit")
    .addItem("🔄 Обновить список", "satRefreshUI")
    .addSeparator()
    .addItem("🏁 Освободить проект", "satReleaseUI")
    .addItem("🧾 Статус последнего лота", "satLastBatchStatusUI")
    .addSeparator()
    .addItem("⚙ Настройки файла отбора", "satSettingsUI")
    .addItem("🛡 Восстановить кнопку «ПРИМЕНИТЬ»", "satInstallButtonUI")
    .addSeparator()
    .addItem("🧩 Установка (лист, триггеры, кнопка)", "satInstall")
    .addItem("❓ О программе", "satAboutUI")
    .addToUi();
}

/**
 * Настройки файла отбора: адрес мастера, секрет, свой e-mail.
 * Три отдельных запроса — намеренно: так меняется одно поле, остальные не
 * вводятся заново. Пустой ответ оставляет поле без изменений.
 */
function satSettingsUI() {
  const ui = SpreadsheetApp.getUi();

  const urlResponse = ui.prompt(
    "Настройки файла отбора (1/3)",
    "Адрес веб-приложения мастера (заканчивается на /exec).\n" +
    "Сейчас: " + (satGetMasterUrl() || "не задан"),
    ui.ButtonSet.OK_CANCEL);
  if (urlResponse.getSelectedButton() === ui.Button.OK) {
    const url = String(urlResponse.getResponseText() || "").trim();
    if (url) {
      satSetProp(SAT_CONFIG.PROP.MASTER_URL, url);
    }
  }

  const tokenResponse = ui.prompt(
    "Настройки файла отбора (2/3)",
    "Секрет отборщиков (мастер: «Задать/сменить секрет отборщиков»).\n" +
    "Сейчас: " + (satGetToken() ? "задан" : "не задан"),
    ui.ButtonSet.OK_CANCEL);
  if (tokenResponse.getSelectedButton() === ui.Button.OK) {
    const token = String(tokenResponse.getResponseText() || "").trim();
    if (token) {
      satSetProp(SAT_CONFIG.PROP.TOKEN, token);
    }
  }

  let ownEmail = "";
  try {
    ownEmail = Session.getActiveUser().getEmail() || "";
  } catch (e) {
    ownEmail = "";
  }
  const actorResponse = ui.prompt(
    "Настройки файла отбора (3/3)",
    "Ваш рабочий e-mail (как в списке доступа мастера):\n" +
    (satGetActor() || ownEmail || "—"),
    ui.ButtonSet.OK_CANCEL);
  if (actorResponse.getSelectedButton() === ui.Button.OK) {
    const actor = String(actorResponse.getResponseText() || "").trim().toLowerCase();
    if (actor) {
      satSetProp(SAT_CONFIG.PROP.ACTOR, actor);
    }
  }

  const check = satCheckConfigured();
  if (!check.ok) {
    satToast("Настройка не завершена: укажите " + check.missing.join(", "),
      SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    return { ok: false, missing: check.missing };
  }

  // Проверяем связь сразу: отборщик узнаёт об ошибке здесь, а не при отправке.
  const probe = satFetchPickers();
  if (!probe.ok) {
    satToast("Связь с мастером не подтверждена: " + probe.error,
      SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    return { ok: false, error: probe.error };
  }
  satToast("Настройки сохранены. Проектов доступно: " + (probe.data.projects || []).length);
  return { ok: true, projects: (probe.data.projects || []).length };
}

/** О программе: что настроено и порядок работы. */
function satAboutUI() {
  const lines = [
    SAT_CONFIG.SYSTEM_NAME,
    "Версия: " + SAT_CONFIG.VERSION,
    "",
    "Этот файл — ЛИЧНОЕ рабочее место отборщика.",
    "Мастер: " + (satGetMasterUrl() || "не настроен"),
    "Отборщик: " + (satGetActor() || "не настроен"),
    "Секрет: " + (satGetToken() ? "задан" : "не задан"),
    "Проект в B1: " + (satGetProject() || "(Все проекты)"),
    "",
    "Порядок работы:",
    "1. Выберите проект в ячейке B1.",
    "2. Обновите список (или откройте файл заново).",
    "3. Отметьте галочками фактически отобранное.",
    "4. Нажмите «ПРИМЕНИТЬ» — отметки уйдут мастеру одним лотом."
  ];
  const ui = SpreadsheetApp.getUi();
  ui.alert(SAT_CONFIG.SYSTEM_NAME, lines.join("\n"), ui.ButtonSet.OK);
  return lines.join("\n");
}

/** Blob картинки-кнопки (PNG из base64 в sat_config.js). */
function satBuildButtonBlob() {
  return Utilities.newBlob(Utilities.base64Decode(SAT_CONFIG.BUTTON_PNG_BASE64),
    "image/png", "sat-apply-button.png");
}

/** Удалить ранее поставленную кнопку. Трогаем только наши картинки. */
function satRemoveButton(sheet) {
  if (!sheet || typeof sheet.getImages !== "function") {
    return 0;
  }
  let removed = 0;
  sheet.getImages().forEach(function (image) {
    if (typeof image.getScript === "function" &&
        image.getScript() === SAT_CONFIG.UI.BUTTON_SCRIPT) {
      image.remove();
      removed++;
    }
  });
  return removed;
}

/**
 * Поставить кнопку «ПРИМЕНИТЬ» и назначить ей скрипт satSubmit.
 * bound=false: картинка поставлена, но назначить скрипт автоматически не
 * удалось — назначьте вручную (правый клик по кнопке → «Назначить скрипт»).
 */
function satInstallButton() {
  const sheet = satEnsureSheet();
  if (typeof sheet.insertImage !== "function") {
    return { ok: false, bound: false, reason: "Вставка картинок недоступна в этом окружении" };
  }
  satRemoveButton(sheet);
  const image = sheet.insertImage(satBuildButtonBlob(), 1, 1, 2, 1);
  image.setAltTextTitle(SAT_CONFIG.UI.TOAST_TITLE);
  image.setAltTextDescription(SAT_CONFIG.UI.BUTTON_ALT);
  image.assignScript(SAT_CONFIG.UI.BUTTON_SCRIPT);
  image.setWidth(124);
  image.setHeight(20);
  const bound = (typeof image.getScript === "function") &&
    image.getScript() === SAT_CONFIG.UI.BUTTON_SCRIPT;
  return { ok: true, bound: bound };
}

/** Пункт меню «Восстановить кнопку «ПРИМЕНИТЬ»». */
function satInstallButtonUI() {
  let res;
  try {
    res = satInstallButton();
  } catch (e) {
    satToast("Не удалось поставить кнопку: " + e.message, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    return null;
  }
  if (!res.ok) {
    satToast(res.reason || "Не удалось поставить кнопку", SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
  } else if (!res.bound) {
    satToast("Кнопка поставлена, но скрипт не назначился: правый клик по кнопке → " +
      "«Назначить скрипт» → satSubmit", SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
  } else {
    satToast("Кнопка «ПРИМЕНИТЬ» поставлена и привязана к отправке лота");
  }
  return res;
}
