/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_ui.js
 *
 * Пользовательский интерфейс модели V3:
 *   1) всплывающие сообщения (toast) в правом нижнем углу окна таблицы —
 *      вместо модальных диалогов;
 *   2) кнопка «ПРИМЕНИТЬ» в верхнем левом углу рабочего листа (картинка
 *      поверх ячеек, которой назначен скрипт v12ApplyChangesUI).
 *
 * ПОЧЕМУ КАРТИНКА. Настоящую кнопку поверх сетки листа в Google Sheets можно
 * создать только картинкой/чертежом. Программно это делается полностью:
 * Sheet.insertImage(blob, col, row) + OverGridImage.assignScript(name) —
 * внешние файлы и ручные шаги не нужны (PNG лежит в коде в base64).
 *
 * ПОЧЕМУ КОЛОНКА A. Кнопка привязана к ячейке A1 (верхний левый угол листа),
 * поэтому колонка A расширяется до ширины кнопки — так кнопка не перекрывает
 * заголовок соседней колонки. Данные (Position ID) в колонке A показываются
 * ниже, в строках 2+.
 * =====================================================
 */

/**
 * Параметры интерфейса.
 */
const V12_UI = {
  // Всплывающие сообщения (toast).
  TOAST_TITLE: "BOM CONTROL V12",
  TOAST_SECONDS: 3,
  TOAST_SECONDS_ERROR: 8,

  // Кнопка «Применить».
  BUTTON_SCRIPT: "v12ApplyChangesUI",
  BUTTON_LABEL: "ПРИМЕНИТЬ",
  BUTTON_ALT: "Применить изменения (очередь PENDING_EDITS)",
  BUTTON_COLUMN: 1,
  BUTTON_ROW: 1,
  BUTTON_COLUMN_WIDTH: 130,
  BUTTON_WIDTH: 124,
  BUTTON_HEIGHT: 20,
  BUTTON_OFFSET_X: 2,
  BUTTON_OFFSET_Y: 1,
  // Листы, на которых кнопка «Применить» ставится при установке.
  BUTTON_SHEETS: ["DEFICIT_SUMMARY", "PICKING", "WORKING_BOM"],

  /**
   * PNG-код кнопки «ПРИМЕНИТЬ» (124x20, зелёная со скруглением, белый текст).
   * Сгенерирован офлайн растровым шрифтом 5x7 — самодостаточен, без URL.
   */
  BUTTON_PNG_BASE64:
    "iVBORw0KGgoAAAANSUhEUgAAAHwAAAAUCAYAAABPuVmJAAAAx0lEQVR42u2ayw2AIAxA2cG7IziEA7iK+5/0ogkeCOVTsPCa9KA0UvpMLRbnHlmO7ULHVee" +
    "LP7CeOzqYfqADei7wIuBSkdqHnh+bv9Q+1X8r/iQDjxkCfFLg2gHIDZj0vjQw2v7XHgc4wG0ClwJMvW613tinDOAAtw08t2grBVjLn9yiSivlS/0HOMD7pv" +
    "TU1KddFNZ+wVsXbdL1ARzgfYH32vZZ35YBHOAA/9OvVYo2gLcFTnt0ovbo2xMnIONr8NQLOu4RpxuYfQiD8ON7kQAAAABJRU5ErkJggg=="
};

/**
 * ====================================================
 * Всплывающие сообщения (toast)
 * ====================================================
 */

/**
 * Показать всплывающее сообщение в правом нижнем углу окна таблицы.
 *
 * Работает только там, где есть UI (меню, кнопка на листе). Из фонового
 * триггера сообщение показать нельзя — такой вызов тихо игнорируется и
 * фиксируется в системном логе, чтобы падение не ломало применение.
 *
 * Возвращает true, если сообщение удалось показать.
 */
function v12Toast(message, seconds) {
  const text = String(message === undefined || message === null ? "" : message);
  const sec = (typeof seconds === "number" && seconds > 0) ? seconds : V12_UI.TOAST_SECONDS;
  try {
    SpreadsheetApp.getActive().toast(text, V12_UI.TOAST_TITLE, sec);
    return true;
  } catch (e) {
    logSystem("v12Toast", e.message + " (сообщение: " + text + ")", e, "ERROR");
    flushSystemLog();
    return false;
  }
}

/**
 * ====================================================
 * Кнопка «Применить» в верхнем левом углу листа
 * ====================================================
 */

/**
 * Blob картинки-кнопки (PNG из base64, лежащего в коде).
 */
function v12BuildApplyButtonBlob() {
  const bytes = Utilities.base64Decode(V12_UI.BUTTON_PNG_BASE64);
  return Utilities.newBlob(bytes, "image/png", "v12-apply-button.png");
}

/**
 * Удалить ранее поставленную кнопку «Применить» с листа (идемпотентность
 * установки). Удаляются только картинки, назначенные на v12ApplyChangesUI —
 * пользовательские картинки не трогаются.
 *
 * Возвращает число удалённых кнопок.
 */
function v12RemoveApplyButtonFromSheet(sheet) {
  if (!sheet || typeof sheet.getImages !== "function") {
    return 0;
  }
  let removed = 0;
  sheet.getImages().forEach(function (image) {
    if (typeof image.getScript === "function" && image.getScript() === V12_UI.BUTTON_SCRIPT) {
      image.remove();
      removed++;
    }
  });
  return removed;
}

/**
 * Удалить кнопки «Применить» со всех листов V12.
 */
function v12RemoveApplyButton() {
  let removed = 0;
  Object.keys(V12_CONFIG.SHEETS).forEach(function (key) {
    removed += v12RemoveApplyButtonFromSheet(getSheetByName(V12_CONFIG.SHEETS[key]));
  });
  return removed;
}

/**
 * Поставить кнопку «Применить» в верхний левый угол рабочих листов и назначить
 * ей скрипт применения (v12ApplyChangesUI).
 *
 * Идемпотентно: старая кнопка удаляется перед вставкой новой, поэтому повторный
 * запуск не плодит копии. Возвращает { installed: [...имена листов],
 * unbound: [...имена листов, где назначение скрипта не подтвердилось] }.
 */
function v12InstallApplyButton() {
  const installed = [];
  const unbound = [];
  const blob = v12BuildApplyButtonBlob();

  V12_UI.BUTTON_SHEETS.forEach(function (key) {
    const sheet = getSheetByName(V12_CONFIG.SHEETS[key]);
    if (!sheet || typeof sheet.insertImage !== "function") {
      return;
    }
    v12RemoveApplyButtonFromSheet(sheet);
    // Колонка A расширяется под кнопку — она не перекрывает соседний заголовок.
    if (typeof sheet.setColumnWidth === "function") {
      sheet.setColumnWidth(V12_UI.BUTTON_COLUMN, V12_UI.BUTTON_COLUMN_WIDTH);
    }
    const image = sheet.insertImage(
      blob,
      V12_UI.BUTTON_COLUMN,
      V12_UI.BUTTON_ROW,
      V12_UI.BUTTON_OFFSET_X,
      V12_UI.BUTTON_OFFSET_Y
    );
    image.setAltTextTitle(V12_UI.TOAST_TITLE);
    image.setAltTextDescription(V12_UI.BUTTON_ALT);
    image.assignScript(V12_UI.BUTTON_SCRIPT);
    image.setWidth(V12_UI.BUTTON_WIDTH);
    image.setHeight(V12_UI.BUTTON_HEIGHT);
    // Проверяем, что привязка скрипта действительно применилась: если нет —
    // сообщаем пользователю (тогда кнопку нужно привязать вручную).
    const bound = (typeof image.getScript === "function") && image.getScript() === V12_UI.BUTTON_SCRIPT;
    if (bound) {
      installed.push(V12_CONFIG.SHEETS[key]);
    } else {
      unbound.push(V12_CONFIG.SHEETS[key]);
    }
  });

  if (unbound.length) {
    logSystem("v12InstallApplyButton",
      "Не удалось назначить скрипт на кнопку для листов: " + unbound.join(", "), "WARNING");
  } else {
    logSystem("v12InstallApplyButton",
      "Кнопка «" + V12_UI.BUTTON_LABEL + "» установлена: " + installed.join(", "), "INFO");
  }
  return { installed: installed, unbound: unbound };
}

/**
 * Пункт меню «Восстановить кнопку "Применить"» с обратной связью.
 */
function v12InstallApplyButtonUI() {
  let result;
  try {
    result = v12InstallApplyButton();
  } catch (e) {
    logSystem("v12InstallApplyButtonUI", e.message, e, "ERROR");
    flushSystemLog();
    v12Toast("Не удалось поставить кнопку: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return null;
  }
  if (result.unbound.length) {
    v12Toast("Кнопка поставлена, но скрипт не назначился на листах: " + result.unbound.join(", ") +
      " — назначьте вручную (правый клик по кнопке → «Назначить скрипт»).", V12_UI.TOAST_SECONDS_ERROR);
  } else if (!result.installed.length) {
    v12Toast("Листы для кнопки не найдены — выполните «Установка V12».");
  } else {
    v12Toast("Кнопка «" + V12_UI.BUTTON_LABEL + "» поставлена: " + result.installed.join(", "));
  }
  return result;
}
