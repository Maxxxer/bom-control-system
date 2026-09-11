/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_queue.js
 *
 * Очередь правок чекбоксов (Вариант D).
 *
 * ПРОБЛЕМА. onEdit для чекбоксов ОТБОРКИ / WORKING BOM / Сводки выполнял
 * тяжёлую работу (передача производству + полный пересчёт 5 проекций),
 * удерживая ОБЩЕСКРИПТОВУЮ блокировку. При быстрой отметке вторая и
 * последующие правки не успевали взять лок и всплывало окно
 * «Система занята обновлением», а галочка ещё и СНИМАЛАСЬ (v12RevertEdit).
 *
 * РЕШЕНИЕ. onEdit только ФИКСИРУЕТ НАМЕРЕНИЕ строкой в листе PENDING_EDITS
 * (быстро, без лока), а применение делает фоновый триггер
 * v12ScheduledQueueDrain (раз в минуту) — пакетно, одним пересчётом
 * проекций. Очередь авторитетна: отметка не теряется даже если пересборка
 * проекции перезапишет колонку чекбоксов значением false.
 *
 * ПРАВИЛА.
 *   - last-wins по (SOURCE, POSITION_ID): решает последняя строка;
 *     VALUE=false -> отмена (передача не выполняется);
 *   - применение идемпотентно (v12MarkReceivedByProduction; реальная поставка
 *     увеличивается только «вверх», как в v12HarvestDeficitInput);
 *   - «кто сделал» берётся из строки очереди (time-driven триггер исполняется
 *     от имени владельца — без актор-контекста аудит был бы неверным).
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
function v12BuildPendingRow(sourceKey, positionId, field, value, actor) {
  const Q = V12_CONFIG.PENDING_EDIT_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.PENDING_EDITS).fill("");
  row[Q.DATE - 1] = new Date();
  row[Q.EDIT_ID - 1] = generateEventId();
  row[Q.SOURCE - 1] = sourceKey;
  row[Q.POSITION_ID - 1] = normalizeMaterialId(positionId);
  row[Q.FIELD - 1] = field;
  row[Q.VALUE - 1] = v12NormalizePendingValue(field, value);
  row[Q.USER - 1] = actor || v12CurrentActor();
  row[Q.STATUS - 1] = V12_CONFIG.PENDING_STATUS.PENDING;
  return row;
}

/**
 * Записать пачку строк очереди одним вызовом.
 */
function v12EnqueuePendingRows(rowArrays) {
  if (!rowArrays || !rowArrays.length) {
    return;
  }
  const sheet = v12GetSheetByKey("PENDING_EDITS");
  const startRow = sheet.getLastRow() + 1;
  writeValues(sheet, startRow, 1, rowArrays);
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
  // Для одиночной ячейки берём значение из события (e.value) — это снимок на
  // момент правки; getValues() для 1x1 не требуется. Для диапазона — e.values
  // либо живое чтение диапазона.
  const values = singleCell
    ? [[e.value !== undefined ? e.value : range.getValue()]]
    : ((e.values && e.values.length === numRows) ? e.values : range.getValues());
  const localCol = singleCell ? 0 : (column - col);
  const actor = getCurrentUser();
  // Position ID всех строк читаем ОДНОЙ выборкой (а не по ячейке в цикле).
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
    pendingRows.push(v12BuildPendingRow(sourceKey, positionId, field, rowValues[localCol], actor));
  }

  if (pendingRows.length) {
    v12EnqueuePendingRows(pendingRows);
  }
  // Правка относится к чекбокс-колонке — считаем её обработанной здесь,
  // даже если строк без Position ID не оказалось.
  return true;
}

/**
 * Захват правки редактируемой колонки «Сводки дефицитов» (Вариант A).
 *
 * Обрабатываются три колонки Сводки:
 *   ORDERED_QTY (9)   — «Заказано»,        поле ORDERED_QTY,   право ORDERED_QTY;
 *   EXPECTED_DATE (10)— «Ожидаемая»,       поле EXPECTED_DATE, право EXPECTED_DATE;
 *   REAL_DELIVERY (12)— «Реальная поставка», поле REAL_DELIVERY, право REAL_DELIVERY.
 *
 * Диапазон должен лежать ЦЕЛИКОМ в одной из этих колонок (одиночная ячейка,
 * вертикальная вставка/автозаполнение). Смешанный диапазон (несколько колонок)
 * не перехватывается — его обрабатывает прежняя логика onEdit
 * (v12HandleDeficitRangeEdit), чтобы не потерять ввод.
 *
 * Возвращает true, если правка обработана здесь (намерение зафиксировано либо
 * откатана как запрещённая), иначе false.
 */
function v12CaptureDeficitEdit(e) {
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const F = V12_CONFIG.PENDING_FIELD;
  const range = e.range;
  const col = range.getColumn();
  const numCols = range.getNumColumns();
  const lastCol = col + numCols - 1;

  // Определяем поле/право по колонке. Только диапазон в пределах ОДНОЙ
  // редактируемой колонки Сводки.
  let field = "";
  let action = "";
  if (col === D.ORDERED_QTY && lastCol === D.ORDERED_QTY) {
    field = F.ORDERED_QTY;
    action = "ORDERED_QTY";
  } else if (col === D.EXPECTED_DATE && lastCol === D.EXPECTED_DATE) {
    field = F.EXPECTED_DATE;
    action = "EXPECTED_DATE";
  } else if (col === D.REAL_DELIVERY && lastCol === D.REAL_DELIVERY) {
    field = F.REAL_DELIVERY;
    action = "REAL_DELIVERY";
  } else {
    return false;   // не наша колонка / смешанный диапазон — прежняя логика
  }

  // Права проверяем на этапе захвата: onEdit исполняется от имени редактора
  // (в отличие от фонового триггера, где getCurrentUser() дал бы владельца).
  const role = v12GetCurrentUserRole();
  if (!v12CanEditField(role, action)) {
    v12RevertEdit(e);
    logSystem("v12CaptureDeficitEdit",
      "Нет права '" + action + "' для роли '" + role + "' (" + v12CurrentActor() + ")", "WARNING");
    flushSystemLog();
    return true;
  }

  const sheet = range.getSheet();
  const firstRow = range.getRow();
  const numRows = range.getNumRows();
  const singleCell = (numRows === 1 && numCols === 1);
  // Снимок значений из события (e.value/e.values) — надёжнее живого чтения при
  // быстром вводе (пересборка проекции могла успеть перезаписать ячейку).
  const values = singleCell
    ? [[e.value !== undefined ? e.value : range.getValue()]]
    : ((e.values && e.values.length === numRows) ? e.values : range.getValues());
  const actor = getCurrentUser();
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
    const rawValue = (values[r] && values[r].length) ? values[r][0] : "";
    pendingRows.push(v12BuildPendingRow(V12_CONFIG.SOURCE_UI.DEFICIT_SUMMARY, positionId, field, rawValue, actor));
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
 * Применить намерение «Реальная поставка» (полная поставка) пакетно.
 *
 * Повторяет семантику v12HarvestDeficitInput для одной позиции, но без
 * чтения листа Сводки (намерение уже в очереди). Записи копятся в
 * ctx.positionWrites, складская дельта — в ctx.warehouseDelta.
 * Возвращает { status: "applied" | "already" | "blocked", reason? }.
 */
function v12ApplyRealDeliveryIntent(positionId, ctx, posIndex) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const index = posIndex || (ctx && ctx.index) || v12BuildPositionIndex();
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    return { status: "blocked", reason: "Позиция не найдена" };
  }

  const row = pos.values;
  const required = toNumber(row[P.REQUIRED_QTY - 1]);
  const currentReal = toNumber(row[P.REAL_DELIVERY_QTY - 1]);
  if (required <= 0 || currentReal >= required) {
    return { status: "already" };
  }

  const rowVals = row.slice();
  rowVals[P.REAL_DELIVERY_QTY - 1] = required;
  if (!rowVals[P.REAL_DELIVERY_DATE - 1]) {
    rowVals[P.REAL_DELIVERY_DATE - 1] = new Date();
  }
  v12ApplyComputedToRow(rowVals);
  const delta = required - currentReal;

  const materialKey = v12BuildMaterialKey({
    code: rowVals[P.MATERIAL_CODE - 1],
    name: rowVals[P.MATERIAL_NAME - 1],
    model: rowVals[P.MODEL - 1],
    unit: rowVals[P.UNIT - 1]
  });

  const writes = (ctx && ctx.positionWrites) || [];
  writes.push({ row: pos.row, col: P.REAL_DELIVERY_QTY, value: rowVals[P.REAL_DELIVERY_QTY - 1] });
  writes.push({ row: pos.row, col: P.REAL_DELIVERY_DATE, value: rowVals[P.REAL_DELIVERY_DATE - 1] });
  writes.push({ row: pos.row, col: P.SUPPLY_STATE, value: rowVals[P.SUPPLY_STATE - 1] });
  writes.push({ row: pos.row, col: P.PRODUCTION_STATE, value: rowVals[P.PRODUCTION_STATE - 1] });
  writes.push({ row: pos.row, col: P.DEFICIT_QTY, value: rowVals[P.DEFICIT_QTY - 1] });
  writes.push({ row: pos.row, col: P.UNCOVERED_NEED, value: rowVals[P.UNCOVERED_NEED - 1] });
  writes.push({ row: pos.row, col: P.OVER_ORDERED_QTY, value: rowVals[P.OVER_ORDERED_QTY - 1] });
  writes.push({ row: pos.row, col: P.SHORT_DELIVERY_QTY, value: rowVals[P.SHORT_DELIVERY_QTY - 1] });
  writes.push({ row: pos.row, col: P.AVAILABLE_FOR_PRODUCTION, value: rowVals[P.AVAILABLE_FOR_PRODUCTION - 1] });
  writes.push({ row: pos.row, col: P.FLAGS, value: rowVals[P.FLAGS - 1] });
  writes.push({ row: pos.row, col: P.UPDATED_AT, value: new Date() });

  // Обновляем in-memory строку индекса (защита от повторной обработки в пачке).
  row[P.REAL_DELIVERY_QTY - 1] = required;
  row[P.REAL_DELIVERY_DATE - 1] = rowVals[P.REAL_DELIVERY_DATE - 1];

  if (ctx) {
    ctx.warehouseDelta[materialKey] = (ctx.warehouseDelta[materialKey] || 0) + delta;
  } else {
    v12AdjustWarehouseQty(materialKey, delta);
  }

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.REAL_DELIVERY_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "REAL_DELIVERY_QTY",
    oldValue: currentReal,
    newValue: required
  });
  v12LogHistory(positionId, "REAL_DELIVERY_QTY", currentReal, required);

  return { status: "applied" };
}

/**
 * Применить намерение «Заказано» (ORDERED_QTY) пакетно.
 *
 * Повторяет семантику v12SetOrderedQty (расчёт + аудит + история + событие),
 * но БЕЗ немедленной перезаписи Сводки/СНАБЖЕНИЯ/Dashboard — записи копятся в
 * ctx.positionWrites, а проекции пересчитываются ОДИН раз в конце слива.
 * Возвращает { status: "applied" | "already" | "blocked", reason? }.
 */
function v12ApplyOrderedIntent(positionId, value, ctx, posIndex) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  // Право проверяем от имени автора правки (актор-контекст слива).
  v12RequireRole(v12GetCurrentUserRole(), "ORDERED_QTY");

  const index = posIndex || (ctx && ctx.index) || v12BuildPositionIndex();
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    return { status: "blocked", reason: "Позиция не найдена" };
  }

  const row = pos.values;
  const newQty = Math.max(0, toNumber(value));
  const oldQty = toNumber(row[P.ORDERED_QTY - 1]);
  if (oldQty === newQty) {
    return { status: "already" };
  }

  const rowVals = row.slice();
  rowVals[P.ORDERED_QTY - 1] = newQty;
  v12ApplyComputedToRow(rowVals);

  const writes = (ctx && ctx.positionWrites) || [];
  writes.push({ row: pos.row, col: P.ORDERED_QTY, value: rowVals[P.ORDERED_QTY - 1] });
  writes.push({ row: pos.row, col: P.SUPPLY_STATE, value: rowVals[P.SUPPLY_STATE - 1] });
  writes.push({ row: pos.row, col: P.PRODUCTION_STATE, value: rowVals[P.PRODUCTION_STATE - 1] });
  writes.push({ row: pos.row, col: P.DEFICIT_QTY, value: rowVals[P.DEFICIT_QTY - 1] });
  writes.push({ row: pos.row, col: P.UNCOVERED_NEED, value: rowVals[P.UNCOVERED_NEED - 1] });
  writes.push({ row: pos.row, col: P.OVER_ORDERED_QTY, value: rowVals[P.OVER_ORDERED_QTY - 1] });
  writes.push({ row: pos.row, col: P.SHORT_DELIVERY_QTY, value: rowVals[P.SHORT_DELIVERY_QTY - 1] });
  writes.push({ row: pos.row, col: P.AVAILABLE_FOR_PRODUCTION, value: rowVals[P.AVAILABLE_FOR_PRODUCTION - 1] });
  writes.push({ row: pos.row, col: P.FLAGS, value: rowVals[P.FLAGS - 1] });
  writes.push({ row: pos.row, col: P.UPDATED_AT, value: new Date() });

  // Синхронизируем in-memory строку индекса целиком (защита от повторной
  // обработки в пачке: последующие намерения по этой позиции увидят новое).
  for (let c = 0; c < rowVals.length; c++) {
    row[c] = rowVals[c];
  }

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.ORDERED_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "ORDERED_QTY",
    oldValue: oldQty,
    newValue: newQty
  });
  v12LogHistory(positionId, "ORDERED_QTY", oldQty, newQty);
  v12LogEvent(V12_CONFIG.AUDIT_ACTIONS.ORDERED_CHANGED, positionId, row[P.BOM_ID - 1],
    { oldValue: oldQty, newValue: newQty });

  return { status: "applied" };
}

/**
 * Применить намерение «Ожидаемая поставка» (EXPECTED_DATE) пакетно.
 *
 * Повторяет семантику v12SetExpectedDate (нормализация даты + аудит + история),
 * но записи копятся в ctx.positionWrites (проекции — один раз в конце слива).
 * Возвращает { status: "applied" | "already" | "blocked", reason? }.
 */
function v12ApplyExpectedDateIntent(positionId, value, ctx, posIndex) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  v12RequireRole(v12GetCurrentUserRole(), "EXPECTED_DATE");

  const index = posIndex || (ctx && ctx.index) || v12BuildPositionIndex();
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    return { status: "blocked", reason: "Позиция не найдена" };
  }

  const row = pos.values;
  const oldDate = row[P.EXPECTED_DATE - 1] || "";
  const newDate = v12ToDate(value);
  if (v12DateValue(oldDate) === v12DateValue(newDate)) {
    return { status: "already" };
  }

  const writes = (ctx && ctx.positionWrites) || [];
  writes.push({ row: pos.row, col: P.EXPECTED_DATE, value: newDate ? newDate : "" });
  writes.push({ row: pos.row, col: P.UPDATED_AT, value: new Date() });

  row[P.EXPECTED_DATE - 1] = newDate ? newDate : "";

  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.EXPECTED_DATE_CHANGED,
    bomId: row[P.BOM_ID - 1],
    positionId: positionId,
    field: "EXPECTED_DATE",
    oldValue: oldDate,
    newValue: newDate ? newDate.getTime() : ""
  });
  v12LogHistory(positionId, "EXPECTED_DATE", oldDate, newDate ? newDate.getTime() : "");

  return { status: "applied" };
}

/**
 * Основной слив очереди. Применяет все PENDING-намерения пакетно, одним
 * пересчётом проекций, и помечает строки обработанными.
 */
function v12DrainPendingEdits() {
  if (!v12HasPendingEdits()) {
    return { drained: 0 };
  }

  const lock = acquireScriptLock({ tryOnly: true, timeoutMs: 5000 });
  if (!lock) {
    logSystem("v12DrainPendingEdits", "Лок занят — слив отложен до следующего запуска", "WARNING");
    return { drained: 0, skipped: true };
  }
  try {
    const sheet = v12GetSheetByKey("PENDING_EDITS");
    const data = readSheetValues(sheet);
    const pendingRows = v12CollectPendingRowNumbers(data);
    if (!pendingRows.length) {
      return { drained: 0 };
    }

    const intents = v12ResolvePendingIntents(data);
    const posIndex = v12BuildPositionIndex();
    const materialIndex = v12BuildMaterialIndex();
    const ctx = {
      index: posIndex,
      materialIndex: materialIndex,
      warehouseDelta: {},
      positionWrites: []
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
          let res = null;
          if (it.field === V12_CONFIG.PENDING_FIELD.HANDOFF) {
            res = v12MarkReceivedByProduction(it.pid, it.source, true, ctx);
          } else if (it.field === V12_CONFIG.PENDING_FIELD.REAL_DELIVERY) {
            res = v12ApplyRealDeliveryIntent(it.pid, ctx, posIndex);
          } else if (it.field === V12_CONFIG.PENDING_FIELD.ORDERED_QTY) {
            res = v12ApplyOrderedIntent(it.pid, it.value, ctx, posIndex);
          } else if (it.field === V12_CONFIG.PENDING_FIELD.EXPECTED_DATE) {
            res = v12ApplyExpectedDateIntent(it.pid, it.value, ctx, posIndex);
          }
          if (res && res.status === "blocked") {
            failed[it.row] = res.reason || "заблокировано";
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
      v12ApplyWarehouseDeltas(ctx.warehouseDelta, materialIndex);
    }
    // Записи POSITION_STATE (реальная поставка / заказ / ожидаемая дата) —
    // одним батчем.
    if (ctx.positionWrites.length) {
      batchWrite(v12GetSheetByKey("POSITION_STATE"), ctx.positionWrites);
    }

    // ОДИН пересчёт всех проекций на всю пачку.
    SpreadsheetApp.flush();
    v12RefreshProjections();

    // Пометить обработанные (и снять с очереди логически).
    v12MarkPendingProcessed(pendingRows, failed);

    // Очистка старых обработанных строк.
    v12PurgeDonePendingEdits(V12_CONFIG.SETTINGS.QUEUE_PURGE_DONE_DAYS);

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
 * Обёртка для фонового триггера (раз в минуту).
 */
function v12ScheduledQueueDrain() {
  try {
    v12DrainPendingEdits();
  } catch (e) {
    logSystem("v12ScheduledQueueDrain", e.message, e, "ERROR");
  } finally {
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * Попытаться применить очередь немедленно (вызывается из onEdit сразу после
 * захвата намерения). Если лок свободен — слив выполняется «на горячую»
 * (отметка применяется сразу); если занят — просто выходим, слив сделает
 * минутный триггер. Ошибки не пробрасываются (чтобы не сломать onEdit).
 */
function v12TryInlineDrain() {
  if (!V12_CONFIG.SETTINGS.QUEUE_INLINE_DRAIN) {
    return;
  }
  const lock = acquireScriptLock({ tryOnly: true, timeoutMs: 0 });
  if (!lock) {
    return;
  }
  try {
    v12DrainPendingEdits();
  } catch (e) {
    logSystem("v12TryInlineDrain", e.message, e, "ERROR");
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}
