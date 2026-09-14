/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_roles.js
 *
 * RBAC по ТЗ №114–117. Роли: ADMIN, ECONOMIST, PROCUREMENT,
 * WAREHOUSE, PRODUCTION, VIEWER. Каждая критическая серверная
 * функция сама проверяет права.
 *
 * Матрица прав (кто что может менять):
 *
 *   PROCUREMENT (снабженец)   — лист «Сводка дефицитов»:
 *                               «Заказано» (ORDERED_QTY),
 *                               «Ожидаемая поставка» (EXPECTED_DATE);
 *   ECONOMIST (экономист)     — «Сводка дефицитов»: чекбокс
 *                               «Реальная поставка» (REAL_DELIVERY);
 *                               правка исходных BOM (SOURCE_BOM_WRITE,
 *                               DEADLINE) — таблицы в Google Drive;
 *   WAREHOUSE (кладовщик)     — «ОТБОРКА»: чекбокс «Отметка получено»
 *                               (PICKING_CHECKBOX); физический склад
 *                               MATERIAL_STATE: «Складской остаток»
 *                               (WAREHOUSE_QTY);
 *   PRODUCTION (производство) — «Dashboard»: чекбокс «Выполнено»
 *                               (DASHBOARD_CHECKBOX); «WORKING BOM»:
 *                               чекбокс передачи (WORKING_BOM_CHECKBOX);
 *                               «ОТБОРКА» (PICKING_CHECKBOX);
 *   ADMIN                     — все изменения без ограничений.
 * =====================================================
 */

/** Маппинг email → роль. Заполняется владельцем. */
const V12_ROLE_MAP = {
  // "email@example.com": V12_CONFIG.ROLES.ADMIN
  "6458771go@gmail.com":V12_CONFIG.ROLES.ECONOMIST,
  "maksim.salavei@gmail.com":V12_CONFIG.ROLES.PROCUREMENT,
  "Balalaikina79@gmail.com":V12_CONFIG.ROLES.WAREHOUSE,
  "lazukazip24@gmail.com":V12_CONFIG.ROLES.VIEWER,
  "polonets.maksim@gmail.com":V12_CONFIG.ROLES.ADMIN,
};

/**
 * Роль пользователя по email.
 */
function v12GetUserRole(email) {
  if (!email) {
    return "";
  }
  return V12_ROLE_MAP[email] || "";
}

/**
 * Текущая роль пользователя.
 * Если роли не настроены (V12_ROLE_MAP пуст) — все пользователи имеют роль ADMIN,
 * чтобы приложение работало «из коробки». Как только владелец добавит email в
 * V12_ROLE_MAP, RBAC активируется.
 */
function v12GetCurrentUserRole() {
  if (Object.keys(V12_ROLE_MAP).length === 0) {
    return V12_CONFIG.ROLES.ADMIN;
  }
  return v12GetUserRole(v12CurrentActor());
}

/**
 * Проверка: есть ли у роли право на действие/поле.
 * Поля/действия задаются строками-ключами (см. матрицу в шапке файла).
 *
 * Неизвестная роль (в т.ч. e-mail не из V12_ROLE_MAP) прав не имеет —
 * принцип «запрещено, если не разрешено явно».
 */
function v12CanEditField(role, action) {
  const R = V12_CONFIG.ROLES;
  const allowed = {
    // Экономист: чекбокс «Реальная поставка» в «Сводке дефицитов»
    // + правка исходных BOM.
    [R.ECONOMIST]: ["SOURCE_BOM_WRITE", "DEADLINE", "REAL_DELIVERY"],
    // Снабженец: только «Заказано» и «Ожидаемая поставка» «Сводки дефицитов».
    [R.PROCUREMENT]: ["ORDERED_QTY", "EXPECTED_DATE"],
    // Кладовщик: чекбокс «Отметка получено» «ОТБОРКИ» + «Складской остаток».
    [R.WAREHOUSE]: ["WAREHOUSE_QTY", "PICKING_CHECKBOX"],
    // Производство: чекбокс «Выполнено» Dashboard + передача из WORKING BOM/ОТБОРКИ.
    [R.PRODUCTION]: ["PICKING_CHECKBOX", "WORKING_BOM_CHECKBOX", "DASHBOARD_CHECKBOX"],
    [R.ADMIN]: ["*"],
    [R.VIEWER]: []
  };
  const set = allowed[role] || [];
  return set.indexOf("*") !== -1 || set.indexOf(action) !== -1;
}

/**
 * Принудительная проверка права. Бросает ошибку, если нет доступа.
 */
function v12RequireRole(role, action) {
  if (!v12CanEditField(role, action)) {
    const user = v12CurrentActor();
    throw new Error("Недостаточно прав для роли '" + role + "' на действие '" + action + "' (пользователь: " + user + ")");
  }
}
