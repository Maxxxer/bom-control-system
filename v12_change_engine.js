/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_change_engine.js
 *
 * Change Engine (ТЗ №2): detectBOMChanges -> ChangeSet ->
 * applySourceRevision. События QUANTITY_CHANGED / RESERVE_CHANGED /
 * DEADLINE_CHANGED / MATERIAL_CHANGED / MATERIAL_REPLACED /
 * POSITION_ADDED / POSITION_DELETED.
 * =====================================================
 */

/**
 * Сопоставить источник с существующими позициями и собрать ChangeSet.
 *
 * source: { bomName, materials: [...] } — из v12ReadSourceBOM.
 * existing: Map<positionId, {row, values}> — позиции BOM в POSITION_STATE.
 * bomName: имя BOM (для positionId-генерации).
 *
 * Возвращает { bomName, changes: [...], addedIds: [...], deletedIds: [...] }.
 */
function v12DetectBOMChanges(bomName, source, existing) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const changes = [];
  const addedIds = [];
  const deletedIds = [];
  const seenIds = new Set();

  // Пройдём по строкам источника в порядке строк BOM
  const materials = (source && source.materials) || [];
  // Сортируем по строке, чтобы первичная привязка была детерминированной
  materials.sort(function (a, b) { return toNumber(a.row) - toNumber(b.row); });

  materials.forEach(function (mat) {
    const materialKey = v12BuildMaterialKey({
      code: mat.code, name: mat.name, model: mat.model, unit: mat.unit
    });
    // Генерируем, учитывая уже занятые в этом проходе
    const positionId = v12GeneratePositionId(bomName, materialKey, seenIds);
    seenIds.add(positionId);

    const old = existing.get(positionId) || null;
    if (!old) {
      // Новая позиция
      addedIds.push(positionId);
      changes.push({
        type: V12_CONFIG.EVENTS.POSITION_ADDED,
        positionId: positionId,
        field: "",
        oldValue: "",
        newValue: JSON.stringify({
          row: mat.row, code: mat.code, name: mat.name, model: mat.model,
          unit: mat.unit, requiredQty: mat.requiredQty, reservedQty: mat.reservedQty,
          deadline: mat.deadline
        })
      });
      return;
    }

    const oldRow = old.values;
    // Сравнение полей
    if (toNumber(oldRow[P.REQUIRED_QTY - 1]) !== toNumber(mat.requiredQty)) {
      changes.push({
        type: V12_CONFIG.EVENTS.QUANTITY_CHANGED,
        positionId: positionId,
        field: "REQUIRED_QTY",
        oldValue: oldRow[P.REQUIRED_QTY - 1],
        newValue: mat.requiredQty
      });
    }
    if (toNumber(oldRow[P.RESERVED_QTY - 1]) !== toNumber(mat.reservedQty)) {
      changes.push({
        type: V12_CONFIG.EVENTS.RESERVE_CHANGED,
        positionId: positionId,
        field: "RESERVED_QTY",
        oldValue: oldRow[P.RESERVED_QTY - 1],
        newValue: mat.reservedQty
      });
    }
    if (v12Norm(oldRow[P.MATERIAL_NAME - 1]) !== v12Norm(mat.name)) {
      changes.push({
        type: V12_CONFIG.EVENTS.MATERIAL_CHANGED,
        positionId: positionId,
        field: "MATERIAL_NAME",
        oldValue: oldRow[P.MATERIAL_NAME - 1],
        newValue: mat.name
      });
    }
    if (v12Norm(oldRow[P.MODEL - 1]) !== v12Norm(mat.model)) {
      changes.push({
        type: V12_CONFIG.EVENTS.MATERIAL_CHANGED,
        positionId: positionId,
        field: "MODEL",
        oldValue: oldRow[P.MODEL - 1],
        newValue: mat.model
      });
    }
    if (v12Norm(oldRow[P.UNIT - 1]) !== v12Norm(mat.unit)) {
      changes.push({
        type: V12_CONFIG.EVENTS.MATERIAL_CHANGED,
        positionId: positionId,
        field: "UNIT",
        oldValue: oldRow[P.UNIT - 1],
        newValue: mat.unit
      });
    }
    if (v12DateValue(oldRow[P.DEADLINE - 1]) !== v12DateValue(mat.deadline)) {
      changes.push({
        type: V12_CONFIG.EVENTS.DEADLINE_CHANGED,
        positionId: positionId,
        field: "DEADLINE",
        oldValue: oldRow[P.DEADLINE - 1],
        newValue: mat.deadline
      });
    }
  });

  // Позиции, которых больше нет в источнике (кроме архивных/полученных)
  existing.forEach(function (m, pid) {
    if (!seenIds.has(pid)) {
      const lc = m.values[P.LIFECYCLE_STATE - 1];
      if (lc !== V12_CONFIG.LIFECYCLE_STATE.ARCHIVED) {
        deletedIds.push(pid);
        changes.push({
          type: V12_CONFIG.EVENTS.POSITION_DELETED,
          positionId: pid,
          field: "",
          oldValue: "",
          newValue: ""
        });
      }
    }
  });

  return {
    bomName: bomName,
    changes: changes,
    addedIds: addedIds,
    deletedIds: deletedIds,
    hasChanges: changes.length > 0
  };
}

/**
 * Применить ChangeSet: обновить/добавить/удалить позиции в POSITION_STATE,
 * пересчитать состояния, проставить ревизию источника.
 *
 * registry: { bomId, bomName, sourceRevision } — из v12UpsertSourceBOM.
 * index: индекс POSITION_STATE.
 */
function v12ApplySourceRevision(registry, changeSet, index) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const bomId = registry.bomId;
  const positionIndex = index || v12BuildPositionIndex();

  // Добавить новые
  const addedRows = [];
  if (changeSet.addedIds.length) {
    const byId = {};
    changeSet.changes.forEach(function (c) {
      if (c.type === V12_CONFIG.EVENTS.POSITION_ADDED) {
        byId[c.positionId] = JSON.parse(c.newValue || "{}");
      }
    });
    changeSet.addedIds.forEach(function (pid) {
      const data = byId[pid] || {};
      const mat = {
        bomName: registry.bomName,
        row: data.row,
        code: data.code,
        name: data.name,
        model: data.model,
        unit: data.unit,
        requiredQty: data.requiredQty,
        reservedQty: data.reservedQty,
        deadline: data.deadline
      };
      addedRows.push(v12BuildPositionRow(bomId, mat, pid, registry.sourceRevision, opsFor()));
    });
  }

  v12PersistNewPositions(addedRows, positionIndex);

  // Обновить изменённые
  const updates = {};
  changeSet.changes.forEach(function (c) {
    if (c.type === V12_CONFIG.EVENTS.POSITION_DELETED) {
      return;
    }
    if (c.type === V12_CONFIG.EVENTS.POSITION_ADDED) {
      return;
    }
    if (!updates[c.positionId]) {
      updates[c.positionId] = {};
    }
    // field -> новый столбец
    const colMap = {
      "REQUIRED_QTY": "REQUIRED_QTY",
      "RESERVED_QTY": "RESERVED_QTY",
      "MATERIAL_NAME": "MATERIAL_NAME",
      "MODEL": "MODEL",
      "UNIT": "UNIT",
      "DEADLINE": "DEADLINE"
    };
    const col = colMap[c.field];
    if (col) {
      updates[c.positionId][col] = c.newValue;
    }
  });

  // Обновить изменённые позиции: пишем изменённые поля + пересчитанные колонки
  Object.keys(updates).forEach(function (pid) {
    const pos = positionIndex.get(pid);
    if (!pos) {
      return;
    }
    const row = pos.values.slice();
    Object.keys(updates[pid]).forEach(function (k) {
      row[P[k] - 1] = updates[pid][k];
    });
    row[P.SOURCE_REVISION - 1] = registry.sourceRevision;
    v12ApplyComputedToRow(row);

    // Пишем и изменённые поля, и пересчитанные значения
    const changes = {};
    Object.keys(updates[pid]).forEach(function (k) {
      changes[k] = updates[pid][k];
    });
    changes.SOURCE_REVISION = registry.sourceRevision;
    changes.VALIDATION_STATUS = row[P.VALIDATION_STATUS - 1];
    changes.SUPPLY_STATE = row[P.SUPPLY_STATE - 1];
    changes.PRODUCTION_STATE = row[P.PRODUCTION_STATE - 1];
    changes.DEFICIT_QTY = row[P.DEFICIT_QTY - 1];
    changes.UNCOVERED_NEED = row[P.UNCOVERED_NEED - 1];
    changes.OVER_ORDERED_QTY = row[P.OVER_ORDERED_QTY - 1];
    changes.SHORT_DELIVERY_QTY = row[P.SHORT_DELIVERY_QTY - 1];
    changes.AVAILABLE_FOR_PRODUCTION = row[P.AVAILABLE_FOR_PRODUCTION - 1];
    changes.FLAGS = row[P.FLAGS - 1];
    v12UpdatePosition(pid, changes, positionIndex);
  });

  // Удалить: lifecycle = REMOVED, пересчитать
  changeSet.deletedIds.forEach(function (pid) {
    const pos = positionIndex.get(pid);
    if (!pos) {
      return;
    }
    v12UpdatePosition(pid, {
      LIFECYCLE_STATE: V12_CONFIG.LIFECYCLE_STATE.REMOVED,
      SOURCE_REVISION: registry.sourceRevision
    }, positionIndex);
  });

  return changeSet;
}

/** Вспомогательная: операционные значения по умолчанию для новой позиции. */
function opsFor() {
  return {
    orderedQty: 0,
    realDeliveryQty: 0,
    expectedDate: "",
    receivedByProduction: false,
    receivedByProductionQty: 0
  };
}

/**
 * Полная синхронизация одного BOM: регистрация источника + детект изменений
 * + применение ревизии. Возвращает { bomId, changed, added, removed }.
 */
function v12SyncBOM(source, positionIndex, registryIndex) {
  // Индексы можно передать извне (массовая синхронизация) — тогда лист
  // POSITION_STATE/BOM_REGISTRY не перечитывается на каждый BOM.
  const idx = positionIndex || v12BuildPositionIndex();
  const reg = v12UpsertSourceBOM(source, registryIndex);
  const existing = v12GetPositionsByBom(reg.bomId, idx);
  const changeSet = v12DetectBOMChanges(reg.bomId, source, existing);
  if (changeSet.hasChanges) {
    v12ApplySourceRevision(reg, changeSet, idx);
  }
  return {
    bomId: reg.bomId,
    changed: reg.changed || changeSet.hasChanges,
    added: changeSet.addedIds.length,
    removed: changeSet.deletedIds.length
  };
}
