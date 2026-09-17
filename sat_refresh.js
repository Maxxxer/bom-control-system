/**
 * BOM CONTROL SYSTEM V12 — ЛИЧНЫЙ ФАЙЛ ОТБОРЩИКА (САТЕЛЛИТ)
 *
 * FILE: sat_refresh.js
 *
 * ЭТОТ ФАЙЛ ПРЕДНАЗНАЧЕН ЛИЧНОМУ ФАЙЛУ ОТБОРЩИКА, А НЕ МАСТЕРУ.
 * Он исключён из выгрузки в мастер-проект (см. .claspignore: sat_*.js).
 * Инструкция — в SAT_README.md, SAT_SETUP.md, SAT_TROUBLESHOOTING.md.
 *
 * ОБНОВЛЕНИЕ СПИСКА отборки из мастера + МЯГКИЙ ЗАХВАТ проекта.
 *
 * Порядок работы отборщика:
 *   1) выбрать проект в B1;
 *   2) обновить список (или просто открыть файл);
 *   3) отметить галочками фактически отобранное;
 *   4) нажать «ПРИМЕНИТЬ» (sat_submit.js) — отметки уйдут мастеру одним лотом.
 *
 * МЯГКИЙ ЗАХВАТ. При обновлении файл сообщает мастеру «я работаю с проектом X».
 * Если проект уже занят другим отборщиком, обновление НЕ ОТМЕНЯЕТСЯ: отборщик
 * видит предупреждение, но продолжает работать. Жёсткая блокировка вредна: двое
 * иногда осознанно делят большой проект, а забытый захват навсегда остановил бы
 * работу. Захват продлевается при обновлении и сам истекает.
 * =====================================================
 */

/**
 * Обновить список отборки из мастера.
 *
 * options.silent    — не показывать всплывающие сообщения (триггер открытия);
 * options.skipClaim — не трогать захват проекта (обновление только списка).
 *
 * Возвращает { ok, project, written, keptChecked, warning, error }.
 */
function satRefresh(options) {
  const opts = options || {};
  const sheet = satEnsureSheet();

  // 1. Список проектов и активные захваты — одним вызовом.
  const pickers = satFetchPickers();
  if (!pickers.ok) {
    if (!opts.silent) {
      satToast(pickers.error, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    }
    satSetNotice(sheet, "Нет связи с мастером: " + pickers.error, true);
    return { ok: false, error: pickers.error };
  }
  const projects = pickers.data.projects || [];
  satInstallProjectFilter(sheet, projects);

  const project = satGetProject();

  // 2. Мягкий захват выбранного проекта.
  let warning = null;
  if (project && !opts.skipClaim) {
    const claim = satFetchClaim(project);
    if (claim.ok && claim.data && claim.data.warning) {
      warning = claim.data.warning;
    }
  }

  // 3. Строки отборки по проекту.
  const rowsRes = satFetchRows(project);
  if (!rowsRes.ok) {
    if (!opts.silent) {
      satToast(rowsRes.error, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    }
    satSetNotice(sheet, "Не удалось получить список: " + rowsRes.error, true);
    return { ok: false, error: rowsRes.error };
  }

  const rows = (rowsRes.data.rows || []).map(function (r) { return r.values; });
  const colors = (rowsRes.data.rows || []).map(function (r) { return r.color; });

  // 4. Запись на лист: колонки 1..12 перезаписываются, галочки в колонке 13
  //    сохраняются по Position ID (см. sat_sheet.js).
  const written = satWriteRows(sheet, rows, colors);

  // 5. Уведомление справа от таблицы.
  const title = project ? ("Проект: " + project) : "Все проекты";
  if (warning) {
    const until = warning.expiresAt ? (" до " + warning.expiresAt) : "";
    const text = "Проект " + project + " сейчас отбирает " +
      (warning.claimedBy || "другой сотрудник") + until +
      ". Можно продолжать — конфликт не блокируется.";
    satSetNotice(sheet, text, true);
    if (!opts.silent) {
      satToast(text, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    }
  } else {
    satSetNotice(sheet, title + ". Позиций: " + written.written +
      (written.keptChecked ? (", отмечено: " + written.keptChecked) : ""), false);
  }

  const summary = {
    ok: true,
    project: project,
    written: written.written,
    keptChecked: written.keptChecked,
    warning: warning
  };
  if (!opts.silent && !warning) {
    satToast("Список обновлён: " + written.written + " позиций" +
      (written.keptChecked ? (" (сохранено отметок: " + written.keptChecked + ")") : ""));
  }
  return summary;
}

/**
 * Пункт меню «Обновить список» с обратной связью.
 */
function satRefreshUI() {
  return satRefresh({ silent: false });
}

/**
 * Освободить проект (пункт меню «Освободить проект»).
 *
 * Полезно, когда отборщик закончил раньше срока захвата: следующий сотрудник
 * сразу увидит проект свободным, а не будет ждать истечения захвата.
 */
function satReleaseUI() {
  const project = satGetProject();
  if (!project) {
    satToast("Сначала выберите проект в B1");
    return { ok: false };
  }
  const res = satFetchRelease(project);
  if (!res.ok) {
    satToast(res.error, SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
    return res;
  }
  satSetProp(SAT_CONFIG.PROP.PROJECT, "");
  const sheet = satGetSheet();
  if (sheet) {
    satSetNotice(sheet, "Захват проекта " + project + " снят", false);
  }
  satToast("Проект " + project + " освобождён");
  return { ok: true, project: project, released: res.data.released };
}

/**
 * Обновление при ОТКРЫТИИ файла.
 *
 * Ставится УСТАНАВЛИВАЕМЫМ триггером (см. sat_install.js), а не простым onOpen:
 * простой триггер не имеет права делать сетевые запросы (UrlFetchApp требует
 * авторизации), поэтому в нём обновление упало бы с ошибкой доступа.
 */
function satOnOpenRefresh(e) {
  try {
    if (!satCheckConfigured().ok) {
      return;   // файл ещё не настроен — молча ждём настройки
    }
    satRefresh({ silent: true });
  } catch (err) {
    return;     // открытие файла не должно ломаться из-за сети
  }
}

/**
 * Обработка правки листа: смена проекта в B1 перечитывает список.
 *
 * Тоже УСТАНАВЛИВАЕМЫЙ триггер — по той же причине (нужна сеть).
 * Правки других ячеек игнорируются: таблица, кроме фильтра и галочек, только
 * для чтения. Галочки обрабатывать не нужно — они уходят мастеру только по
 * кнопке «ПРИМЕНИТЬ».
 */
function satOnEdit(e) {
  try {
    if (!e || !e.range) {
      return;
    }
    const sheet = e.range.getSheet();
    if (!sheet || sheet.getName() !== SAT_CONFIG.SHEET_NAME) {
      return;
    }
    const F = SAT_CONFIG.FILTER;
    if (e.range.getRow() !== F.ROW || e.range.getColumn() !== F.COL) {
      return;
    }
    if (!satCheckConfigured().ok) {
      return;
    }
    satRefresh({ silent: false });
  } catch (err) {
    satToast("Не удалось обновить список: " + err.message,
      SAT_CONFIG.UI.TOAST_SECONDS_ERROR);
  }
}
