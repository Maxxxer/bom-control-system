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
  row[Q.VALUE - 1] = v12IsChecked(value);
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
 *   ОТБОРКА          — кол. CHECKBOX (12),     поле HANDOFF,       право PICKING_CHECKBOX;
 *   WORKING BOM      — кол. CHECKBOX (14),     поле HANDOFF,       право WORKING_BOM_CHECKBOX;
 *   Сводка дефицитов — кол. REAL_DELIVERY (12), поле REAL_DELIVERY, право REAL_DELIVERY.
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
    column = V12_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY;
    keyCol = V12_CONFIG.DEFICIT_COLUMNS.POSITION_ID;
    action = "REAL_DELIVERY";
    field = V12_CONFIG.PENDING_FIELD.REAL_DELIVERY;
    sourceKey = V12_CONFIG.SOURCE_UI.DEFICIT_SUMMARY;
    // В Сводке есть и другие редактируемые колонки («Заказано», «Ожидаемая»),
    // поэтому перехватываем ТОЛЬКО диапазон, целиком лежащий в колонке чекбокса
    // (клик или вертикальная вставка галочек). Прочие диапазоны отдаём прежней
    // логике (v12HandleDeficitRangeEdit), чтобы не потерять ввод заказа/даты.
    exactColumnOnly = true;
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
    byKey[key].value = v12IsChecked(r[Q.VALUE - 1]);
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
 * ctx.realDeliveryWrites, складская дельта — в ctx.warehouseDelta.
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

  const writes = (ctx && ctx.realDeliveryWrites) || [];
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
      realDeliveryWrites: []
    };
    const failed = {};
    let applied = 0;

    intents.forEach(function (it) {
      if (!it.value) {
        return;   // отмена (last-wins) — ничего не делаем
      }
      v12WithActor(it.user, function () {
        try {
          if (it.field === V12_CONFIG.PENDING_FIELD.HANDOFF) {
            const res = v12MarkReceivedByProduction(it.pid, it.source, true, ctx);
            if (res && res.status === "blocked") {
              failed[it.row] = res.reason || "заблокировано";
            } else {
              applied++;
            }
          } else if (it.field === V12_CONFIG.PENDING_FIELD.REAL_DELIVERY) {
            const res = v12ApplyRealDeliveryIntent(it.pid, ctx, posIndex);
            if (res && res.status === "blocked") {
              failed[it.row] = res.reason || "заблокировано";
            } else {
              applied++;
            }
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
    // Записи POSITION_STATE от «реальной поставки» — одним батчем.
    if (ctx.realDeliveryWrites.length) {
      batchWrite(v12GetSheetByKey("POSITION_STATE"), ctx.realDeliveryWrites);
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
