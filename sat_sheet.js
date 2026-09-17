/**
 * =====================================================
 * BOM CONTROL SYSTEM V12 — ЛИЧНЫЙ ФАЙЛ ОТБОРЩИКА (САТЕЛЛИТ)
 *
 * FILE: sat_sheet.js
 *
 * ОПЕРАЦИИ С ЛИСТОМ-ВИТРИНОЙ «ОТБОРКА» личного файла.
 *
 * ГЛАВНОЕ ПРАВИЛО (устранение конфликта A2). Обновление списка НИКОГДА не
 * трогает колонку галочек «Отметка получено» (колонка 13) — она заполняется
 * отдельно и сопоставляется СТРОКАМИ ПО Position ID, а не по номеру строки.
 * Поэтому:
 *   - обновление списка не сбрасывает уже расставленные галочки;
 *   - перестановка строк местами (сортировка в мастере) не «переезжает» на
 *     чужие позиции — галочка остаётся на своём Position ID;
 *   - снятие галочки в мастере не может появиться у отборщика «само».
 * Именно из-за отсутствия этого правила в общем мастерском листе пересборка
 * проекций стирала неприменённые галочки всем сразу.
 *
 * Перезаписываются только колонки 1..12 (данные). Колонка 13 — только
 * сопоставление и запись.
 * =====================================================
 */

/** Ячейка-уведомление справа от таблицы (вне колонок данных 1..13). */
const SAT_NOTICE_CELL = { ROW: 1, COL: 15 };

/**
 * Получить лист-витрину (или null).
 */
function satGetSheet() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SAT_CONFIG.SHEET_NAME);
}

/**
 * Получить лист-витрину, создав его при необходимости.
 *
 * Заголовки и валидация чекбоксов ставятся только при создании листа.
 */
function satEnsureSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SAT_CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SAT_CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, SAT_CONFIG.COLUMN_COUNT).setValues([satHeaders()]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(SAT_CONFIG.COLUMNS.CHECKBOX, 130);
    sheet.setColumnWidth(SAT_CONFIG.FILTER.COL, 160);
  }
  return sheet;
}

/**
 * Прочитать карту «Position ID -> стоит ли галочка» из колонки 13.
 */
function satReadCheckedMap(sheet) {
  const COL = SAT_CONFIG.COLUMNS;
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < SAT_CONFIG.FIRST_DATA_ROW) {
    return map;
  }
  const count = lastRow - SAT_CONFIG.FIRST_DATA_ROW + 1;
  // Читаем ВСЕ 13 колонок одним запросом: нужны и Position ID (кол. 1), и
  // значение чекбокса (кол. 13).
  const values = sheet.getRange(SAT_CONFIG.FIRST_DATA_ROW, 1, count, COL.CHECKBOX).getValues();
  values.forEach(function (row) {
    const id = satNorm(row[COL.POSITION_ID - 1]);
    if (id) {
      map[id] = satIsChecked(row[COL.CHECKBOX - 1]);
    }
  });
  return map;
}

/**
 * Нормализовать идентификатор для сопоставления строк.
 */
function satNorm(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/**
 * true, если значение — взведённый чекбокс (Sheets отдаёт boolean).
 */
function satIsChecked(value) {
  if (value === true) {
    return true;
  }
  const s = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
  return s === "true" || s === "истина" || s === "1";
}

/**
 * Записать строки отборки в лист, СОХРАНИВ галочки по Position ID.
 *
 * rows   — массив массивов значений по колонкам 1..12 (как отдаёт мастер);
 * colors — массив цветов строк (может быть пустым).
 *
 * Возвращает { written, keptChecked }.
 */
function satWriteRows(sheet, rows, colors) {
  const COL = SAT_CONFIG.COLUMNS;
  const first = SAT_CONFIG.FIRST_DATA_ROW;
  const dataCols = COL.CHECKBOX - 1;   // 1..12 — данные, 13 — галочки
  const checked = satReadCheckedMap(sheet);
  const list = rows || [];

  // Область, которую нужно очистить по колонкам 1..12: всё, что было, и всё,
  // что нужно под новое содержимое (чтобы ниже списка не осталось «хвостов»).
  const lastUsed = Math.max(sheet.getLastRow(), first - 1);
  const clearUntil = Math.max(lastUsed, first + list.length - 1);
  if (clearUntil >= first) {
    sheet.getRange(first, 1, clearUntil - first + 1, dataCols).clearContent();
  }

  if (list.length) {
    // Значения приходят массивом любой длины: подрезаем/дополняем до 12 колонок,
    // чтобы setValues не падал на «несоответствии размеров».
    const values = list.map(function (row) {
      const out = new Array(dataCols).fill("");
      for (let i = 0; i < dataCols && i < row.length; i++) {
        out[i] = row[i];
      }
      return out;
    });
    sheet.getRange(first, 1, values.length, dataCols).setValues(values);
  }

  // КОЛОНКА ГАЛОЧЕК. Пишем её ОТДЕЛЬНО и НИКОГДА не очищаем вместе с данными.
  // Галочка восстанавливается по Position ID; для строк, которых больше нет в
  // списке, галочка гасится (иначе остались бы «фантомные» отметки).
  let keptChecked = 0;
  const checkboxTotal = clearUntil >= first ? (clearUntil - first + 1) : 0;
  if (checkboxTotal > 0) {
    const flags = new Array(checkboxTotal).fill(false);
    for (let i = 0; i < list.length; i++) {
      const id = satNorm(list[i][COL.POSITION_ID - 1]);
      if (id && checked[id]) {
        flags[i] = true;
        keptChecked++;
      }
    }
    sheet.getRange(first, COL.CHECKBOX, checkboxTotal, 1).setValues(
      flags.map(function (f) { return [f]; })
    );
  }

  // Цвета — на всю ширину таблицы, чтобы цвет следовал за строкой.
  if (colors && colors.length) {
    const backgrounds = colors.map(function (c) {
      return new Array(SAT_CONFIG.COLUMN_COUNT).fill(c || SAT_CONFIG.COLORS.WHITE);
    });
    sheet.getRange(first, 1, backgrounds.length, SAT_CONFIG.COLUMN_COUNT)
      .setBackgrounds(backgrounds);
  }

  satInstallCheckboxes(sheet, list.length, checkboxTotal);
  return { written: list.length, keptChecked: keptChecked };
}

/**
 * (Пере)установить валидацию чекбоксов на колонку 13.
 *
 * Валидация ставится на строки данных и снимается ниже — иначе под списком
 * остались бы «фантомные» чекбоксы в пустых строках.
 */
function satInstallCheckboxes(sheet, rowCount, totalRows) {
  const COL = SAT_CONFIG.COLUMNS;
  const first = SAT_CONFIG.FIRST_DATA_ROW;
  const total = Math.max(totalRows || 0, rowCount || 0, sheet.getMaxRows() - first + 1);
  if (total <= 0) {
    return;
  }
  sheet.getRange(first, COL.CHECKBOX, total, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(first, COL.CHECKBOX, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Сколько позиций отмечено сейчас.
 */
function satCountChecked(sheet) {
  const map = satReadCheckedMap(sheet);
  let count = 0;
  Object.keys(map).forEach(function (id) {
    if (map[id]) {
      count++;
    }
  });
  return count;
}

/**
 * Собрать отмеченные позиции для отправки лота.
 *
 * Возвращает { items: [{ positionId, checked }], count }.
 * Отправляются ТОЛЬКО отмеченные: мастеру не нужен список всего листа.
 */
function satCollectChecked(sheet) {
  const map = satReadCheckedMap(sheet);
  const items = [];
  Object.keys(map).forEach(function (id) {
    if (map[id]) {
      items.push({ positionId: id, checked: true });
    }
  });
  return { items: items, count: items.length };
}

/**
 * Снять все галочки (после успешной отправки лота).
 */
function satClearChecked(sheet) {
  const COL = SAT_CONFIG.COLUMNS;
  const first = SAT_CONFIG.FIRST_DATA_ROW;
  const lastRow = sheet.getLastRow();
  if (lastRow < first) {
    return 0;
  }
  const count = lastRow - first + 1;
  const range = sheet.getRange(first, COL.CHECKBOX, count, 1);
  const cleared = satCountChecked(sheet);
  range.setValues(new Array(count).fill([false]));
  return cleared;
}

/**
 * Записать в B1 выбранный проект и запомнить его в свойствах скрипта.
 */
function satSetProject(project) {
  const sheet = satEnsureSheet();
  sheet.getRange(SAT_CONFIG.FILTER.ROW, SAT_CONFIG.FILTER.COL)
    .setValue(project || SAT_CONFIG.FILTER.ALL);
  satSetProp(SAT_CONFIG.PROP.PROJECT, project || "");
}

/**
 * Прочитать выбранный проект из B1.
 * Пустое значение и «(Все проекты)» трактуются как «без фильтра».
 */
function satGetProject() {
  const sheet = satGetSheet();
  if (!sheet) {
    return "";
  }
  const raw = satNorm(sheet.getRange(SAT_CONFIG.FILTER.ROW, SAT_CONFIG.FILTER.COL).getValue());
  if (!raw || raw === SAT_CONFIG.FILTER.ALL) {
    return "";
  }
  return raw;
}

/**
 * Поставить выпадающий список проектов в B1 и подпись «Проект:» в A1.
 *
 * Список приходит от мастера (действие pickers) — сателлит не знает состав
 * проектов сам. Текущее значение, которого нет в списке, сбрасывается на
 * «(Все проекты)», чтобы отборщик не остался с пустым листом.
 */
function satInstallProjectFilter(sheet, projects) {
  const list = [SAT_CONFIG.FILTER.ALL].concat(projects || []);
  const cell = sheet.getRange(SAT_CONFIG.FILTER.ROW, SAT_CONFIG.FILTER.COL);
  cell.clearDataValidations();
  cell.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(list, true).build()
  );
  const current = satNorm(cell.getValue());
  if (current !== SAT_CONFIG.FILTER.ALL && (projects || []).indexOf(current) === -1) {
    cell.setValue(SAT_CONFIG.FILTER.ALL);
    satSetProp(SAT_CONFIG.PROP.PROJECT, "");
  }
  sheet.getRange(SAT_CONFIG.FILTER.ROW, 1).setValue("Проект →");
}

/**
 * Показать уведомление справа от таблицы.
 *
 * ПОЧЕМУ НЕ «БАННЕР ВВЕРХУ». Верхняя строка занята заголовками, а B1 по
 * требованию — это фильтр проекта. Поэтому уведомление выводится в свободную
 * колонку справа от таблицы: оно не мешает таблице, не сдвигает данные и
 * заметно (красный фон при предупреждении, зелёный — при нормальной работе).
 */
function satSetNotice(sheet, text, isWarning) {
  const cell = sheet.getRange(SAT_NOTICE_CELL.ROW, SAT_NOTICE_CELL.COL);
  cell.setValue(text || "");
  cell.setBackground(isWarning ? SAT_CONFIG.WARN_COLOR : SAT_CONFIG.OK_COLOR);
  cell.setFontWeight("bold");
  try {
    sheet.setColumnWidth(SAT_NOTICE_CELL.COL, 380);
  } catch (e) {
    // Ширина — косметика: если не удалось, уведомление всё равно показано.
  }
}

/**
 * Очистить уведомление.
 */
function satClearNotice(sheet) {
  const cell = sheet.getRange(SAT_NOTICE_CELL.ROW, SAT_NOTICE_CELL.COL);
  cell.setValue("");
  cell.setBackground(SAT_CONFIG.COLORS.WHITE);
  cell.setFontWeight("normal");
}

/**
 * Всплывающее сообщение в правом нижнем углу окна.
 */
function satToast(message, seconds) {
  const text = String(message === undefined || message === null ? "" : message);
  const sec = (typeof seconds === "number" && seconds > 0)
    ? seconds
    : SAT_CONFIG.UI.TOAST_SECONDS;
  try {
    SpreadsheetApp.getActive().toast(text, SAT_CONFIG.UI.TOAST_TITLE, sec);
    return true;
  } catch (e) {
    return false;
  }
}
