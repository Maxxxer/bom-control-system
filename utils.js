/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: utils.js
 *
 * Общие утилиты: числа, ID, пользователь, даты.
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

function getCurrentUserSafe() {
  return getCurrentUser();
}

/**
 * Является ли значение датой (Date или парсибельная строка)
 */
function isValidDate(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  const d = new Date(value);
  return !isNaN(d.getTime());
}

function toDate(value) {
  if (!isValidDate(value)) {
    return null;
  }
  return new Date(value);
}

/**
 * Нормализация значения даты для сравнения.
 * Возвращает timestamp (число) или "" — чтобы Date/строка/пусто
 * сравнивались единообразно без ложных срабатываний из-за таймзоны.
 */
function normalizeDateValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return String(value).trim();
  }
  return d.getTime();
}

/**
 * Пустая строка-заглушка для диапазона
 */
function emptyArray(length) {
  return new Array(length).fill("");
}
