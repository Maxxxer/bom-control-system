/**
 * BOM CONTROL SYSTEM V12 — ЛИЧНЫЙ ФАЙЛ ОТБОРЩИКА (САТЕЛЛИТ)
 * FILE: sat_install.js
 * Исключён из выгрузки в мастер: .claspignore -> sat_*.js
 *
 * УСТАНОВКА: лист-витрина, кнопка «ПРИМЕНИТЬ», триггеры.
 *
 * ПОЧЕМУ ТРИГГЕРЫ УСТАНАВЛИВАЕМЫЕ, А НЕ ПРОСТЫЕ. Простые триггеры (onOpen,
 * onEdit) не имеют права обращаться к сети: UrlFetchApp требует авторизации.
 * Обновление списка и отправка лота — сетевые операции, поэтому открытие файла
 * и смену фильтра обслуживают установленные триггеры с полными правами.
 *
 * ПОВТОРНЫЙ ЗАПУСК безопасен: наши старые триггеры удаляются, лист и кнопка
 * пересоздаются; чужие триггеры и картинки не затрагиваются.
 */

/** Обработчики, которые ставит установка (по ним же идёт удаление). */
const SAT_TRIGGERS = {
  OPEN: "satOnOpenRefresh",
  EDIT: "satOnEdit"
};

/** Удалить ТОЛЬКО наши триггеры (не трогая чужие). */
function satRemoveTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === SAT_TRIGGERS.OPEN || handler === SAT_TRIGGERS.EDIT) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

/** Поставить устанавливаемые триггеры: открытие файла и смена фильтра проекта. */
function satInstallTriggers() {
  satRemoveTriggers();
  const ss = SpreadsheetApp.getActive();

  ScriptApp.newTrigger(SAT_TRIGGERS.OPEN)
    .forSpreadsheet(ss)
    .onOpen()
    .create();

  ScriptApp.newTrigger(SAT_TRIGGERS.EDIT)
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  return { open: SAT_TRIGGERS.OPEN, edit: SAT_TRIGGERS.EDIT };
}

/**
 * УСТАНОВКА личного файла отбора.
 * Возвращает сводку: что создано, что привязано, что осталось сделать вручную.
 */
function satInstall() {
  const result = {
    ok: false,
    sheet: false,
    button: false,
    buttonBound: false,
    triggers: null,
    configured: false,
    missing: []
  };

  try {
    // 1. Лист-витрина: заголовки и закреплённая строка.
    const sheet = satEnsureSheet();
    sheet.getRange(1, 1, 1, SAT_CONFIG.COLUMN_COUNT).setValues([satHeaders()]);
    sheet.setFrozenRows(1);
    result.sheet = true;

    // 2. Фильтр проекта: список подтянем от мастера, если связь уже настроена.
    const check = satCheckConfigured();
    result.configured = check.ok;
    result.missing = check.missing;
    if (check.ok) {
      const pickers = satFetchPickers();
      satInstallProjectFilter(sheet, pickers.ok ? (pickers.data.projects || []) : []);
    } else {
      satInstallProjectFilter(sheet, []);
    }

    // 3. Кнопка «ПРИМЕНИТЬ».
    const button = satInstallButton();
    result.button = !!button.ok;
    result.buttonBound = !!button.bound;

    // 4. Триггеры.
    result.triggers = satInstallTriggers();

    // 5. Первое наполнение списка — если файл уже настроен.
    if (check.ok) {
      satRefresh({ silent: true });
    }

    result.ok = true;
    satToast("Установка выполнена: лист, кнопка и триггеры готовы" +
      (check.ok ? "" : ". Осталось заполнить настройки (меню «Настройки файла отбора»)"),
      check.ok ? SAT_CONFIG.UI.TOAST_SECONDS : SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
  } catch (e) {
    satToast("Ошибка установки: " + e.message, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    result.error = e.message;
  }

  return result;
}
