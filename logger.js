/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: logger.js
 *
 * Единый логгер. Одна сигнатура:
 *   logSystem(functionName, message, data?, level?)
 *
 * ОПТИМИЗАЦИЯ: строки буферизуются в памяти и пишутся
 * БАТЧЕМ (одним writeValues), а не по одной через appendRow.
 * flushSystemLog() вызывается в конце массовых операций.
 * =====================================================
 */

const LOG_LEVELS = {
  INFO: "INFO",
  ERROR: "ERROR",
  WARNING: "WARNING",
  WARN: "WARNING",
  DEBUG: "DEBUG"
};

// Буфер лога и порог автосброса
let _logBuffer = [];
let _logThreshold = 50;

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

  if (V11_CONFIG.SETTINGS.ENABLE_LOGGING === false) {
    return;
  }

  _logBuffer.push([
    new Date(),
    functionName,
    message,
    level || LOG_LEVELS.INFO,
    dataText
  ]);

  if (_logBuffer.length >= _logThreshold) {
    flushSystemLog();
  }
}

/**
 * Сбросить буфер в SYSTEM_LOG одним вызовом.
 */
function flushSystemLog() {
  if (!_logBuffer.length) {
    return;
  }
  const sheet = getSheetByName(V11_CONFIG.SHEETS.SYSTEM_LOG);
  if (!sheet) {
    _logBuffer = [];
    return;
  }
  try {
    const rows = _logBuffer;
    _logBuffer = [];
    writeValues(sheet, sheet.getLastRow() + 1, 1, rows);
  } catch (e) {
    _logBuffer = [];
    console.error("flushSystemLog failed: " + e.message);
  }
}

/**
 * Безопасный уровень — заглушка для совместимости.
 */
function safeSystemLog(functionName, message, level) {
  logSystem(functionName, message, level);
}
