/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: material_actions.js
 *
 * Действия с материалом: поставка, получение производством,
 * изменение даты/заказа. Вызываются через событийную шину.
 * =====================================================
 */

/**
 * Реальная поставка на склад
 */
function confirmRealDelivery(materialId, index) {
  updateMaterialState(materialId, {
    REAL_DELIVERY: true,
    REAL_DELIVERY_DATE: new Date()
  }, index);

  recalculateMaterialStatus(materialId, index);

  addMaterialHistory({
    materialId: materialId,
    event: V11_CONFIG.EVENTS.REAL_DELIVERY_CONFIRMED,
    comment: "Материал поступил на склад"
  });
}

/**
 * Отмена реальной поставки
 */
function cancelRealDelivery(materialId, index) {
  updateMaterialState(materialId, {
    REAL_DELIVERY: false,
    REAL_DELIVERY_DATE: V11_CONFIG.DEFAULTS.DATE
  }, index);

  recalculateMaterialStatus(materialId, index);

  addSystemEvent({
    eventType: V11_CONFIG.EVENTS.REAL_DELIVERY_CANCELLED,
    materialId: materialId,
    comment: "Отменена реальная поставка"
  });
}

/**
 * Получение материалом производством
 */
function confirmMaterialReceived(materialId, index) {
  updateMaterialState(materialId, {
    RECEIVED: true,
    RECEIVED_DATE: new Date(),
    RECEIVED_USER: getCurrentUser()
  }, index);

  recalculateMaterialStatus(materialId, index);

  addMaterialHistory({
    materialId: materialId,
    event: V11_CONFIG.EVENTS.MATERIAL_RECEIVED,
    comment: "Материал получен производством"
  });
}

/**
 * Отмена получения
 */
function cancelMaterialReceived(materialId, index) {
  updateMaterialState(materialId, {
    RECEIVED: false,
    RECEIVED_DATE: V11_CONFIG.DEFAULTS.DATE,
    RECEIVED_USER: V11_CONFIG.DEFAULTS.TEXT
  }, index);

  recalculateMaterialStatus(materialId, index);

  addMaterialHistory({
    materialId: materialId,
    event: V11_CONFIG.EVENTS.MATERIAL_RECEIVED_CANCELLED,
    comment: "Отменено получение материала"
  });
}

/**
 * Изменение ожидаемой даты поставки
 */
function updateExpectedDeliveryDate(materialId, newDate, index) {
  updateMaterialState(materialId, {
    EXPECTED_DATE: newDate
  }, index);

  recalculateMaterialStatus(materialId, index);

  addSystemEvent({
    eventType: V11_CONFIG.EVENTS.DELIVERY_DATE_CHANGED,
    materialId: materialId,
    comment: "Изменена ожидаемая дата поставки"
  });
}

/**
 * Изменение количества заказа
 */
function updateMaterialOrder(materialId, quantity, index) {
  const old = getMaterialById(materialId, index);
  const oldValue = old ? toNumber(old.values[V11_CONFIG.MATERIAL_COLUMNS.ORDERED - 1]) : 0;
  const newValue = Math.max(0, toNumber(quantity));

  updateMaterialState(materialId, {
    ORDERED: newValue
  }, index);

  recalculateMaterialStatus(materialId, index);

  addSystemEvent({
    eventType: V11_CONFIG.EVENTS.ORDER_CHANGED,
    materialId: materialId,
    comment: "Количество заказа изменено: " + oldValue + " → " + newValue
  });
}
