/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_material_state.js
 *
 * MATERIAL_STATE — физический склад (ТЗ №28–31).
 * warehouseQty — фактический остаток; reservedQty — контрольная
 * агрегация резервов по materialKey; freeQty = warehouseQty − reservedQty.
 * Соблюдается ТЗ №204/№211: система НЕ резервирует автоматически
 * из склада, а лишь проверяет консистентность (№30).
 * =====================================================
 */

/**
 * Найти физический остаток материала по materialKey.
 * index — индекс MATERIAL_STATE.
 */
function v12GetWarehouseQty(materialKey, index) {
  const idx = index || v12BuildMaterialIndex();
  const m = idx.get(normalizeMaterialId(materialKey));
  if (!m) {
    return 0;
  }
  return toNumber(m.values[V12_CONFIG.MATERIAL_COLUMNS.WAREHOUSE_QTY - 1]);
}

/**
 * Агрегировать резервы по materialKey из POSITION_STATE.
 * Возвращает Map<materialKey, {reservedQty, requiredQty}>.
 */
function v12AggregateReservations(positionData) {
  const rows = positionData || v12ReadSheet("POSITION_STATE");
  const P = V12_CONFIG.POSITION_COLUMNS;
  const agg = {};
  for (let i = 1; i < rows.length; i++) {
    const lc = rows[i][P.LIFECYCLE_STATE - 1];
    if (lc === V12_CONFIG.LIFECYCLE_STATE.ARCHIVED || lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
      continue;
    }
    const key = v12BuildMaterialKey({
      code: rows[i][P.MATERIAL_CODE - 1],
      name: rows[i][P.MATERIAL_NAME - 1],
      model: rows[i][P.MODEL - 1],
      unit: rows[i][P.UNIT - 1]
    });
    if (!agg[key]) {
      agg[key] = { reservedQty: 0, requiredQty: 0 };
    }
    agg[key].reservedQty += toNumber(rows[i][P.RESERVED_QTY - 1]);
    agg[key].requiredQty += toNumber(rows[i][P.REQUIRED_QTY - 1]);
  }
  return agg;
}

/**
 * Пересчитать контрольную агрегацию резервов и свободный остаток
 * в MATERIAL_STATE, проверить физическое несоответствие (ТЗ №30).
 * Возвращает список несоответствий [{materialKey, reservedQty, warehouseQty}].
 */
function v12RecalculateWarehouseConsistency() {
  const indexes = v12BuildMaterialIndex();
  const agg = v12AggregateReservations();
  const M = V12_CONFIG.MATERIAL_COLUMNS;
  const inconsistencies = [];
  const updates = [];

  Object.keys(agg).forEach(function (key) {
    const reserved = agg[key].reservedQty;
    const wItem = indexes.get(key);
    const warehouse = wItem ? toNumber(wItem.values[M.WAREHOUSE_QTY - 1]) : 0;
    const free = warehouse - reserved;
    // ТЗ №30: резерв не должен превышать физический остаток.
    // Несоответствие (RESERVATION_PHYSICAL_INCONSISTENCY) — когда reserved > warehouse,
    // т.е. свободного остатка нет (free < 0).
    if (reserved > warehouse) {
      inconsistencies.push({
        materialKey: key,
        reservedQty: reserved,
        warehouseQty: warehouse
      });
    }
    if (wItem) {
      updates.push({ row: wItem.row, col: M.RESERVED_QTY, value: reserved });
      updates.push({ row: wItem.row, col: M.FREE_QTY, value: Math.max(free, 0) });
    } else {
      // Нет записи физического материала — создаём с warehouseQty = 0
      const sheet = v12GetSheetByKey("MATERIAL_STATE");
      const row = new Array(V12_CONFIG.COLUMN_COUNT.MATERIAL_STATE).fill("");
      row[M.MATERIAL_KEY - 1] = key;
      row[M.RESERVED_QTY - 1] = reserved;
      row[M.FREE_QTY - 1] = 0;
      row[M.UPDATED_AT - 1] = new Date();
      appendRow(sheet, row);
    }
  });

  if (updates.length) {
    const sheet = v12GetSheetByKey("MATERIAL_STATE");
    batchWrite(sheet, updates);
  }
  return inconsistencies;
}
