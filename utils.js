/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: utils.js
 *
 * Общие утилиты: числа, ID, пользователь.
 * =====================================================
 */

/**
 * Безопасное приведение к числу.
 * Единая точка для всех парсингов чисел.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return isNaN(value) ? 0 : value;
  }
  const result = String(value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .match(/-?\d+(\.\d+)?/);
  return result ? Number(result[0]) : 0;
}

/**
 * Нормализация MaterialID
 */
function normalizeMaterialId(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

/**
 * Генерация ID события
 */
function generateEventId() {
  return "EVT-" + Utilities.getUuid();
}

/**
 * Получение текущего пользователя (безопасно)
 */
function getCurrentUser() {
  try {
    const email = Session.getActiveUser().getEmail();
    return email || "unknown";
  } catch (e) {
    return "unknown";
  }
}
