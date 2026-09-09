/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: material_service.js
 *
 * CRUD над листом MATERIAL_STATE.
 * Индексы колонок берутся только из V11_CONFIG.
 * =====================================================
 */

/**
 * Собрать индекс материалов в памяти.
 * Читает лист один раз (если data не передан), возвращает Map<normalizedId, {row, values}>.
 * Если data уже прочитано вызывающим кодом — передаём его, чтобы НЕ читать лист повторно.
 */
function buildMaterialIndex(data) {
  const rows = data || readSheetValues(getSheetByKey("MATERIAL_STATE"));
  const idCol = V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_ID - 1;
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const id = normalizeMaterialId(rows[i][idCol]);
    if (id) {
      index.set(id, { row: i + 1, values: rows[i] });
    }
  }
  return index;
}

/**
 * Получить материал по ID.
 * Принимает опциональный готовый индекс, чтобы не читать лист повторно.
 */
function getMaterialById(materialId, index) {
  const id = normalizeMaterialId(materialId);
  if (!id) {
    return null;
  }
  const idx = index || buildMaterialIndex();
  return idx.get(id) || null;
}

function materialExists(materialId, index) {
  return getMaterialById(materialId, index) !== null;
}

/**
 * Обновить поля материала.
 *
 * changes: { КЛЮЧ_КОЛОНКИ: значение, ... }
 * Пишет батчем через RangeList. Автоматически проставляет UPDATED.
 */
function updateMaterialState(materialId, changes, index) {
  const material = getMaterialById(materialId, index);
  if (!material) {
    throw new Error("Материал не найден: " + materialId);
  }
  const sheet = getSheetByKey("MATERIAL_STATE");
  const writes = [];
  const C = V11_CONFIG.MATERIAL_COLUMNS;

  Object.keys(changes || {}).forEach((key) => {
    const col = C[key];
    if (col) {
      writes.push({ row: material.row, col: col, value: changes[key] });
    }
  });

  // Проставить дату обновления
  if (C.UPDATED) {
    writes.push({ row: material.row, col: C.UPDATED, value: new Date() });
  }

  if (writes.length) {
    batchWrite(sheet, writes);
  }
}

/**
 * Краткое состояние материала
 */
function getMaterialState(materialId, index) {
  const material = getMaterialById(materialId, index);
  if (!material) {
    return null;
  }
  const row = material.values;
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  return {
    id: materialId,
    status: row[C.STATUS - 1],
    state: row[C.STATE - 1],
    required: toNumber(row[C.REQUIRED - 1]),
    ordered: toNumber(row[C.ORDERED - 1]),
    reserved: toNumber(row[C.RESERVED - 1]),
    deficit: toNumber(row[C.DEFICIT - 1]),
    received: row[C.RECEIVED - 1] === true,
    stock: row[C.REAL_DELIVERY - 1] === true
  };
}

/**
 * Поиск материала по BOM и номеру строки.
 * Возвращает {id, row, values} или null.
 */
function findMaterialInBOM(bom, rowNumber, index) {
  const idx = index || buildMaterialIndex();
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  for (const [id, m] of idx) {
    if (
      normalizeMaterialId(m.values[C.BOM - 1]) === normalizeMaterialId(bom) &&
      toNumber(m.values[C.BOM_ROW - 1]) === toNumber(rowNumber)
    ) {
      return { id: id, row: m.row, values: m.values };
    }
  }
  return null;
}
