/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: archive_engine.js
 *
 * Архивация материалов, история, пакетное добавление истории.
 *
 * ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ:
 *   - MATERIAL_HISTORY читается ОДИН раз на операцию архивации
 *     (а не для каждого материала).
 *   - Архивные строки, изменения состояния и события пишутся БАТЧЕМ.
 * =====================================================
 */

/**
 * Батч-добавление строк в MATERIAL_HISTORY.
 */
function appendHistoryRows(rows) {
  if (!rows || rows.length === 0) {
    return;
  }
  const sheet = getSheetByKey("MATERIAL_HISTORY");
  writeValues(sheet, sheet.getLastRow() + 1, 1, rows);
}

/**
 * Добавление одной записи истории.
 */
function addMaterialHistory(data) {
  const sheet = getSheetByKey("MATERIAL_HISTORY");
  appendRow(sheet, [
    new Date(),
    data.materialId || "",
    data.event || "",
    data.oldValue || "",
    data.newValue || "",
    getCurrentUser(),
    data.comment || ""
  ]);
}

/**
 * История материала.
 */
function getMaterialHistory(materialId, index) {
  const sheet = getSheetByKey("MATERIAL_HISTORY");
  const data = readSheetValues(sheet);
  const result = [];
  const id = normalizeMaterialId(materialId);
  for (let i = 1; i < data.length; i++) {
    if (normalizeMaterialId(data[i][V11_CONFIG.HISTORY_COLUMNS.MATERIAL_ID - 1]) === id) {
      result.push({
        date: data[i][0],
        event: data[i][2],
        old: data[i][3],
        new: data[i][4],
        user: data[i][5],
        comment: data[i][6]
      });
    }
  }
  return result;
}

/**
 * Собрать карту истории: materialId → массив записей.
 * ОДНО чтение MATERIAL_HISTORY на всю операцию архивации.
 */
function getMaterialHistoryMap() {
  const sheet = getSheetByKey("MATERIAL_HISTORY");
  const data = readSheetValues(sheet);
  const HC = V11_CONFIG.HISTORY_COLUMNS;
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const mid = normalizeMaterialId(data[i][HC.MATERIAL_ID - 1]);
    if (!mid) {
      continue;
    }
    if (!map[mid]) {
      map[mid] = [];
    }
    map[mid].push({
      date: data[i][HC.DATE - 1],
      event: data[i][HC.EVENT - 1],
      old: data[i][HC.OLD_VALUE - 1],
      new: data[i][HC.NEW_VALUE - 1],
      user: data[i][HC.USER - 1],
      comment: data[i][HC.COMMENT - 1]
    });
  }
  return map;
}

/**
 * Архивация одного материала: запись в Архив + смена состояния + событие.
 * historyMap (опц.) — готовая карта истории, чтобы не читать лист истории.
 */
function archiveMaterial(materialId, index, historyMap) {
  const material = getMaterialById(materialId, index);
  if (!material) {
    throw new Error("Материал не найден: " + materialId);
  }
  const row = material.values;
  const archive = getSheetByKey("ARCHIVE");
  const C = V11_CONFIG.MATERIAL_COLUMNS;

  const history = historyMap
    ? (historyMap[normalizeMaterialId(materialId)] || [])
    : getMaterialHistory(materialId, index);

  appendRow(archive, [
    new Date(),
    row[C.BOM - 1],
    row[C.BOM_VERSION - 1],
    row[C.MATERIAL_CODE - 1],
    row[C.MATERIAL_NAME - 1],
    row[C.REQUIRED - 1],
    row[C.REAL_DELIVERY_DATE - 1],
    row[C.RECEIVED_DATE - 1],
    row[C.RECEIVED_USER - 1],
    V11_CONFIG.MATERIAL_STATE.ARCHIVED,
    JSON.stringify(history)
  ]);

  updateMaterialState(materialId, {
    STATE: V11_CONFIG.MATERIAL_STATE.ARCHIVED,
    STATUS: V11_CONFIG.MATERIAL_STATUS.ARCHIVED
  }, index);

  createEvent(V11_CONFIG.EVENTS.MATERIAL_ARCHIVED, {
    materialId: materialId,
    comment: "Материал отправлен в архив"
  });
}

/**
 * Батч-архивация списка материалов.
 * items: [{ id, row, values }], index — индекс MATERIAL_STATE, historyMap — карта истории.
 * Пишет архив одним writeValues, состояние — одним batchWrite, события — одним appendEventRows.
 */
function archiveMaterialsBatch(items, index, historyMap) {
  const archive = getSheetByKey("ARCHIVE");
  const sheet = getSheetByKey("MATERIAL_STATE");
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  const archiveRows = [];
  const updates = [];
  const eventRows = [];

  items.forEach((item) => {
    const id = normalizeMaterialId(item.id);
    const material = index.get(id) || { row: item.row, values: item.values };
    const row = material.values;
    const history = historyMap ? (historyMap[id] || []) : [];

    archiveRows.push([
      new Date(),
      row[C.BOM - 1],
      row[C.BOM_VERSION - 1],
      row[C.MATERIAL_CODE - 1],
      row[C.MATERIAL_NAME - 1],
      row[C.REQUIRED - 1],
      row[C.REAL_DELIVERY_DATE - 1],
      row[C.RECEIVED_DATE - 1],
      row[C.RECEIVED_USER - 1],
      V11_CONFIG.MATERIAL_STATE.ARCHIVED,
      JSON.stringify(history)
    ]);

    if (C.STATE) {
      updates.push({ row: material.row, col: C.STATE, value: V11_CONFIG.MATERIAL_STATE.ARCHIVED });
    }
    if (C.STATUS) {
      updates.push({ row: material.row, col: C.STATUS, value: V11_CONFIG.MATERIAL_STATUS.ARCHIVED });
    }
    if (C.UPDATED) {
      updates.push({ row: material.row, col: C.UPDATED, value: new Date() });
    }

    eventRows.push({
      date: new Date(),
      id: generateEventId(),
      type: V11_CONFIG.EVENTS.MATERIAL_ARCHIVED,
      materialId: id,
      bom: row[C.BOM - 1],
      user: getCurrentUser(),
      data: JSON.stringify({ comment: "Материал отправлен в архив" })
    });
  });

  if (archiveRows.length) {
    writeValues(archive, archive.getLastRow() + 1, 1, archiveRows);
  }
  if (updates.length) {
    batchWrite(sheet, updates);
  }
  if (eventRows.length) {
    appendEventRows(eventRows);
  }
}

/**
 * Автоматическая архивация полученных материалов.
 * Читает один раз, архивирует те, у кого RECEIVED = true и ещё не архивированы.
 * История читается ОДИН раз; всё пишется батчем.
 */
function archiveReceivedMaterials() {
  const lock = acquireScriptLock();
  try {
    const sheet = getSheetByKey("MATERIAL_STATE");
    const data = readSheetValues(sheet);
    const C = V11_CONFIG.MATERIAL_COLUMNS;
    const archiveList = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const received = row[C.RECEIVED - 1] === true;
      const state = row[C.STATE - 1];
      const id = row[C.MATERIAL_ID - 1];
      if (received && id && state !== V11_CONFIG.MATERIAL_STATE.ARCHIVED) {
        archiveList.push({ id: id, row: i + 1, values: row });
      }
    }

    if (archiveList.length) {
      const index = new Map();
      for (let i = 1; i < data.length; i++) {
        const id = normalizeMaterialId(data[i][C.MATERIAL_ID - 1]);
        if (id) {
          index.set(id, { row: i + 1, values: data[i] });
        }
      }
      const historyMap = getMaterialHistoryMap();
      archiveMaterialsBatch(archiveList, index, historyMap);
    }

    flushSheets();

    logSystem("archiveReceivedMaterials", "Архивировано материалов: " + archiveList.length, "INFO");
  } catch (error) {
    logSystem("archiveReceivedMaterials", error.message, error, "ERROR");
    throw error;
  } finally {
    lock.releaseLock();
  }
}
