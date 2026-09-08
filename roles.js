/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: roles.js
 *
 * Роли и права пользователей.
 * По ТЗ:
 *   экономист  — заполняет BOM (первичная подготовка), вводит «Зарезервировано».
 *   снабженец  — вносит кол-во заказа, ожидаемую дату, чекбокс реальной поставки.
 *   менеджер   — меняет ожидаемую дату, количество, чекбокс реальной поставки.
 *   кладовщик  — подтверждает получение («Получено»).
 * Корректировать статусы вручную запрещено.
 * =====================================================
 */

/** Маппинг email → роль. Заполняется владельцем. */
const ROLE_MAP = {
  // "email@example.com": V11_CONFIG.ROLES.ECONOMIST
};

/**
 * Роль пользователя по email. Возвращает строку роли или "".
 */
function getUserRole(email) {
  if (!email) {
    return "";
  }
  return ROLE_MAP[email] || "";
}

/**
 * Текущий пользователь и его роль.
 */
function getCurrentUserRole() {
  return getUserRole(getCurrentUser());
}

/**
 * Может ли роль редактировать поле сводки.
 * Поле — имя из DEFICIT_COLUMNS: RECEIVED / REQUIRED / ORDERED /
 * EXPECTED_DATE / DEADLINE_DATE / REAL_DELIVERY.
 */
function canEditField(role, field) {
  const R = V11_CONFIG.ROLES;
  // «Требуется» (дефицит) — расчётное поле, только чтение для всех.
  const allowed = {
    [R.PROCUREMENT]: ["ORDERED", "EXPECTED_DATE", "REAL_DELIVERY"],
    [R.MANAGER]: ["ORDERED", "EXPECTED_DATE", "REAL_DELIVERY"],
    [R.STOREKEEPER]: ["RECEIVED"],
    [R.ECONOMIST]: []
  };
  return (allowed[role] || []).indexOf(field) !== -1;
}

/**
 * Может ли роль отмечать «Выполнено» в дашборде.
 * Только после «Готов к производству».
 */
function canMarkDone(role) {
  return true; // право на саму отметку; готовность проверяется отдельно
}
