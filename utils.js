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
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  // Приведение строки к числу с корректной обработкой разделителей:
  //   «1,234.56» (запятая — тысячи)   -> 1234.56
  //   «1.234,56» (точка  — тысячи)    -> 1234.56
  //   «1,5»      (запятая — десятичн.)-> 1.5
  //   «1.234.567»                     -> 1234567
  // Прежняя реализация заменяла ТОЛЬКО первую запятую, из-за чего «1,234.56»
  // парсилось как 1.234 (баг B-12 отчёта №33).
  let s = String(value).replace(/\s|\u00a0/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const commaCount = (s.match(/,/g) || []).length;
  const dotCount = (s.match(/\./g) || []).length;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // «1.234,56»: точка — разделитель тысяч, запятая — десятичный.
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // «1,234.56»: запятая — разделитель тысяч.
      s = s.replace(/,/g, "");
    }
  } else if (commaCount > 1) {
    s = s.replace(/,/g, "");
  } else if (dotCount > 1) {
    s = s.replace(/\./g, "");
  } else if (commaCount === 1) {
    s = s.replace(",", ".");
  }
  const result = s.match(/-?\d+(\.\d+)?/);
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
