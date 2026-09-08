/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: material_actions.js
 *
 * Действия с материалом: поставка, получение производством,
 * изменение даты/заказа. Вызываются через событийную шину.
 * По ТЗ права по ролям:
 *   снабженец/менеджер — заказ, ожидаемая дата, реальная поставка.
 *   менеджер — также крайний срок.
 *   кладовщик — «Получено».
 * =====================================================
 */

/**
 * Реальная поставка на склад.
 * Разрешена ролям снабженца и менеджера.
 */
function confirmRealDelivery(materialId, index) {
  const role = getCurrentUserRole();
  if (!canEditField(role, "REAL_DELIVERY")) {
    logSystem("confirmRealDelivery", "Запрещено для роли: " + role + " (материал " + materialId + ")", "WARNING");
    return;
  }
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
 * Отмена реальной поставки.
 * Разрешена ролям снабженца и менеджера.
 */
function cancelRealDelivery(materialId, index) {
  const role = getCurrentUserRole();
  if (!canEditField(role, "REAL_DELIVERY")) {
    logSystem("cancelRealDelivery", "Запрещено для роли: " + role + " (материал " + materialId + ")", "WARNING");
    return;
  }
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
 * Получение материалом производством.
 * Разрешено только кладовщику.
 */
function confirmMaterialReceived(materialId, index) {
  const role = getCurrentUserRole();
  if (!canEditField(role, "RECEIVED")) {
    logSystem("confirmMaterialReceived", "Запрещено для роли: " + role + " (материал " + materialId + ")", "WARNING");
    return;
  }
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
 * Отмена получения.
 * Разрешено только кладовщику.
 */
function cancelMaterialReceived(materialId, index) {
  const role = getCurrentUserRole();
  if (!canEditField(role, "RECEIVED")) {
    logSystem("cancelMaterialReceived", "Запрещено для роли: " + role + " (материал " + materialId + ")", "WARNING");
    return;
  }
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
 * Изменение ожидаемой даты поставки.
 * Разрешено снабженцу и менеджеру.
 */
function updateExpectedDeliveryDate(materialId, newDate, index) {
  const role = getCurrentUserRole();
  if (!canEditField(role, "EXPECTED_DATE")) {
    logSystem("updateExpectedDeliveryDate", "Запрещено для роли: " + role + " (материал " + materialId + ")", "WARNING");
    return;
  }
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
 * Изменение крайнего срока.
 * Разрешено менеджеру и экономисту.
 */
function updateDeadlineDate(materialId, newDate, index) {
  const role = getCurrentUserRole();
  if (!canEditField(role, "DEADLINE_DATE")) {
    logSystem("updateDeadlineDate", "Запрещено для роли: " + role + " (материал " + materialId + ")", "WARNING");
    return;
  }
  updateMaterialState(materialId, {
    DEADLINE_DATE: newDate
  }, index);

  recalculateMaterialStatus(materialId, index);

  addSystemEvent({
    eventType: V11_CONFIG.EVENTS.DEADLINE_DATE_CHANGED,
    materialId: materialId,
    comment: "Изменён крайний срок"
  });
}

/**
 * Изменение количества заказа.
 * Разрешено снабженцу и менеджеру.
 */
function updateMaterialOrder(materialId, quantity, index) {
  const role = getCurrentUserRole();
  if (!canEditField(role, "ORDERED")) {
    logSystem("updateMaterialOrder", "Запрещено для роли: " + role + " (материал " + materialId + ")", "WARNING");
    return;
  }
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
