/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_position_state.js
 *
 * POSITION_STATE — центральное операционное состояние позиции (ТЗ №12).
 * Строится из исходного BOM + операционных данных. Хранит все
 * 8 канонических количеств и состояния по ТЗ №14–23.
 * =====================================================
 */

/**
 * Получить позиции конкретного BOM: Map<positionId, {row, values}>.
 *
 * byBom (опц.) — индекс Map<bomId, Map<pid, m>> (v12BuildPositionsByBomIndex):
 * даёт позиции конкретного BOM за O(1) без полного прохода по всем позициям.
 * Без byBom — линейный проход по index (обратная совместимость).
 */
function v12GetPositionsByBom(bomId, index, byBom) {
  if (byBom) {
    return byBom.get(v12Norm(bomId)) || new Map();
  }
  const idx = index || v12BuildPositionIndex();
  const P = V12_CONFIG.POSITION_COLUMNS;
  const result = new Map();
  const id = normalizeMaterialId(bomId);
  for (const [pid, m] of idx) {
    if (v12Norm(m.values[P.BOM_ID - 1]) === v12Norm(id)) {
      result.set(pid, m);
    }
  }
  return result;
}

/**
 * Построить НОВУЮ строку POSITION_STATE из материала исходного BOM.
 * ops (опц.): { orderedQty, realDeliveryQty, expectedDate, receivedByProduction,
 *               receivedByProductionQty, warehouseQty }
 */
function v12BuildPositionRow(bomId, sourceMaterial, positionId, sourceRevision, ops) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.POSITION_STATE).fill("");

  const op = ops || {};
  const ordered = toNumber(op.orderedQty);
  const realDelivery = toNumber(op.realDeliveryQty);
  const expected = op.expectedDate || "";
  const received = v12IsChecked(op.receivedByProduction);
  const receivedQty = toNumber(op.receivedByProductionQty);

  row[P.POSITION_ID - 1] = positionId;
  row[P.BOM_ID - 1] = bomId;
  row[P.SOURCE_REVISION - 1] = sourceRevision || 1;
  row[P.BOM_NAME - 1] = sourceMaterial.bomName || bomId;
  row[P.BOM_ROW - 1] = sourceMaterial.row || 0;
  row[P.MATERIAL_CODE - 1] = sourceMaterial.code || "";
  row[P.MATERIAL_NAME - 1] = sourceMaterial.name || "";
  row[P.MODEL - 1] = sourceMaterial.model || "";
  row[P.UNIT - 1] = sourceMaterial.unit || "";
  row[P.REQUIRED_QTY - 1] = toNumber(sourceMaterial.requiredQty);
  row[P.RESERVED_QTY - 1] = toNumber(sourceMaterial.reservedQty);
  row[P.ORDERED_QTY - 1] = ordered;
  row[P.REAL_DELIVERY_QTY - 1] = realDelivery;
  row[P.REAL_DELIVERY_DATE - 1] = "";
  row[P.EXPECTED_DATE - 1] = expected;
  row[P.DEADLINE - 1] = sourceMaterial.deadline || "";
  row[P.RECEIVED_BY_PRODUCTION_QTY - 1] = receivedQty;
  row[P.RECEIVED_BY_PRODUCTION - 1] = received;
  row[P.RECEIVED_BY_PRODUCTION_AT - 1] = "";
  row[P.RECEIVED_BY_PRODUCTION_USER - 1] = "";
  row[P.VALIDATION_STATUS - 1] = "";
  row[P.LIFECYCLE_STATE - 1] = V12_CONFIG.LIFECYCLE_STATE.ACTIVE;
  row[P.SUPPLY_STATE - 1] = "";
  row[P.PRODUCTION_STATE - 1] = "";
  row[P.DEFICIT_QTY - 1] = 0;
  row[P.UNCOVERED_NEED - 1] = 0;
  row[P.OVER_ORDERED_QTY - 1] = 0;
  row[P.SHORT_DELIVERY_QTY - 1] = 0;
  row[P.AVAILABLE_FOR_PRODUCTION - 1] = 0;
  row[P.FLAGS - 1] = "";
  row[P.UPDATED_AT - 1] = new Date();

  v12ApplyComputedToRow(row);
  return row;
}

/**
 * Применить вычисленные значения к строке POSITION_STATE (in-place).
 */
function v12ApplyComputedToRow(row) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const calc = v12CalculatePositionState({
    requiredQty: row[P.REQUIRED_QTY - 1],
    reservedQty: row[P.RESERVED_QTY - 1],
    orderedQty: row[P.ORDERED_QTY - 1],
    realDeliveryQty: row[P.REAL_DELIVERY_QTY - 1],
    receivedByProduction: row[P.RECEIVED_BY_PRODUCTION - 1],
    row: row
  });

  row[P.VALIDATION_STATUS - 1] = calc.valid ? V12_CONFIG.VALIDATION_STATUS.VALID : V12_CONFIG.VALIDATION_STATUS.ERROR;
  row[P.SUPPLY_STATE - 1] = calc.supplyState;
  row[P.PRODUCTION_STATE - 1] = calc.productionState;
  row[P.DEFICIT_QTY - 1] = calc.deficitQty;
  row[P.UNCOVERED_NEED - 1] = calc.uncoveredNeed;
  row[P.OVER_ORDERED_QTY - 1] = calc.overOrderedQty;
  row[P.SHORT_DELIVERY_QTY - 1] = calc.shortDeliveryQty;
  row[P.AVAILABLE_FOR_PRODUCTION - 1] = calc.availableForProduction;
  row[P.FLAGS - 1] = calc.flags.join(",");
  row[P.UPDATED_AT - 1] = new Date();
  return row;
}

/**
 * Персистентность новых позиций: разовая запись батчем + обновление индекса.
 */
function v12PersistNewPositions(rows, index) {
  if (!rows || !rows.length) {
    return;
  }
  const sheet = v12GetSheetByKey("POSITION_STATE");
  const startRow = sheet.getLastRow() + 1;
  writeValues(sheet, startRow, 1, rows);
  rows.forEach(function (r, i) {
    const pid = normalizeMaterialId(r[V12_CONFIG.POSITION_COLUMNS.POSITION_ID - 1]);
    if (pid && index) {
      index.set(pid, { row: startRow + i, values: r });
    }
  });
}
