/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_events.js
 *
 * Запись истории позиции (MATERIAL_HISTORY) и событий (EVENT_LOG).
 * Ранее оба листа не наполнялись («листы-призраки»): колонка «История» в
 * ARCHIVE всегда была пуста, а EVENT_LOG не использовался. Здесь — единые
 * точки записи, вызываемые из операций и передачи производству.
 *
 * MATERIAL_HISTORY (7): Дата, Position ID, Событие, Старое, Новое, Пользователь, Комментарий.
 * EVENT_LOG (7):        Дата, Event ID, Тип события, Position ID, BOM, Пользователь, Данные.
 * =====================================================
 */

/**
 * Построить строку MATERIAL_HISTORY (без записи) — для батч-режима.
 */
function v12BuildHistoryRow(positionId, event, oldValue, newValue, comment) {
  const H = V12_CONFIG.HISTORY_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.MATERIAL_HISTORY).fill("");
  row[H.DATE - 1] = new Date();
  row[H.POSITION_ID - 1] = positionId || "";
  row[H.EVENT - 1] = event || "";
  row[H.OLD_VALUE - 1] = (oldValue === undefined || oldValue === null) ? "" : oldValue;
  row[H.NEW_VALUE - 1] = (newValue === undefined || newValue === null) ? "" : newValue;
  row[H.USER - 1] = v12CurrentActor();
  row[H.COMMENT - 1] = comment || "";
  return row;
}

/**
 * Записать событие позиции в MATERIAL_HISTORY.
 * event — короткий код: ORDERED_QTY / EXPECTED_DATE / REAL_DELIVERY_QTY /
 * PRODUCTION_HANDOFF / RETURN_FROM_ARCHIVE.
 *
 * ctx (опц.) — пакетный контекст слива очереди: при его наличии строка
 * накапливается в ctx.historyRows и записывается ОДНИМ вызовом в конце пачки
 * (вместо appendRow на каждую позицию). Без ctx — прежнее немедленное
 * appendRow (одиночные операции, возврат из архива).
 */
function v12LogHistory(positionId, event, oldValue, newValue, comment, ctx) {
  const row = v12BuildHistoryRow(positionId, event, oldValue, newValue, comment);
  if (ctx && ctx.historyRows) {
    ctx.historyRows.push(row);
    return;
  }
  const sheet = getSheetByName(V12_CONFIG.SHEETS.MATERIAL_HISTORY);
  if (!sheet) {
    return;
  }
  appendRow(sheet, row);
}

/**
 * Построить строку EVENT_LOG (без записи) — для батч-режима.
 */
function v12BuildEventRow(eventType, positionId, bom, data, eventId) {
  const E = V12_CONFIG.EVENT_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.EVENT_LOG).fill("");
  row[E.DATE - 1] = new Date();
  row[E.EVENT_ID - 1] = eventId || generateEventId();
  row[E.EVENT_TYPE - 1] = eventType || "";
  row[E.POSITION_ID - 1] = positionId || "";
  row[E.BOM - 1] = bom || "";
  row[E.USER - 1] = v12CurrentActor();
  row[E.DATA - 1] = (data === undefined || data === null) ? "" : (typeof data === "string" ? data : JSON.stringify(data));
  return row;
}

/**
 * Записать событие в EVENT_LOG.
 *
 * ctx (опц.) — как в v12LogHistory: при наличии контекста строка копится в
 * ctx.eventRows и пишется одним батчем в конце пачки. EVENT_ID генерируется
 * ОДИН раз на пачку (ctx.operationId) с локальным счётчиком — это избавляет
 * от RPC Utilities.getUuid() на каждую позицию.
 */
function v12LogEvent(eventType, positionId, bom, data, ctx) {
  let eventId = null;
  if (ctx && ctx.eventRows) {
    if (!ctx._eventSeq) {
      ctx._eventSeq = 0;
    }
    ctx._eventSeq++;
    eventId = (ctx.operationId || generateEventId()) + "-" + ctx._eventSeq;
    ctx.eventRows.push(v12BuildEventRow(eventType, positionId, bom, data, eventId));
    return;
  }
  const sheet = getSheetByName(V12_CONFIG.SHEETS.EVENT_LOG);
  if (!sheet) {
    return;
  }
  appendRow(sheet, v12BuildEventRow(eventType, positionId, bom, data));
}
