/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: logger.js
 *
 * Единый логгер. Одна сигнатура:
 *   logSystem(functionName, message, data?, level?)
 * =====================================================
 */

const LOG_LEVELS = {
  INFO: "INFO",
  ERROR: "ERROR",
  WARNING: "WARNING",
  WARN: "WARNING",
  DEBUG: "DEBUG"
};

/**
 * Запись в SYSTEM_LOG.
 *
 * Поддерживаемые вызовы:
 *   logSystem(fn, msg)
 *   logSystem(fn, msg, data)
 *   logSystem(fn, msg, data, level)
 *
 * Если третий аргумент — строка-уровень ("INFO"/"ERROR"/...), он
 * воспринимается как уровень, а data становится пустым.
 */
function logSystem(functionName, message, data, level) {
  // Нормализация: третий аргумент может быть уровнем
  if (
    typeof data === "string" &&
    Object.prototype.hasOwnProperty.call(LOG_LEVELS, data)
  ) {
    level = data;
    data = "";
  }

  let dataText = "";
  if (data !== undefined && data !== null && data !== "") {
    dataText = typeof data === "string" ? data : JSON.stringify(data);
  }

  const sheet = getSheetByName(V11_CONFIG.SHEETS.SYSTEM_LOG);
  if (!sheet) {
    return;
  }

  try {
    sheet.appendRow([
      new Date(),
      functionName,
      message,
      level || LOG_LEVELS.INFO,
      dataText
    ]);
  } catch (e) {
    console.error("logSystem failed: " + e.message);
  }
}

/**
 * Безопасный уровень — заглушка для совместимости.
 */
function safeSystemLog(functionName, message, level) {
  logSystem(functionName, message, level);
}
