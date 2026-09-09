/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_roles.js
 *
 * RBAC по ТЗ №114–117. Роли: ADMIN, ECONOMIST, PROCUREMENT,
 * WAREHOUSE, PRODUCTION, VIEWER. Каждая критическая серверная
 * функция сама проверяет права.
 * =====================================================
 */

/** Маппинг email → роль. Заполняется владельцем. */
const V12_ROLE_MAP = {
  // "email@example.com": V12_CONFIG.ROLES.ADMIN
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
  return v12GetUserRole(getCurrentUser());
}

/**
 * Проверка: есть ли у роли право на действие/поле.
 * Поля/действия задаются строками-ключами из конфига.
 */
function v12CanEditField(role, action) {
  const R = V12_CONFIG.ROLES;
  const allowed = {
    [R.ECONOMIST]: ["SOURCE_BOM_WRITE", "DEADLINE"],
    [R.PROCUREMENT]: ["ORDERED_QTY", "EXPECTED_DATE", "REAL_DELIVERY"],
    [R.WAREHOUSE]: ["WAREHOUSE_QTY", "PICKING_CHECKBOX"],
    [R.PRODUCTION]: ["PICKING_CHECKBOX", "WORKING_BOM_CHECKBOX"],
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
    const user = getCurrentUser();
    throw new Error("Недостаточно прав для роли '" + role + "' на действие '" + action + "' (пользователь: " + user + ")");
  }
}

/**
 * Имя роли по-человечески (для логов/UI).
 */
function v12RoleLabel(role) {
  const R = V12_CONFIG.ROLES;
  const map = {
    [R.ADMIN]: "Администратор",
    [R.ECONOMIST]: "Экономист",
    [R.PROCUREMENT]: "Снабженец",
    [R.WAREHOUSE]: "Кладовщик",
    [R.PRODUCTION]: "Производство",
    [R.VIEWER]: "Наблюдатель"
  };
  return map[role] || role || "Неизвестная роль";
}
