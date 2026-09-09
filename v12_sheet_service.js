/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_sheet_service.js
 *
 * Доступ к листам V12. Переиспользует generic-обёртки
 * из sheet_service.js (readSheetValues, writeValues, clearBody,
 * batchWrite, ensureSheet), но работает с V12_CONFIG.
 * =====================================================
 */

/**
 * Получить лист V12 по ключу из конфига.
 */
function v12GetSheetByKey(key) {
  const name = V12_CONFIG.SHEETS[key];
  if (!name) {
    throw new Error("Нет листа V12 с ключом: " + key);
  }
  const sheet = getSheetByName(name);
  if (!sheet) {
    throw new Error("Лист V12 не найден: " + name);
  }
  return sheet;
}

/**
 * Создать все листы V12 (если не существуют) и записать заголовки.
 */
function v12EnsureAllSheets() {
  const headers = V12_CONFIG.HEADERS;
  Object.keys(V12_CONFIG.SHEETS).forEach((key) => {
    const name = V12_CONFIG.SHEETS[key];
    const header = headers[key] || [];
    ensureSheet(name, header);
  });
  v12FormatAllSheets();
}

/**
 * Форматировать все листы V12: закрепить шапку, жирный заголовок.
 */
function v12FormatAllSheets() {
  Object.values(V12_CONFIG.SHEETS).forEach((name) => {
    const sheet = getSheetByName(name);
    if (sheet) {
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold");
    }
  });
}

/**
 * Прочитать лист V12 как матрицу.
 */
function v12ReadSheet(key) {
  return readSheetValues(v12GetSheetByKey(key));
}

/**
 * Записать строки в лист V12.
 */
function v12WriteRows(key, startRow, rows) {
  const sheet = v12GetSheetByKey(key);
  writeValues(sheet, startRow, 1, rows);
}

/**
 * Очистить тело листа V12 (ниже заголовка).
 */
function v12ClearBody(key) {
  clearBody(v12GetSheetByKey(key));
}

/**
 * Вставить строки в лист V12 (append).
 */
function v12AppendRows(key, rows) {
  const sheet = v12GetSheetByKey(key);
  if (!rows || !rows.length) {
    return;
  }
  writeValues(sheet, sheet.getLastRow() + 1, 1, rows);
}

/**
 * Построить индекс POSITION_STATE: Map<positionId, {row, values}>.
 * Если data передан — не читаем лист повторно.
 */
function v12BuildPositionIndex(data) {
  const rows = data || v12ReadSheet("POSITION_STATE");
  const P = V12_CONFIG.POSITION_COLUMNS;
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const id = normalizeMaterialId(rows[i][P.POSITION_ID - 1]);
    if (id) {
      index.set(id, { row: i + 1, values: rows[i] });
    }
  }
  return index;
}

/**
 * Получить позицию по positionId.
 */
function v12GetPositionById(positionId, index) {
  const id = normalizeMaterialId(positionId);
  if (!id) {
    return null;
  }
  const idx = index || v12BuildPositionIndex();
  return idx.get(id) || null;
}

/**
 * Построить индекс BOM_REGISTRY: Map<bomId, {row, values}>.
 */
function v12BuildBomRegistryIndex(data) {
  const rows = data || v12ReadSheet("BOM_REGISTRY");
  const B = V12_CONFIG.BOM_REGISTRY_COLUMNS;
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const id = normalizeMaterialId(rows[i][B.BOM_ID - 1]);
    if (id) {
      index.set(id, { row: i + 1, values: rows[i] });
    }
  }
  return index;
}

/**
 * Построить индекс MATERIAL_STATE (физический склад): Map<materialKey, {row, values}>.
 */
function v12BuildMaterialIndex(data) {
  const rows = data || v12ReadSheet("MATERIAL_STATE");
  const M = V12_CONFIG.MATERIAL_COLUMNS;
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const key = normalizeMaterialId(rows[i][M.MATERIAL_KEY - 1]);
    if (key) {
      index.set(key, { row: i + 1, values: rows[i] });
    }
  }
  return index;
}

/**
 * Обновить одну позицию (батчем по строке) + проставить UPDATED_AT.
 */
function v12UpdatePosition(positionId, changes, index) {
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    throw new Error("Позиция не найдена: " + positionId);
  }
  const sheet = v12GetSheetByKey("POSITION_STATE");
  const P = V12_CONFIG.POSITION_COLUMNS;
  const writes = [];
  Object.keys(changes || {}).forEach((key) => {
    const col = P[key];
    if (col) {
      writes.push({ row: pos.row, col: col, value: changes[key] });
    }
  });
  if (P.UPDATED_AT) {
    writes.push({ row: pos.row, col: P.UPDATED_AT, value: new Date() });
  }
  if (writes.length) {
    batchWrite(sheet, writes);
  }
}

/**
 * Обновить одну запись BOM_REGISTRY.
 */
function v12UpdateBomRegistry(bomId, changes, index) {
  const reg = v12GetBomRegistryById(bomId, index);
  if (!reg) {
    throw new Error("BOM не найден в реестре: " + bomId);
  }
  const sheet = v12GetSheetByKey("BOM_REGISTRY");
  const B = V12_CONFIG.BOM_REGISTRY_COLUMNS;
  const writes = [];
  Object.keys(changes || {}).forEach((key) => {
    const col = B[key];
    if (col) {
      writes.push({ row: reg.row, col: col, value: changes[key] });
    }
  });
  if (B.UPDATED_AT) {
    writes.push({ row: reg.row, col: B.UPDATED_AT, value: new Date() });
  }
  if (writes.length) {
    batchWrite(sheet, writes);
  }
}

/**
 * Получить запись BOM_REGISTRY по bomId.
 */
function v12GetBomRegistryById(bomId, index) {
  const id = normalizeMaterialId(bomId);
  if (!id) {
    return null;
  }
  const idx = index || v12BuildBomRegistryIndex();
  return idx.get(id) || null;
}
