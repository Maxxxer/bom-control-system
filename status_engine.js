/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: status_engine.js
 *
 * Расчёт статуса и дефицита материала.
 * Устранена мёртвая ветка READY (READY — агрегат на уровне BOM).
 * Единая формула дефицита: required - reserved - ordered.
 * =====================================================
 */

/**
 * Чистый расчёт статуса по строке.
 * Возвращает { status, state, deficit, oldStatus, oldState }.
 */
function computeMaterialStatus(row) {
  const C = V11_CONFIG.MATERIAL_COLUMNS;

  const required = toNumber(row[C.REQUIRED - 1]);
  const reserved = toNumber(row[C.RESERVED - 1]);
  const ordered = toNumber(row[C.ORDERED - 1]);
  const received = row[C.RECEIVED - 1] === true;
  const stock = row[C.REAL_DELIVERY - 1] === true;
  const expected = row[C.EXPECTED_DATE - 1];
  const deadline = row[C.DEADLINE_DATE - 1];
  const oldStatus = row[C.STATUS - 1];
  const oldState = row[C.STATE - 1];

  const deficit = Math.max(required - reserved - ordered, 0);

  const MS = V11_CONFIG.MATERIAL_STATUS;
  const MST = V11_CONFIG.MATERIAL_STATE;

  let status;
  let state;

  if (oldStatus === MS.ARCHIVED) {
    status = MS.ARCHIVED;
    state = MST.ARCHIVED;
  } else if (oldStatus === MS.REMOVED) {
    status = MS.REMOVED;
    state = MST.REMOVED;
  } else if (required <= 0) {
    status = MS.NO_REQUIREMENT;
    state = MST.NO_REQUIREMENT;
  } else if (received) {
    status = MS.RECEIVED;
    state = MST.RECEIVED;
  } else if (stock) {
    status = MS.STOCK;
    state = MST.STOCK;
  } else if (ordered <= 0) {
    status = MS.NOT_ORDERED;
    state = MST.DEFICIT;
  } else if (!expected) {
    status = MS.DATE_UNKNOWN;
    state = MST.WAITING;
  } else if (ordered < required) {
    status = MS.PARTIAL_ORDER;
    state = MST.PARTIAL_ORDER;
  } else {
    const late = expected && deadline && new Date(expected) > new Date(deadline);
    status = late ? MS.ORDERED_LATE : MS.ORDERED_ON_TIME;
    state = late ? MST.WAITING_LATE : MST.WAITING;
  }

  return { status: status, state: state, deficit: deficit, oldStatus: oldStatus, oldState: oldState };
}

/**
 * Пересчёт одного материала (для одиночных событий).
 */
function recalculateMaterialStatus(materialId, index) {
  const material = getMaterialById(materialId, index);
  if (!material) {
    return;
  }
  const result = computeMaterialStatus(material.values);
  updateMaterialState(materialId, {
    DEFICIT: result.deficit,
    STATUS: result.status,
    STATE: result.state
  }, index);

  if (result.oldStatus && result.oldStatus !== result.status) {
    addSystemEvent({
      eventType: V11_CONFIG.EVENTS.STATUS_CHANGED,
      materialId: materialId,
      comment: result.oldStatus + " → " + result.status
    });
  }
  if (result.oldState && result.oldState !== result.state) {
    addMaterialHistory({
      materialId: materialId,
      event: "STATE_CHANGED",
      oldValue: result.oldState,
      newValue: result.state,
      comment: "Изменено внутреннее состояние"
    });
  }
}

/**
 * Пересчёт дефицита и статуса одного материала.
 */
function recalculateMaterialDeficit(materialId, index) {
  const material = getMaterialById(materialId, index);
  if (!material) {
    return;
  }
  const result = computeMaterialStatus(material.values);
  updateMaterialState(materialId, {
    DEFICIT: result.deficit,
    STATUS: result.status,
    STATE: result.state
  }, index);
}

/**
 * Полный пересчёт всех материалов — один проход.
 * Читает лист один раз, батчем пишет DEFICIT/STATUS/STATE/UPDATED.
 * Под защитой ScriptLock.
 */
function recalculateMaterials() {
  const lock = acquireScriptLock();
  try {
    const sheet = getSheetByKey("MATERIAL_STATE");
    const data = readSheetValues(sheet);
    const C = V11_CONFIG.MATERIAL_COLUMNS;

    const deficitCol = [];
    const statusCol = [];
    const stateCol = [];
    const updatedCol = [];
    const historyRows = [];
    const eventRows = [];
    let counter = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const id = normalizeMaterialId(row[C.MATERIAL_ID - 1]);
      if (!id) {
        deficitCol.push([""]);
        statusCol.push([""]);
        stateCol.push([""]);
        updatedCol.push([""]);
        continue;
      }
      const result = computeMaterialStatus(row);

      deficitCol.push([result.deficit]);
      statusCol.push([result.status]);
      stateCol.push([result.state]);
      updatedCol.push([new Date()]);

      if (result.oldStatus && result.oldStatus !== result.status) {
        eventRows.push({
          date: new Date(),
          id: generateEventId(),
          type: V11_CONFIG.EVENTS.STATUS_CHANGED,
          materialId: id,
          bom: row[C.BOM - 1],
          user: getCurrentUser(),
          data: JSON.stringify({ comment: result.oldStatus + " → " + result.status })
        });
      }
      if (result.oldState && result.oldState !== result.state) {
        historyRows.push([
          new Date(), id, "STATE_CHANGED", result.oldState, result.state,
          getCurrentUser(), "Изменено внутреннее состояние"
        ]);
      }
      counter++;
    }

    if (deficitCol.length) {
      sheet.getRange(2, C.DEFICIT, deficitCol.length, 1).setValues(deficitCol);
      sheet.getRange(2, C.STATUS, statusCol.length, 1).setValues(statusCol);
      sheet.getRange(2, C.STATE, stateCol.length, 1).setValues(stateCol);
      sheet.getRange(2, C.UPDATED, updatedCol.length, 1).setValues(updatedCol);
    }
    if (historyRows.length) {
      appendHistoryRows(historyRows);
    }
    if (eventRows.length) {
      appendEventRows(eventRows);
    }

    logSystem("recalculateMaterials", "Пересчитано материалов: " + counter, "INFO");
  } catch (error) {
    logSystem("recalculateMaterials", error.message, error, "ERROR");
    addSystemEvent({
      eventType: V11_CONFIG.EVENTS.SYSTEM_ERROR,
      comment: error.message
    });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Сброс блокировки движка вручную.
 */
function resetMaterialEngineLock() {
  logSystem("resetMaterialEngineLock", "Блокировка движка снята вручную", "WARNING");
}
