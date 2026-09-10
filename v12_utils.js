/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_utils.js
 *
 * Утилиты V12: стабильный positionId, materialKey (К5),
 * валидация по ТЗ №8 (К4), нормализация значений.
 * Переиспользует generic-помощники из utils.js
 * (toNumber, normalizeMaterialId, getCurrentUser).
 * =====================================================
 */

/**
 * Построить materialKey по ТЗ №68–71 (К5):
 *   если есть code -> code; иначе name|model|unit.
 */
function v12BuildMaterialKey(parts) {
  const code = String((parts && parts.code) || "").trim();
  if (code) {
    return code;
  }
  const name = String((parts && parts.name) || "").trim();
  const model = String((parts && parts.model) || "").trim();
  const unit = String((parts && parts.unit) || "").trim();
  return [name, model, unit].join("|");
}

/**
 * Построить стабильный ключ позиции для первичного связывания.
 * Используется только при создании positionId (не как primary key впоследствии).
 * Ключ детерминирован: code|name|model|unit (без строки и без версии).
 */
function v12BuildPositionStableKey(row) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const code = String(row[P.MATERIAL_CODE - 1] || "").trim();
  const name = String(row[P.MATERIAL_NAME - 1] || "").trim();
  const model = String(row[P.MODEL - 1] || "").trim();
  const unit = String(row[P.UNIT - 1] || "").trim();
  return [code, name, model, unit].join("|");
}

/**
 * Сгенерировать уникальный positionId:
 *   bomId + ":" + materialKey, при дубликатах в рамках одного BOM —
 *   добавляется числовой суффикс (#2, #3, ...).
 * existingIds — Set уже занятых positionId в рамках этого BOM.
 */
function v12GeneratePositionId(bomId, materialKey, existingIds) {
  const bom = String(bomId || "").trim();
  const key = String(materialKey || "").trim() || "UNKNOWN";
  const base = bom + ":" + key;
  if (!existingIds || !existingIds.has(base)) {
    return base;
  }
  let n = 2;
  while (existingIds && existingIds.has(base + "#" + n)) {
    n++;
  }
  return base + "#" + n;
}

/**
 * Валидация позиции по ТЗ №8 (К4):
 * обязательны — Строка, Наименование, Модель, Ед.изм, Требуемое,
 * Зарезервировано (0 — валидный дефолт), Срок; Код — НЕ обязателен.
 */
function v12ValidatePosition(row) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const missing = {
    row: !String(row[P.BOM_ROW - 1] || "").trim(),
    name: !String(row[P.MATERIAL_NAME - 1] || "").trim(),
    model: !String(row[P.MODEL - 1] || "").trim(),
    unit: !String(row[P.UNIT - 1] || "").trim(),
    requiredQty: toNumber(row[P.REQUIRED_QTY - 1]) <= 0,
    deadline: !(row[P.DEADLINE - 1] !== "" && row[P.DEADLINE - 1] !== null && row[P.DEADLINE - 1] !== undefined)
  };
  missing.hasError = missing.row || missing.name || missing.model || missing.unit ||
    missing.requiredQty || missing.deadline;
  return { valid: !missing.hasError, missing: missing };
}

/**
 * Нормализация строки для сравнения (без регистра/пробелов).
 */
function v12Norm(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Единый нормализатор даты. Приводит любое значение к Date или null.
 *
 * Поддерживает:
 *   - Date;
 *   - число: 0/пусто → null; серийный номер даты Sheets (дни от 1899-12-30,
 *     примерно 1..2958465) → дата; крупное число → миллисекунды (timestamp);
 *   - строку: ""→null; «dd.MM.yyyy» → дата; ISO/иное → new Date, если валидна.
 *
 * ВАЖНО: без этого числовой серийный номер даты (например, 46 000)
 * трактовался бы как миллисекунды и давал 01.01.1970.
 */
function v12ToDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  // Число ИЛИ числовая строка. Числовая строка важна: серийный номер даты
  // Sheets может прийти как текст ("46290") — иначе new Date("46290") вернул
  // бы год 46290 (отображение «01.01.46290»).
  let num = null;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    num = Number(value.trim());
  }
  if (num !== null) {
    if (!isFinite(num) || num === 0) {
      return null;
    }
    // Серийный номер даты Google Sheets (дни от 1899-12-30).
    if (num > 0 && num < 2958466) {
      const d = new Date(1899, 11, 30);
      d.setDate(d.getDate() + Math.floor(num));
      return d;
    }
    const dn = new Date(num);
    return isNaN(dn.getTime()) ? null : dn;
  }

  const s = String(value).trim();
  if (!s) {
    return null;
  }
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Безопасное приведение к дате (для сравнения в расчётах).
 * Возвращает timestamp (число) или исходную строку, если дата не распознана.
 */
function v12DateValue(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }
  const d = v12ToDate(value);
  if (d) {
    return d.getTime();
  }
  return String(value).trim();
}
