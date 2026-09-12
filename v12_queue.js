/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_queue.js
 *
 * Очередь правок (Вариант D + Вариант A) в модели «Применить» (V3).
 *
 * ПРОБЛЕМА (до V3). onEdit сам применял правку: пересчитывал состояние и
 * пересобирал 5 проекций, удерживая общескриптовую блокировку, — а фоновая
 * пересборка конкурировала с набором текста в ячейке. Введённые значения
 * сбрасывались («быстрый ввод → сброс в 0.0»), галочка чекбокса снималась
 * (v12RevertEdit), всплывало «Система занята обновлением».
 *
 * РЕШЕНИЕ (V3). onEdit только ФИКСИРУЕТ НАМЕРЕНИЕ строкой в листе
 * PENDING_EDITS (быстро, без лока и без пересборки проекций). Применение
 * выполняет пользователь кнопкой «ПРИМЕНИТЬ» в верхнем левом углу листа или
 * пунктом меню «Применить изменения» (v12ApplyChanges) — пакетно, ОДНИМ
 * пересчётом проекций на всю пачку намерений. Автоприменения
 * (инлайн-слив из onEdit) и минутного триггера НЕТ: пока пользователь не
 * применил, проекции не пересобираются вообще, поэтому окна гонки во время
 * набора текста не существует. Очередь авторитетна: значение не теряется,
 * даже если ячейку успела перезаписать пересборка.
 *
 * ПРАВИЛА.
 *   - last-wins по (SOURCE, POSITION_ID, FIELD): решает последняя строка;
 *     для чекбокс-полей (HANDOFF, REAL_DELIVERY) VALUE=false означает ОТМЕНУ
 *     намерения (отметку сняли) — передача/поставка не выполняется. Для
 *     типизированных полей (Заказано, Ожидаемая) «ложных» значений не бывает:
 *     Заказано=0 и очистка даты — это обычные значения, а не отмена;
 *   - применение идемпотентно (v12MarkReceivedByProduction; реальная поставка
 *     фиксируется только «вверх»);
 *   - «кто сделал» берётся из строки очереди: применение идёт от имени автора
 *     правки, иначе аудит/журнал получили бы владельца скрипта.
 * =====================================================
 */

/**
 * ====================================================
 * Актор-контекст
 * ====================================================
 *
 * Позволяет фоновому применению записать в аудит/журнал/роли реального
 * автора правки (а не владельца скрипта). Вне слива оверрайд пуст —
 * поведение не меняется.
 */
let _v12ActorOverride = "";

/**
 * Текущий «актор»: override (внутри слива) либо живой пользователь.
 */
function v12CurrentActor() {
  return _v12ActorOverride || getCurrentUser();
}

/**
 * Выполнить fn() «от имени» actor (для аудита/журнала/проверки ролей).
 */
function v12WithActor(actor, fn) {
  const prev = _v12ActorOverride;
  _v12ActorOverride = actor || "";
  try {
    return fn();
  } finally {
    _v12ActorOverride = prev;
  }
}

/**
 * ====================================================
 * Захват намерения (вызывается из onEdit)
 * ====================================================
 */

/**
 * true, если поле очереди — ЧЕКБОКС (boolean-семантика): передача или
 * реальная поставка. Остальные поля (Заказано/Ожидаемая) — типизированные.
 */
function v12IsBooleanPendingField(field) {
  const F = V12_CONFIG.PENDING_FIELD;
  return field === F.HANDOFF || field === F.REAL_DELIVERY;
}

/**
 * Привести значение намерения к типу, соответствующему полю FIELD:
 *   чекбоксы (HANDOFF / REAL_DELIVERY) -> boolean (v12IsChecked);
 *   Заказано (ORDERED_QTY)             -> неотрицательное число;
 *   Ожидаемая (EXPECTED_DATE)          -> Date либо "" (пусто).
 *
 * Единая точка интерпретации колонки VALUE очереди: и при захвате правки,
 * и при разборе намерений применяется одна и та же нормализация, поэтому
 * типизированные поля не «схлопываются» в boolean, как раньше.
 */
function v12NormalizePendingValue(field, value) {
  const F = V12_CONFIG.PENDING_FIELD;
  if (v12IsBooleanPendingField(field)) {
    return v12IsChecked(value);
  }
  if (field === F.ORDERED_QTY) {
    return Math.max(0, toNumber(value));
  }
  if (field === F.EXPECTED_DATE) {
    const d = v12ToDate(value);
    return d ? d : "";
  }
  return value;
}

/**
 * Собрать строку очереди (массив по колонкам PENDING_EDITS).
 */
function v12BuildPendingRow(sourceKey, positionId, field, value, actor, editId) {
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.PENDING_EDITS).fill("");
  row[Q.DATE - 1] = new Date();
  // editId передаётся, когда на одну пачку достаточно ОДНОГО Edit ID
  // (не тратим RPC Utilities.getUuid() на каждую строку захвата).
  row[Q.EDIT_ID - 1] = editId || generateEventId();
  row[Q.SOURCE - 1] = sourceKey;
  row[Q.POSITION_ID - 1] = normalizeMaterialId(positionId);
  row[Q.FIELD - 1] = field;
  row[Q.VALUE - 1] = v12NormalizePendingValue(field, value);
  row[Q.USER - 1] = actor || v12CurrentActor();
  row[Q.STATUS - 1] = V12_CONFIG.PENDING_STATUS.PENDING;
  return row;
}

/**
 * Ключ намерения: SOURCE|POSITION_ID|FIELD (нормализованный).
 */
function v12PendingKey(source, positionId, field) {
  return String(source || "").trim() + "|" +
    normalizeMaterialId(positionId) + "|" +
    String(field || "").trim();
}

/**
 * Зафиксировать пачку намерений в PENDING_EDITS.
 *
 * V4-надёжность (фикс дефекта «не все позиции попадают в очередь»):
 *   1) запись идёт ПОД коротким общескриптовым локом, а `getLastRow()+1`
 *      вычисляется уже ПОД локом — параллельные onEdit больше НЕ перезатирают
 *      строки друг друга (раньше два события читали один getLastRow() и писали
 *      в одну строку — часть намерений терялась);
 *   2) UPsert по ключу (SOURCE|POSITION_ID|FIELD): если по ключу уже есть
 *      PENDING-строка — она обновляется на месте (значение/автор/дата), иначе
 *      строка добавляется. Убирает дубли «снял → поставил» и делает применение
 *      детерминированным (в очереди максимум одно актуальное намерение на ключ).
 *
 * После записи обновляется ячейка-индикатор «есть неприменённые изменения».
 */
function v12EnqueuePendingRows(rowArrays) {
  if (!rowArrays || !rowArrays.length) {
    return;
  }
  // Лок с одним коротким повтором: сглаживает конкуренцию с параллельным onEdit
  // или идущим «Применить»/полным синком, не теряя намерение «с первого раза».
  let lock = acquireScriptLock({ tryOnly: true, timeoutMs: 10000 });
  if (!lock) {
    if (typeof Utilities !== "undefined" && Utilities.sleep) {
      Utilities.sleep(300);
    }
    lock = acquireScriptLock({ tryOnly: true, timeoutMs: 5000 });
  }
  if (!lock) {
    logSystem("v12EnqueuePendingRows",
      "Очередь занята (идёт применение/синхронизация) — намерение не зафиксировано", "WARNING");
    flushSystemLog();
    return;
  }
  try {
    const sheet = v12GetSheetByKey("PENDING_EDITS");
    const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
    const PENDING = V12_CONFIG.PENDING_STATUS.PENDING;

    // Ключ -> номер строки листа для действующих (PENDING) намерений.
    const byKey = {};
    const data = readSheetValues(sheet);
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (String(r[Q.STATUS - 1]).trim() !== PENDING) {
        continue;
      }
      const pid = normalizeMaterialId(r[Q.POSITION_ID - 1]);
      if (!pid) {
        continue;
      }
      byKey[v12PendingKey(r[Q.SOURCE - 1], pid, r[Q.FIELD - 1])] = i + 1;
    }

    // Схлопываем дубли внутри самой пачки (last-wins), затем upsert.
    const order = [];
    const batch = {};
    rowArrays.forEach(function (row) {
      const key = v12PendingKey(row[Q.SOURCE - 1], row[Q.POSITION_ID - 1], row[Q.FIELD - 1]);
      if (order.indexOf(key) === -1) {
        order.push(key);
      }
      batch[key] = row;
    });

    const appends = [];
    const updates = [];
    order.forEach(function (key) {
      const row = batch[key];
      const targetRow = byKey[key];
      if (targetRow) {
        updates.push({ row: targetRow, col: Q.DATE, value: row[Q.DATE - 1] });
        updates.push({ row: targetRow, col: Q.VALUE, value: row[Q.VALUE - 1] });
        updates.push({ row: targetRow, col: Q.USER, value: row[Q.USER - 1] });
        updates.push({ row: targetRow, col: Q.EDIT_ID, value: row[Q.EDIT_ID - 1] });
        updates.push({ row: targetRow, col: Q.STATUS, value: PENDING });
        updates.push({ row: targetRow, col: Q.PROCESSED_AT, value: "" });
        updates.push({ row: targetRow, col: Q.ERROR, value: "" });
      } else {
        appends.push(row);
      }
    });

    if (appends.length) {
      const startRow = sheet.getLastRow() + 1;   // вычисляется ПОД локом
      writeValues(sheet, startRow, 1, appends);
    }
    if (updates.length) {
      batchWrite(sheet, updates);
    }
    // Сбрасываем буфер записи ПОД локом: чтобы ПЕРЕКРЫВАЮЩЕЕСЯ исполнение
    // (следующий быстрый onEdit) гарантированно увидело только что записанные
    // строки и обновило их upsert-ом, а не добавило дубли.
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  v12UpdatePendingIndicator();
}

/**
 * Зафиксировать одно намерение.
 */
function v12EnqueuePendingEdit(sourceKey, positionId, field, value, actor) {
  v12EnqueuePendingRows([v12BuildPendingRow(sourceKey, positionId, field, value, actor)]);
}

/**
 * Быстрый путь onEdit для листов с чекбоксами.
 *
 * Возвращает:
 *   true  — правка ПОЛНОСТЬЮ обработана здесь (намерение зафиксировано
 *           либо правка откачена как запрещённая);
 *   false — это не наша правка (не чекбокс-колонка) — onEdit продолжит
 *           обычную логику.
 *
 * Обрабатываются:
 *   ОТБОРКА          — кол. CHECKBOX (12), поле HANDOFF, право PICKING_CHECKBOX;
 *   WORKING BOM      — кол. CHECKBOX (14), поле HANDOFF, право WORKING_BOM_CHECKBOX;
 *   Сводка дефицитов — кол. Заказано (9) / Ожидаемая поставка (10) /
 *                      Реальная поставка (12): поля ORDERED_QTY / EXPECTED_DATE /
 *                      REAL_DELIVERY (см. v12CaptureDeficitEdit, Вариант A).
 */
function v12CaptureCheckboxEdit(e, sheetName) {
  const S = V12_CONFIG.SHEETS;
  let column = 0;
  let action = "";
  let field = "";
  let sourceKey = "";
  let keyCol = 0;
  let exactColumnOnly = false;

  if (sheetName === S.PICKING) {
    column = V12_CONFIG.PICKING_COLUMNS.CHECKBOX;
    keyCol = V12_CONFIG.PICKING_COLUMNS.POSITION_ID;
    action = "PICKING_CHECKBOX";
    field = V12_CONFIG.PENDING_FIELD.HANDOFF;
    sourceKey = V12_CONFIG.SOURCE_UI.PICKING;
  } else if (sheetName === S.WORKING_BOM) {
    column = V12_CONFIG.WORKING_BOM_COLUMNS.CHECKBOX;
    keyCol = V12_CONFIG.WORKING_BOM_COLUMNS.POSITION_ID;
    action = "WORKING_BOM_CHECKBOX";
    field = V12_CONFIG.PENDING_FIELD.HANDOFF;
    sourceKey = V12_CONFIG.SOURCE_UI.WORKING_BOM;
  } else if (sheetName === S.DEFICIT_SUMMARY) {
    // Сводка — особый случай: содержит НЕСКОЛЬКО редактируемых колонок
    // («Заказано», «Ожидаемая поставка», «Реальная поставка»). Их обработка
    // вынесена в v12CaptureDeficitEdit (Вариант A) — возвращаем её результат.
    return v12CaptureDeficitEdit(e);
  } else {
    return false;
  }

  const range = e.range;
  const col = range.getColumn();
  const numCols = range.getNumColumns();
  const lastCol = col + numCols - 1;

  if (exactColumnOnly) {
    if (col !== column || lastCol !== column) {
      return false;
    }
  } else if (col > column || lastCol < column) {
    return false;
  }

  // Права проверяем на этапе захвата: onEdit исполняется от имени редактора
  // (в отличие от фонового триггера, где getCurrentUser() дал бы владельца).
  const role = v12GetCurrentUserRole();
  if (!v12CanEditField(role, action)) {
    v12RevertEdit(e);
    logSystem("v12CaptureCheckboxEdit",
      "Нет права '" + action + "' для роли '" + role + "' (" + v12CurrentActor() + ")", "WARNING");
    flushSystemLog();
    return true;
  }

  const sheet = range.getSheet();
  const firstRow = range.getRow();
  const numRows = range.getNumRows();
  const singleCell = (numRows === 1 && numCols === 1);
  // Значения берём из события (e.value/e.values) — снимок на момент правки.
  // Фиксируем СТРОГО строки этого события: каждое событие добавляет/обновляет
  // только свои ключи (upsert идемпотентен) — поэтому перекрывающиеся onEdit не
  // могут создать дубли. Пропущенные события (Google «глотает» всплески) тут же
  // восстанавливаются пересборкой очереди по галочкам — v12ReconcilePendingHandoffs.
  const values = singleCell
    ? [[e.value !== undefined ? e.value : range.getValue()]]
    : ((e.values && e.values.length === numRows) ? e.values : range.getValues());
  const localCol = singleCell ? 0 : (column - col);
  const actor = getCurrentUser();
  // Один Edit ID на весь захват (без RPC на каждую строку).
  const editIdBase = generateEventId();
  // Position ID строк диапазона читаем ОДНОЙ выборкой.
  const idColumn = sheet.getRange(firstRow, keyCol, numRows, 1).getValues();

  const pendingRows = [];
  for (let r = 0; r < numRows; r++) {
    const sheetRow = firstRow + r;
    if (sheetRow <= 1) {
      continue;   // строка заголовка (в т.ч. ячейка фильтра B1)
    }
    const rowValues = values[r];
    if (!rowValues || localCol < 0 || localCol >= rowValues.length) {
      continue;
    }
    const positionId = normalizeMaterialId(idColumn[r][0]);
    if (!positionId) {
      continue;
    }
    pendingRows.push(v12BuildPendingRow(sourceKey, positionId, field, rowValues[localCol], actor, editIdBase + "-" + (r + 1)));
  }

  if (pendingRows.length) {
    v12EnqueuePendingRows(pendingRows);
  }
  // САМОВОССТАНОВЛЕНИЕ очереди: пересобираем множество HANDOFF-намерений по
  // фактическому состоянию галочек — схлопываем возможные дубли и ДОБИРАЕМ
  // отмеченные позиции, по которым события onEdit были потеряны Google.
  // Благодаря этому лист PENDING_EDITS отражает ВСЕ отмеченные галочки СРАЗУ
  // (ещё до «Применить»), а не только те события, что успели «доехать».
  v12ReconcilePendingHandoffs();
  // Правка относится к чекбокс-колонке — считаем её обработанной здесь,
  // даже если строк без Position ID не оказалось.
  return true;
}

/**
 * Захват правки редактируемых колонок «Сводки дефицитов» (Вариант A).
 *
 * Редактируемые колонки Сводки, их поля и права:
 *   ORDERED_QTY  (9) — «Заказано»,          поле ORDERED_QTY,   право ORDERED_QTY;
 *   EXPECTED_DATE (10) — «Ожидаемая»,       поле EXPECTED_DATE, право EXPECTED_DATE;
 *   REAL_DELIVERY (12) — «Реальная поставка», поле REAL_DELIVERY, право REAL_DELIVERY.
 *
 * Диапазон МОЖЕТ охватывать несколько колонок (вставка/автозаполнение): по
 * каждой редактируемой колонке диапазона для каждой строки фиксируется своё
 * намерение. Колонки, которые роли править нельзя, не применяются.
 *
 * Возвращает true, если правка обработана здесь (намерения зафиксированы либо
 * правка откатана как запрещённая), иначе false — диапазон не затрагивает
 * редактируемых колонок Сводки (обрабатывается прежней логикой onEdit).
 */
function v12CaptureDeficitEdit(e) {
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const F = V12_CONFIG.PENDING_FIELD;
  const range = e.range;
  const col = range.getColumn();
  const numCols = range.getNumColumns();
  const numRows = range.getNumRows();
  const lastCol = col + numCols - 1;
  const singleCell = (numRows === 1 && numCols === 1);

  // Редактируемые колонки, которые задевает диапазон.
  const editable = [
    { col: D.ORDERED_QTY, field: F.ORDERED_QTY, action: "ORDERED_QTY" },
    { col: D.EXPECTED_DATE, field: F.EXPECTED_DATE, action: "EXPECTED_DATE" },
    { col: D.REAL_DELIVERY, field: F.REAL_DELIVERY, action: "REAL_DELIVERY" }
  ].filter(function (def) {
    return def.col >= col && def.col <= lastCol;
  });

  if (!editable.length) {
    // Диапазон не задевает редактируемых колонок. В Сводке руками править
    // больше нечего: одиночную ячейку откатываем, диапазон не трогаем.
    if (singleCell && range.getRow() > 1) {
      v12RevertEdit(e);
      logSystem("v12CaptureDeficitEdit",
        "В сводке доступны только Заказ/Ожидаемая/Реальная поставка", "WARNING");
      flushSystemLog();
      return true;
    }
    return false;
  }

  // Права проверяем на этапе захвата: onEdit исполняется от имени редактора
  // (в отличие от фонового триггера, где getCurrentUser() дал бы владельца).
  const role = v12GetCurrentUserRole();
  const allowed = editable.filter(function (def) {
    return v12CanEditField(role, def.action);
  });
  if (!allowed.length) {
    v12RevertEdit(e);
    logSystem("v12CaptureDeficitEdit",
      "Нет права на правку колонок сводки для роли '" + role + "' (" + v12CurrentActor() + ")", "WARNING");
    flushSystemLog();
    return true;
  }
  if (allowed.length !== editable.length) {
    // Часть колонок диапазона недоступна роли — откатить диапазон нельзя
    // (у события нет oldValue), поэтому фиксируем это в системном логе.
    logSystem("v12CaptureDeficitEdit",
      "Часть колонок диапазона недоступна роли '" + role + "' — они не применены", "WARNING");
  }

  const sheet = range.getSheet();
  const firstRow = range.getRow();
  // Снимок значений из события (e.value/e.values) — надёжнее живого чтения при
  // быстром вводе (пересборка проекции могла успеть перезаписать ячейку).
  const values = singleCell
    ? [[e.value !== undefined ? e.value : range.getValue()]]
    : ((e.values && e.values.length === numRows) ? e.values : range.getValues());
  const actor = getCurrentUser();
  // Один Edit ID на весь захват диапазона (без RPC на каждую строку).
  const editIdBase = generateEventId();
  // Position ID всех строк диапазона — одной выборкой.
  const idColumn = sheet.getRange(firstRow, D.POSITION_ID, numRows, 1).getValues();

  const pendingRows = [];
  for (let r = 0; r < numRows; r++) {
    const sheetRow = firstRow + r;
    if (sheetRow <= 1) {
      continue;   // строка заголовка
    }
    const positionId = normalizeMaterialId(idColumn[r][0]);
    if (!positionId) {
      continue;
    }
    const rowValues = values[r] || [];
    for (let d = 0; d < allowed.length; d++) {
      const def = allowed[d];
      const local = def.col - col;
      if (local < 0 || local >= rowValues.length) {
        continue;
      }
      pendingRows.push(v12BuildPendingRow(
        V12_CONFIG.SOURCE_UI.DEFICIT_SUMMARY, positionId, def.field, rowValues[local], actor,
        editIdBase + "-" + (r + 1) + "_" + (d + 1)));
    }
  }

  if (pendingRows.length) {
    v12EnqueuePendingRows(pendingRows);
  }
  return true;
}

/**
 * ====================================================
 * Обработка очереди (вызывается триггером)
 * ====================================================
 */

/**
 * Дешёвая проверка: есть ли необработанные намерения (без лока).
 */
function v12HasPendingEdits() {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PENDING_EDITS);
  if (!sheet) {
    return false;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const statuses = sheet.getRange(2, Q.STATUS, lastRow - 1, 1).getValues();
  const pending = V12_CONFIG.PENDING_STATUS.PENDING;
  for (let i = 0; i < statuses.length; i++) {
    if (String(statuses[i][0]).trim() === pending) {
      return true;
    }
  }
  return false;
}

/**
 * Число необработанных намерений (для диагностики).
 */
function v12CountPendingEdits() {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PENDING_EDITS);
  if (!sheet) {
    return 0;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const statuses = sheet.getRange(2, Q.STATUS, lastRow - 1, 1).getValues();
  const pending = V12_CONFIG.PENDING_STATUS.PENDING;
  let count = 0;
  for (let i = 0; i < statuses.length; i++) {
    if (String(statuses[i][0]).trim() === pending) {
      count++;
    }
  }
  return count;
}

/**
 * Ячейка-индикатор неприменённых изменений.
 *
 * Записывается в строку 1 «Сводки дефицитов» СПРАВА от таблицы: строку 1
 * пересборка проекций не трогает (clearBody очищает только строки 2+), поэтому
 * индикатор не конфликтует с заголовками и данными.
 *
 * Возвращает показанное число неприменённых намерений.
 */
function v12UpdatePendingIndicator(count) {
  const pending = (count === undefined || count === null) ? v12CountPendingEdits() : count;
  const sheet = getSheetByName(V12_CONFIG.SHEETS.DEFICIT_SUMMARY);
  if (!sheet) {
    return pending;
  }
  const col = V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY + 2;
  sheet.getRange(1, col).setValue(pending > 0
    ? "Неприменённых изменений: " + pending +
      " — кнопка «ПРИМЕНИТЬ» слева или меню «BOM CONTROL V12» → «Применить изменения»"
    : "");
  return pending;
}

/**
 * Номера строк листа со статусом PENDING.
 */
function v12CollectPendingRowNumbers(data) {
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const pending = V12_CONFIG.PENDING_STATUS.PENDING;
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][Q.STATUS - 1]).trim() === pending) {
      out.push(i + 1);
    }
  }
  return out;
}

/**
 * Разобрать строки очереди в намерения с правилом last-wins.
 * Возвращает массив { row, source, pid, field, value, user } в порядке
 * первого появления ключа (SOURCE|POSITION_ID|FIELD); значение — последнее.
 */
function v12ResolvePendingIntents(data) {
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const pending = V12_CONFIG.PENDING_STATUS.PENDING;
  const byKey = {};
  const order = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[Q.STATUS - 1]).trim() !== pending) {
      continue;
    }
    const pid = normalizeMaterialId(r[Q.POSITION_ID - 1]);
    if (!pid) {
      continue;
    }
    const source = String(r[Q.SOURCE - 1] || "").trim();
    const field = String(r[Q.FIELD - 1] || "").trim();
    const key = source + "|" + pid + "|" + field;
    if (!byKey[key]) {
      byKey[key] = { row: i + 1 };
      order.push(key);
    }
    byKey[key].row = i + 1;
    byKey[key].source = source;
    byKey[key].pid = pid;
    byKey[key].field = field;
    byKey[key].value = v12NormalizePendingValue(field, r[Q.VALUE - 1]);
    byKey[key].user = String(r[Q.USER - 1] || "").trim();
  }
  return order.map(function (k) { return byKey[k]; });
}

/**
 * Пометить обработанные строки очереди: DONE либо FAILED с причиной.
 */
function v12MarkPendingProcessed(pendingRowNumbers, failedByRow) {
  if (!pendingRowNumbers || !pendingRowNumbers.length) {
    return;
  }
  const sheet = v12GetSheetByKey("PENDING_EDITS");
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const ST = V12_CONFIG.PENDING_STATUS;
  const now = new Date();
  const writes = [];
  pendingRowNumbers.forEach(function (rowNum) {
    const reason = failedByRow[rowNum];
    writes.push({ row: rowNum, col: Q.STATUS, value: reason ? ST.FAILED : ST.DONE });
    writes.push({ row: rowNum, col: Q.PROCESSED_AT, value: now });
    if (reason) {
      writes.push({ row: rowNum, col: Q.ERROR, value: reason });
    }
  });
  batchWrite(sheet, writes);
}

/**
 * Удалить обработанные (DONE/FAILED) строки старше maxAgeDays.
 */
function v12PurgeDonePendingEdits(maxAgeDays) {
  const days = toNumber(maxAgeDays);
  if (days <= 0) {
    return 0;
  }
  const sheet = getSheetByName(V12_CONFIG.SHEETS.PENDING_EDITS);
  if (!sheet) {
    return 0;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const ST = V12_CONFIG.PENDING_STATUS;
  const data = readSheetValues(sheet);
  const cutoff = new Date().getTime() - days * 24 * 60 * 60 * 1000;
  const keep = [];
  let removed = 0;
  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][Q.STATUS - 1]).trim();
    const processed = data[i][Q.PROCESSED_AT - 1];
    const t = processed ? new Date(processed).getTime() : NaN;
    const isProcessed = (status === ST.DONE || status === ST.FAILED);
    if (isProcessed && !isNaN(t) && t < cutoff) {
      removed++;
      continue;
    }
    keep.push(data[i]);
  }
  if (!removed) {
    return 0;
  }
  const bodyRows = lastRow - 1;
  // Перезаписываем ТОЛЬКО сохраняемые строки, а хвост ниже них — чистим.
  // Так удаление одной строки не приводит к полной перезаписи всего тела листа.
  if (keep.length) {
    writeValues(sheet, 2, 1, keep);
  }
  const tailStart = 2 + keep.length;
  const tailRows = bodyRows - keep.length;
  if (tailRows > 0) {
    sheet.getRange(tailStart, 1, tailRows, V12_CONFIG.COLUMN_COUNT.PENDING_EDITS).clearContent();
  }
  return removed;
}

/**
 * Есть ли УСТАНОВЛЕННЫЕ галочки «Отметка получено» в ОТБОРКЕ / WORKING BOM.
 *
 * Дешёвый предфильтр для слива: если очередь пуста, но галочки стоят — слив
 * всё равно нужен (страховка от потерянных onEdit, см. v12ReconcileCheckedHandoffs).
 */
function v12HasCheckedHandoffs() {
  const targets = [
    { sheetKey: "PICKING", checkCol: V12_CONFIG.PICKING_COLUMNS.CHECKBOX },
    { sheetKey: "WORKING_BOM", checkCol: V12_CONFIG.WORKING_BOM_COLUMNS.CHECKBOX }
  ];
  for (let t = 0; t < targets.length; t++) {
    const sheet = getSheetByName(V12_CONFIG.SHEETS[targets[t].sheetKey]);
    if (!sheet) {
      continue;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    const checks = sheet.getRange(2, targets[t].checkCol, lastRow - 1, 1).getValues();
    for (let r = 0; r < checks.length; r++) {
      if (v12IsChecked(checks[r][0])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Реконсиляция: страховка от ПОТЕРЯННЫХ onEdit.
 *
 * Google может «проглотить» часть событий onEdit при массовой отметке, и тогда
 * в PENDING_EDITS строки для установленной галочки нет. Здесь читаются колонки
 * «Отметка получено» ОТБОРКИ и WORKING BOM; любая строка с УСТАНОВЛЕННОЙ
 * галочкой, для которой в очереди НЕТ ни одного намерения HANDOFF (по ключу
 * SOURCE|POSITION_ID), добавляется синтетическим намерением передачи.
 *
 * Инвариант: «галочка стоит ⇒ позиция будет передана». Применение идемпотентно
 * (v12MarkReceivedByProduction проверяет уже принятое), поэтому повтор не опасен.
 * Уже обработанные (DONE) строки очереди тоже считаются «есть» — повторно
 * галочку не переигрываем.
 *
 * Возвращает массив намерений в формате v12ResolvePendingIntents ({ row:0, ... }).
 */
function v12ReconcileCheckedHandoffs(queueData) {
  const F = V12_CONFIG.PENDING_FIELD.HANDOFF;
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;

  // Ключи source|positionId, по которым намерение HANDOFF уже есть в очереди.
  const have = {};
  const rows = queueData || [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[Q.FIELD - 1] || "").trim() !== F) {
      continue;
    }
    const pid = normalizeMaterialId(r[Q.POSITION_ID - 1]);
    if (!pid) {
      continue;
    }
    have[String(r[Q.SOURCE - 1] || "").trim() + "|" + pid] = true;
  }

  const out = [];
  const targets = [
    { sheetKey: "PICKING", source: V12_CONFIG.SOURCE_UI.PICKING,
      idCol: V12_CONFIG.PICKING_COLUMNS.POSITION_ID,
      checkCol: V12_CONFIG.PICKING_COLUMNS.CHECKBOX },
    { sheetKey: "WORKING_BOM", source: V12_CONFIG.SOURCE_UI.WORKING_BOM,
      idCol: V12_CONFIG.WORKING_BOM_COLUMNS.POSITION_ID,
      checkCol: V12_CONFIG.WORKING_BOM_COLUMNS.CHECKBOX }
  ];
  targets.forEach(function (t) {
    const sheet = getSheetByName(V12_CONFIG.SHEETS[t.sheetKey]);
    if (!sheet) {
      return;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return;
    }
    const ids = sheet.getRange(2, t.idCol, lastRow - 1, 1).getValues();
    const checks = sheet.getRange(2, t.checkCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const pid = normalizeMaterialId(ids[i][0]);
      if (!pid || !v12IsChecked(checks[i][0])) {
        continue;
      }
      const key = t.source + "|" + pid;
      if (have[key]) {
        continue;
      }
      have[key] = true;
      out.push({ row: 0, source: t.source, pid: pid, field: F, value: true, user: v12CurrentActor() });
    }
  });
  return out;
}

/**
 * Собрать список фактически отмеченных галочек передачи ({ source, pid }).
 * Источники: ОТБОРКА и WORKING BOM.
 */
function v12CollectCheckedHandoffs() {
  const out = [];
  const targets = [
    { sheetKey: "PICKING", source: V12_CONFIG.SOURCE_UI.PICKING,
      idCol: V12_CONFIG.PICKING_COLUMNS.POSITION_ID,
      checkCol: V12_CONFIG.PICKING_COLUMNS.CHECKBOX },
    { sheetKey: "WORKING_BOM", source: V12_CONFIG.SOURCE_UI.WORKING_BOM,
      idCol: V12_CONFIG.WORKING_BOM_COLUMNS.POSITION_ID,
      checkCol: V12_CONFIG.WORKING_BOM_COLUMNS.CHECKBOX }
  ];
  targets.forEach(function (t) {
    const sheet = getSheetByName(V12_CONFIG.SHEETS[t.sheetKey]);
    if (!sheet) {
      return;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return;
    }
    const ids = sheet.getRange(2, t.idCol, lastRow - 1, 1).getValues();
    const checks = sheet.getRange(2, t.checkCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const pid = normalizeMaterialId(ids[i][0]);
      if (!pid || !v12IsChecked(checks[i][0])) {
        continue;
      }
      out.push({ source: t.source, pid: pid });
    }
  });
  return out;
}

/**
 * ИДЕМПОТЕНТНАЯ ПЕРЕСБОРКА очереди намерений HANDOFF по фактическим галочкам.
 *
 * Приводит множество PENDING-намерений HANDOFF к каноническому виду:
 *   - по каждому ключу SOURCE|POSITION_ID|FIELD оставляет РОВНО ОДНУ строку
 *     (лишние дубли помечаются DONE) — устраняет «задваивание»;
 *   - отмеченные галочки, для которых PENDING-строки нет, ДОБАВЛЯЮТСЯ —
 *     устраняет «пропажу» потерянных onEdit.
 *
 * НЕ отменяет существующие намерения: очередь авторитетна (снятие галочки
 * фиксируется точным захватом значением false). Функция только схлопывает
 * дубли и добирает отмеченные, поэтому её безопасно звать многократно.
 * Намерения других полей (Заказано/Ожидаемая/Реальная поставка) не трогаются.
 *
 * Возвращает число добавленных строк.
 */
function v12RebuildPendingFromChecked() {
  const sheet = v12GetSheetByKey("PENDING_EDITS");
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const ST = V12_CONFIG.PENDING_STATUS;
  const F = V12_CONFIG.PENDING_FIELD.HANDOFF;

  // Желаемое множество HANDOFF-намерений по фактически отмеченным галочкам.
  const desired = {};
  v12CollectCheckedHandoffs().forEach(function (c) {
    desired[c.source + "|" + c.pid + "|" + F] = c;
  });

  const data = readSheetValues(sheet);
  const writes = [];
  const keepRow = {};
  const seen = {};
  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[Q.STATUS - 1]).trim() !== ST.PENDING) {
      continue;
    }
    const pid = normalizeMaterialId(r[Q.POSITION_ID - 1]);
    if (!pid) {
      continue;
    }
    const source = String(r[Q.SOURCE - 1] || "").trim();
    const field = String(r[Q.FIELD - 1] || "").trim();
    const key = source + "|" + pid + "|" + field;
    const rowNum = i + 1;
    if (seen[key]) {
      // Дубль: предыдущую оставляем недействительной, оставляем последнюю.
      writes.push({ row: keepRow[key], col: Q.STATUS, value: ST.DONE });
      writes.push({ row: keepRow[key], col: Q.PROCESSED_AT, value: now });
      writes.push({ row: keepRow[key], col: Q.ERROR, value: "дубль (схлопнуто пересборкой)" });
    }
    seen[key] = true;
    keepRow[key] = rowNum;
  }

  const appends = [];
  const actor = v12CurrentActor();
  // Один Edit ID-база на всю пересборку; генерируется ЛЕНИВО — только когда
  // реально есть что добавлять (иначе лишний RPC Utilities.getUuid() на пачке
  // без потерянных галочек).
  let editIdBase = "";
  Object.keys(desired).forEach(function (key) {
    if (seen[key]) {
      return;
    }
    const c = desired[key];
    if (!editIdBase) {
      editIdBase = generateEventId();
    }
    appends.push(v12BuildPendingRow(c.source, c.pid, F, true, actor,
      editIdBase + "-rb" + (appends.length + 1)));
  });

  if (writes.length) {
    batchWrite(sheet, writes);
  }
  if (appends.length) {
    writeValues(sheet, sheet.getLastRow() + 1, 1, appends);
  }
  if (writes.length || appends.length) {
    SpreadsheetApp.flush();
  }
  return appends.length;
}

/**
 * Идемпотентная ПЕРЕСБОРКА очереди HANDOFF по фактическим галочкам — ПОД ЛОКОМ.
 *
 * Вызывается из захвата правки чекбокса (после фиксации строк события), чтобы
 * лист очереди САМОВОССТАНАВЛИВАЛСЯ: если Google «проглотил» часть событий при
 * массовой отметке, любое следующее доехавшее событие пересобирает множество
 * HANDOFF-намерений по фактическому состоянию галочек — добирает отмеченные без
 * строки и схлопывает дубли. Так PENDING_EDITS отражает ВСЕ отмеченные позиции
 * ещё ДО «Применить», а не только пришедшие события.
 *
 * Возвращает число добавленных строк или null, если лок занят (пересборка
 * отложена — намерения не теряются, их добьёт следующее событие или Apply).
 */
function v12ReconcilePendingHandoffs() {
  const lock = acquireScriptLock({ tryOnly: true, timeoutMs: 10000 });
  if (!lock) {
    logSystem("v12ReconcilePendingHandoffs",
      "Очередь занята (идёт применение/синхронизация) — пересборка отложена", "WARNING");
    flushSystemLog();
    return null;
  }
  try {
    return v12RebuildPendingFromChecked();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Применить одно намерение очереди к состоянию позиции (пакетно).
 *
 * Расчёт, аудит, историю и складские дельты выполняют ОПЕРАЦИИ снабжения
 * (v12_operations.js) — очередь их только вызывает, передавая общий ctx, чтобы
 * записи копились, а проекции пересобирались ОДИН раз на всю пачку намерений.
 *
 * Возвращает { status: "applied" | "already" | "blocked", reason? }.
 */
function v12ApplyPendingIntent(intent, ctx, posIndex) {
  const F = V12_CONFIG.PENDING_FIELD;
  if (intent.field === F.HANDOFF) {
    return v12MarkReceivedByProduction(intent.pid, intent.source, true, ctx);
  }
  if (intent.field === F.REAL_DELIVERY) {
    return v12ApplyRealDeliveryIntent(intent.pid, ctx, posIndex);
  }
  if (intent.field === F.ORDERED_QTY) {
    return v12SetOrderedQty(intent.pid, intent.value, posIndex, ctx);
  }
  if (intent.field === F.EXPECTED_DATE) {
    return v12SetExpectedDate(intent.pid, intent.value, posIndex, ctx);
  }
  return { status: "blocked", reason: "Неизвестное поле намерения: " + intent.field };
}

/**
 * Чекбокс «Реальная поставка» = «материал пришёл полностью».
 *
 * Поставка фиксируется только «вверх»: снятие отметки ничего не отменяет — это
 * защищает уже зафиксированный приход от случайного стирания. Расчёт и запись
 * выполняет операция v12SetRealDeliveryQty (позиция -> приход = требуется).
 */
function v12ApplyRealDeliveryIntent(positionId, ctx, posIndex) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const index = posIndex || (ctx && ctx.index) || v12BuildPositionIndex();
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    return { status: "blocked", reason: "Позиция не найдена" };
  }
  const required = toNumber(pos.values[P.REQUIRED_QTY - 1]);
  const currentReal = toNumber(pos.values[P.REAL_DELIVERY_QTY - 1]);
  if (required <= 0 || currentReal >= required) {
    return { status: "already" };
  }
  return v12SetRealDeliveryQty(positionId, required, index, ctx);
}

/**
 * Основной слив очереди. Применяет все PENDING-намерения пакетно, одним
 * пересчётом проекций, и помечает строки обработанными.
 */
function v12DrainPendingEdits() {
  // Предфильтр: есть очередь ИЛИ стоят галочки передачи, не попавшие в очередь
  // (страховка от потерянных onEdit — см. v12ReconcileCheckedHandoffs).
  if (!v12HasPendingEdits() && !v12HasCheckedHandoffs()) {
    return { drained: 0 };
  }

  const lock = acquireScriptLock({ tryOnly: true, timeoutMs: 5000 });
  if (!lock) {
    logSystem("v12DrainPendingEdits", "Лок занят — слив отложен до следующего запуска", "WARNING");
    return { drained: 0, skipped: true };
  }
  try {
    // Приводим очередь к каноническому виду по фактическим галочкам: схлопываем
    // дубли по ключу и добираем отмеченные без строки. Так слив детерминирован —
    // ни дублей, ни потерь — независимо от того, сколько событий onEdit доехало.
    v12RebuildPendingFromChecked();

    const sheet = v12GetSheetByKey("PENDING_EDITS");
    const data = readSheetValues(sheet);
    const pendingRows = v12CollectPendingRowNumbers(data);

    const intents = v12ResolvePendingIntents(data);
    if (!intents.length) {
      return { drained: 0 };
    }
    const posIndex = v12BuildPositionIndex();
    const materialIndex = v12BuildMaterialIndex();
    // Пакетный контекст. Кроме накопления записей POSITION_STATE и складских
    // дельт он несёт батч-буферы логов (ARCHIVE / MATERIAL_HISTORY / EVENT_LOG),
    // ЗАРАНЕЕ построенный индекс истории (ОДНО чтение MATERIAL_HISTORY вместо
    // чтения листа на каждую позицию — устранение O(N·M)) и один operationId на
    // всю пачку (без RPC Utilities.getUuid() на позицию).
    const ctx = {
      index: posIndex,
      materialIndex: materialIndex,
      warehouseDelta: {},
      positionWrites: [],
      historyIndex: v12BuildPositionHistoryIndex(),
      archiveRows: [],
      historyRows: [],
      eventRows: [],
      operationId: generateEventId()
    };
    const failed = {};
    let applied = 0;

    intents.forEach(function (it) {
      // Отмена (last-wins) относится ТОЛЬКО к чекбокс-полям: для них value=false
      // означает «ничего не делать». Для типизированных полей (Заказано=0,
      // Очистка даты) значение применяется как есть — это не отмена.
      if (v12IsBooleanPendingField(it.field) && !it.value) {
        return;
      }
      v12WithActor(it.user, function () {
        try {
          const res = v12ApplyPendingIntent(it, ctx, posIndex);
          if (res && res.status === "blocked") {
            // it.row = 0 у синтетических (реконсилированных) намерений — их
            // некуда пометить в очереди, поэтому в failed не пишем.
            if (it.row) {
              failed[it.row] = res.reason || "заблокировано";
            }
          } else {
            applied++;
          }
        } catch (err) {
          failed[it.row] = err.message;
          logSystem("v12DrainPendingEdits", err.message, err, "ERROR");
        }
      });
    });

    // Складские дельты (передача + реальная поставка) — одним батчем.
    if (Object.keys(ctx.warehouseDelta).length) {
      v12ApplyWarehouseDeltas(ctx.warehouseDelta, materialIndex, ctx);
    }
    // Записи POSITION_STATE (реальная поставка / заказ / ожидаемая дата /
    // передача производству) — одним умным батчем (блок для плотных пачек,
    // «отрезки» для разреженных).
    if (ctx.positionWrites.length) {
      v12WritePositionBatch(ctx.positionWrites);
    }
    // Буферизованные логи пачки — по одному writeValues на лист (вместо
    // appendRow на каждую позицию).
    v12FlushRowBuffer("ARCHIVE", ctx.archiveRows);
    v12FlushRowBuffer("MATERIAL_HISTORY", ctx.historyRows);
    v12FlushRowBuffer("EVENT_LOG", ctx.eventRows);

    // ОДИН пересчёт всех проекций на всю пачку.
    SpreadsheetApp.flush();
    v12RefreshProjections();

    // Пометить обработанные (и снять с очереди логически).
    v12MarkPendingProcessed(pendingRows, failed);

    // Очистка старых обработанных строк.
    v12PurgeDonePendingEdits(V12_CONFIG.SETTINGS.QUEUE_PURGE_DONE_DAYS);

    // Пачка применена — индикатор неприменённых изменений сбрасывается.
    v12UpdatePendingIndicator(0);

    return { drained: applied, failed: Object.keys(failed).length };
  } catch (error) {
    logSystem("v12DrainPendingEdits", error.message, error, "ERROR");
    return { drained: 0, error: error.message };
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * ПРИМЕНИТЬ ИЗМЕНЕНИЯ (V3) — основная точка входа модели «Применить».
 *
 * Вызывается пользователем кнопкой «ПРИМЕНИТЬ» на листе (v12ApplyChangesUI)
 * либо из меню «Применить изменения». Применяет все накопленные намерения
 * из PENDING_EDITS пакетно, одним пересчётом проекций,
 * и возвращает сводку { drained, failed }.
 *
 * Автоприменения (инлайн-слива из onEdit) и фонового минутного триггера НЕТ:
 * пересборка проекций происходит ТОЛЬКО здесь (или в полной синхронизации).
 * Это исключает конкуренцию пользовательского ввода и пересборки проекции —
 * первопричину «сброса введённых значений».
 */
function v12ApplyChanges() {
  let result;
  try {
    result = v12DrainPendingEdits();
  } catch (e) {
    logSystem("v12ApplyChanges", e.message, e, "ERROR");
    result = { drained: 0, error: e.message };
  } finally {
    v12FlushAudit();
    flushSystemLog();
  }
  return result;
}

/**
 * Совместимый алиас: исторические (уже установленные) триггеры и внешний код
 * могли ссылаться на это имя — оставляем, чтобы ничего не падало. Никакого
 * таймера за ним больше нет: применение — только по кнопке (v12ApplyChanges).
 */
function v12ScheduledQueueDrain() {
  return v12ApplyChanges();
}
