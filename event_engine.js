/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: event_engine.js
 *
 * Создание и обработка событий.
 * Единая сигнатура: createEvent(eventType, payload).
 * =====================================================
 */

/**
 * Батч-добавление строк в EVENT_LOG.
 */
function appendEventRows(rows) {
  if (!rows || rows.length === 0) {
    return;
  }
  const sheet = getSheetByKey("EVENT_LOG");
  const values = rows.map((r) => [
    r.date, r.id, r.type, r.materialId, r.bom, r.user, r.data
  ]);
  writeValues(sheet, sheet.getLastRow() + 1, 1, values);
}

/**
 * Запись одного события + обработка.
 */
function createEvent(eventType, payload) {
  const sheet = getSheetByKey("EVENT_LOG");
  const event = {
    id: generateEventId(),
    type: eventType,
    materialId: (payload && payload.materialId) || "",
    bom: (payload && payload.bom) || "",
    user: getCurrentUser(),
    date: new Date(),
    data: payload || {}
  };

  appendRow(sheet, [
    event.date,
    event.id,
    event.type,
    event.materialId,
    event.bom,
    event.user,
    JSON.stringify(event.data)
  ]);

  processEvent(event);
}

/**
 * Главный обработчик событий.
 */
function processEvent(event) {
  try {
    const E = V11_CONFIG.EVENTS;
    switch (event.type) {
      case E.REAL_DELIVERY_CONFIRMED:
        confirmRealDelivery(event.materialId);
        break;
      case E.REAL_DELIVERY_CANCELLED:
        cancelRealDelivery(event.materialId);
        break;
      case E.MATERIAL_RECEIVED:
        confirmMaterialReceived(event.materialId);
        break;
      case E.MATERIAL_RECEIVED_CANCELLED:
        cancelMaterialReceived(event.materialId);
        break;
      case E.DELIVERY_DATE_CHANGED:
        updateExpectedDeliveryDate(event.materialId, event.data && event.data.newDate);
        break;
      case E.MATERIAL_ORDERED:
        updateMaterialOrder(event.materialId, event.data && event.data.quantity);
        break;
      case E.BOM_QTY_CHANGED:
        processBOMQuantityChange(event.data);
        break;
      default:
        logSystem("processEvent", "Неизвестное событие: " + event.type);
    }
  } catch (error) {
    logSystem("processEvent", error.message, error, "ERROR");
  }
}

/**
 * Системное событие (без обработки, просто запись в EVENT_LOG).
 */
function addSystemEvent(data) {
  const sheet = getSheetByKey("EVENT_LOG");
  appendRow(sheet, [
    new Date(),
    generateEventId(),
    data.eventType || "",
    data.materialId || "",
    data.bom || "",
    getCurrentUser(),
    data.comment || ""
  ]);
}

/* ============ ID-функции событий (вызываются из UI/чекбоксов) ============ */

function eventRealDelivery(materialId) {
  createEvent(V11_CONFIG.EVENTS.REAL_DELIVERY_CONFIRMED, { materialId: materialId });
}

function eventCancelRealDelivery(materialId) {
  createEvent(V11_CONFIG.EVENTS.REAL_DELIVERY_CANCELLED, { materialId: materialId });
}

function eventMaterialReceived(materialId) {
  createEvent(V11_CONFIG.EVENTS.MATERIAL_RECEIVED, { materialId: materialId });
}

function eventCancelMaterialReceived(materialId) {
  createEvent(V11_CONFIG.EVENTS.MATERIAL_RECEIVED_CANCELLED, { materialId: materialId });
}

function eventDeliveryDateChanged(materialId, newDate) {
  createEvent(V11_CONFIG.EVENTS.DELIVERY_DATE_CHANGED, { materialId: materialId, newDate: newDate });
}

function eventMaterialOrdered(materialId, quantity) {
  createEvent(V11_CONFIG.EVENTS.MATERIAL_ORDERED, { materialId: materialId, quantity: quantity });
}
