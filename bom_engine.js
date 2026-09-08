/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: bom_engine.js
 *
 * Ревизии BOM, изменение количества, добавление/удаление
 * материалов из BOM. Версии — по конкретному BOM.
 * =====================================================
 */

/**
 * Проверка изменений BOM (заглушка — реальная интеграция в import_engine).
 */
function checkBOMRevision() {
  return [];
}

function compareBOMVersions() {
  return [];
}

/**
 * Обработка событий ревизии BOM.
 * Правильная сигнатура: createEvent(eventType, payload).
 */
function createBOMRevisionEvent(change) {
  if (!change) {
    return;
  }
  switch (change.type) {
    case "QTY_CHANGED":
      createEvent(V11_CONFIG.EVENTS.BOM_QTY_CHANGED, {
        materialId: change.materialId,
        comment: "Изменено количество BOM"
      });
      processBOMQuantityChange(change);
      break;
    case "ORDER_CHANGED":
      createEvent(V11_CONFIG.EVENTS.ORDER_CHANGED, {
        materialId: change.materialId,
        comment: "Изменено состояние заказа"
      });
      break;
    case "NAME_CHANGED":
      createEvent(V11_CONFIG.EVENTS.BOM_NAME_CHANGED, {
        materialId: change.materialId,
        comment: "Изменено имя материала BOM"
      });
      break;
    case "ADDED":
      createEvent(V11_CONFIG.EVENTS.BOM_MATERIAL_ADDED, {
        materialId: change.materialId,
        comment: "Добавлен материал BOM"
      });
      break;
    case "REMOVED":
      createEvent(V11_CONFIG.EVENTS.BOM_MATERIAL_REMOVED, {
        materialId: change.materialId,
        comment: "Удалён материал BOM"
      });
      break;
  }
}

/**
 * Изменение количества материала в BOM.
 */
function processBOMQuantityChange(data) {
  try {
    if (!data || !data.materialId) {
      throw new Error("Не указан MaterialID");
    }
    const material = getMaterialById(data.materialId);
    if (!material) {
      throw new Error("Материал не найден");
    }
    const newQty = toNumber(data.newValue);
    if (newQty < 0) {
      throw new Error("Некорректное количество");
    }
    const oldQty = toNumber(material.values[V11_CONFIG.MATERIAL_COLUMNS.REQUIRED - 1]);

    updateMaterialState(data.materialId, { REQUIRED: newQty });
    recalculateMaterialDeficit(data.materialId);
    addMaterialHistory({
      materialId: data.materialId,
      event: V11_CONFIG.EVENTS.BOM_QTY_CHANGED,
      oldValue: oldQty,
      newValue: newQty,
      comment: "Изменено количество BOM"
    });
  } catch (error) {
    logSystem("processBOMQuantityChange", error.message, error, "ERROR");
  }
}

/**
 * Добавление материала из BOM в MATERIAL_STATE.
 */
function addMaterialFromBOM(material) {
  try {
    validateBOMMaterial(material);
    const materialId = generateMaterialId(material.bom, material.version, material.row);

    if (getMaterialById(materialId)) {
      return materialId;
    }

    const sheet = getSheetByKey("MATERIAL_STATE");
    appendRow(sheet, [
      materialId,
      material.bom,
      material.version || "V1",
      material.row || 0,
      material.code || "",
      material.name || "",
      material.unit || "",
      toNumber(material.required || 0),
      toNumber(material.reserved || 0),
      0,
      0,
      "",
      material.deadline || "",
      false,
      "",
      false,
      "",
      "",
      V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED,
      V11_CONFIG.MATERIAL_STATE.DEFICIT,
      new Date()
    ]);

    recalculateMaterialDeficit(materialId);
    addMaterialHistory({
      materialId: materialId,
      event: V11_CONFIG.EVENTS.BOM_MATERIAL_ADDED,
      comment: "Добавлен материал из BOM"
    });

    return materialId;
  } catch (error) {
    logSystem("addMaterialFromBOM", error.message, error, "ERROR");
    return null;
  }
}

/**
 * Удаление материала из BOM.
 */
function removeMaterialFromBOM(materialId) {
  updateMaterialState(materialId, {
    STATE: V11_CONFIG.MATERIAL_STATE.REMOVED,
    STATUS: V11_CONFIG.MATERIAL_STATUS.REMOVED
  });
  recalculateMaterialStatus(materialId);
  addMaterialHistory({
    materialId: materialId,
    event: V11_CONFIG.EVENTS.BOM_MATERIAL_REMOVED,
    comment: "Материал удалён из BOM"
  });
}

/**
 * Восстановление материала в BOM.
 */
function restoreMaterialToBOM(materialId) {
  updateMaterialState(materialId, {
    STATE: V11_CONFIG.MATERIAL_STATE.DEFICIT,
    STATUS: V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED
  });
  recalculateMaterialDeficit(materialId);
}

/**
 * Генерация MaterialID.
 */
function generateMaterialId(bom, version, row) {
  return [
    String(bom).trim(),
    String(version || "V1").trim(),
    Number(row)
  ].join("|");
}

/**
 * Валидация BOM-материала.
 */
function validateBOMMaterial(material) {
  if (!material) {
    throw new Error("Пустой BOM материал");
  }
  if (!material.bom) {
    throw new Error("Не указан BOM");
  }
  if (material.row === undefined || material.row === null) {
    throw new Error("Не указан BOM_ROW");
  }
  if (!String(material.name || "").trim()) {
    throw new Error("Не указано наименование материала");
  }
}

/**
 * Создание версии BOM (номер по конкретному BOM).
 */
function createBOMVersion(bom) {
  const sheet = getSheetByKey("BOM_REVISION");
  const data = readSheetValues(sheet);
  const bomCol = V11_CONFIG.BOM_REVISION_COLUMNS.BOM;
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (normalizeMaterialId(data[i][bomCol - 1]) === normalizeMaterialId(bom)) {
      count++;
    }
  }
  const version = "V" + (count + 1);
  appendRow(sheet, [new Date(), bom, version, getCurrentUser()]);
  return version;
}
