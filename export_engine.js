/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: export_engine.js
 *
 * Экспорт центра MATERIAL_STATE → BOM-файлы (Google Spreadsheet) в Drive.
 * Однонаправленная запись: центр → файлы. Импорт при этом НЕ запускается,
 * поэтому двусторонней петли и конфликтов нет.
 *
 * ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ:
 *   - Индекс MATERIAL_STATE строится ОДИН раз на весь экспорт.
 *   - Запись ведётся ПО КОЛОНКАМ (одна операция setValues на колонку),
 *     а не по ячейке (было до 6 setValue на строку).
 *   - Строки без сопоставленного материала сохраняют свои текущие значения.
 * =====================================================
 */

/**
 * Обновить все BOM-файлы (Google Spreadsheet) данными из MATERIAL_STATE.
 */
function exportBOMMaterialsToDrive() {
  const lock = acquireScriptLock();
  try {
    const files = getAllBOMFiles();

    // Один раз читаем MATERIAL_STATE и строим индекс + карту bom→{row→material}
    const index = buildMaterialIndex();
    const C = V11_CONFIG.MATERIAL_COLUMNS;
    const bomLookup = {};

    for (const [id, m] of index) {
      if (!m.values) continue;
      const bom = normalizeMaterialId(m.values[C.BOM - 1]);
      const rowNum = toNumber(m.values[C.BOM_ROW - 1]);
      if (bom) {
        if (!bomLookup[bom]) {
          bomLookup[bom] = {};
        }
        bomLookup[bom][rowNum] = m;
      }
    }

    let exported = 0;

    files.forEach((file) => {
      if (file.getMimeType() !== "application/vnd.google-apps.spreadsheet") {
        return;
      }
      exported += exportBOMFile(file, bomLookup);
    });

    flushSheets();
    logSystem("exportBOMMaterialsToDrive", "Обновлено строк в BOM-файлах: " + exported, "INFO");
  } catch (error) {
    logSystem("exportBOMMaterialsToDrive", error.message, error, "ERROR");
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Обновить один BOM-файл данными из MATERIAL_STATE.
 * Возвращает количество обновлённых строк.
 * bomLookup (опц.): { bomName: { rowNum: material } } — чтобы не сканировать индекс на каждую строку.
 */
function exportBOMFile(file, bomLookup) {
  try {
    const bomName = file.getName().replace(/\.[^/.]+$/, "");
    const ss = SpreadsheetApp.openById(file.getId());
    const sheet = ss.getSheets()[0];
    if (!sheet) {
      return 0;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return 0;
    }

    const header = data[0].map((h) => normalizeMaterialId(h));
    const hi = {
      row: findHeaderIndex(header, ["Строка", "BOM_ROW"]),
      reserved: findHeaderIndex(header, ["Зарезервировано", "RESERVED"]),
      ordered: findHeaderIndex(header, ["Заказано", "ORDERED"]),
      deadline: findHeaderIndex(header, ["Крайний срок поставки", "Крайний срок", "DEADLINE_DATE", "DEADLINE"]),
      expected: findHeaderIndex(header, ["Ожидаемая поставка", "EXPECTED_DATE", "EXPECTED"]),
      realDelivery: findHeaderIndex(header, ["Реальная поставка", "REAL_DELIVERY"]),
      status: findHeaderIndex(header, ["Статус", "STATUS"])
    };

    // Без колонки "Строка" сопоставление невозможно
    if (hi.row === -1) {
      logSystem("exportBOMFile", "В файле нет колонки «Строка»: " + file.getName(), "WARNING");
      return 0;
    }

    // Если нет ни одной целевой колонки — писать нечего
    if (
      hi.reserved === -1 && hi.ordered === -1 && hi.deadline === -1 &&
      hi.expected === -1 && hi.realDelivery === -1 && hi.status === -1
    ) {
      logSystem("exportBOMFile", "В файле нет целевых колонок: " + file.getName(), "WARNING");
      return 0;
    }

    const C = V11_CONFIG.MATERIAL_COLUMNS;
    const lastCol = sheet.getLastColumn();
    const N = data.length - 1;
    const WHITE = V11_CONFIG.COLORS.WHITE;
    const lookup = bomLookup ? (bomLookup[normalizeMaterialId(bomName)] || {}) : null;
    // Если bomLookup не передан (одиночный вызов) — построим локальный индекс один раз
    const localIndex = lookup ? null : buildMaterialIndex();

    // Буферы колонок (параллельно строкам data[1..N])
    const col = {
      reserved: hi.reserved !== -1 ? new Array(N) : null,
      ordered: hi.ordered !== -1 ? new Array(N) : null,
      deadline: hi.deadline !== -1 ? new Array(N) : null,
      expected: hi.expected !== -1 ? new Array(N) : null,
      realDelivery: hi.realDelivery !== -1 ? new Array(N) : null,
      status: hi.status !== -1 ? new Array(N) : null
    };
    const colors = new Array(N);
    let count = 0;

    for (let i = 1; i < data.length; i++) {
      const j = i - 1;
      const rowNum = toNumber(data[i][hi.row]);
      const material = rowNum
        ? (lookup ? (lookup[rowNum] || null) : findMaterialInBOM(bomName, rowNum, localIndex))
        : null;
      const values = material ? material.values : null;

      if (col.reserved) {
        col.reserved[j] = values ? toNumber(values[C.RESERVED - 1]) : data[i][hi.reserved];
      }
      if (col.ordered) {
        col.ordered[j] = values ? toNumber(values[C.ORDERED - 1]) : data[i][hi.ordered];
      }
      if (col.deadline) {
        col.deadline[j] = values ? (values[C.DEADLINE_DATE - 1] || "") : data[i][hi.deadline];
      }
      if (col.expected) {
        col.expected[j] = values ? (values[C.EXPECTED_DATE - 1] || "") : data[i][hi.expected];
      }
      if (col.realDelivery) {
        col.realDelivery[j] = values ? (values[C.REAL_DELIVERY - 1] === true) : data[i][hi.realDelivery];
      }
      if (col.status) {
        col.status[j] = values ? (values[C.STATUS - 1] || "") : data[i][hi.status];
      }

      colors[j] = values
        ? new Array(lastCol).fill(getStatusColor(values[C.STATUS - 1]))
        : new Array(lastCol).fill(WHITE);

      if (values) {
        count++;
      }
    }

    // Запись колонок — по одной операции на колонку
    if (col.reserved) writeColumnValues(sheet, 2, hi.reserved + 1, N, col.reserved);
    if (col.ordered) writeColumnValues(sheet, 2, hi.ordered + 1, N, col.ordered);
    if (col.deadline) writeColumnValues(sheet, 2, hi.deadline + 1, N, col.deadline);
    if (col.expected) writeColumnValues(sheet, 2, hi.expected + 1, N, col.expected);
    if (col.realDelivery) writeColumnValues(sheet, 2, hi.realDelivery + 1, N, col.realDelivery);
    if (col.status) writeColumnValues(sheet, 2, hi.status + 1, N, col.status);

    // Раскраска строки одним вызовом
    if (colors.length === N) {
      sheet.getRange(2, 1, N, lastCol).setBackgrounds(colors);
    }

    if (count > 0) {
      SpreadsheetApp.flush();
    }
    return count;
  } catch (error) {
    logSystem("exportBOMFile", file.getName() + ": " + error.message, error, "ERROR");
    return 0;
  }
}

/**
 * Записать одну колонку значений (одна операция SpreadsheetApp).
 */
function writeColumnValues(sheet, startRow, col, numRows, values) {
  if (!values || numRows <= 0) {
    return;
  }
  const out = values.map((v) => [v === undefined || v === null ? "" : v]);
  sheet.getRange(startRow, col, numRows, 1).setValues(out);
}

/**
 * Поиск индекса колонки по списку возможных заголовков.
 */
function findHeaderIndex(headers, candidates) {
  for (let c = 0; c < candidates.length; c++) {
    const i = headers.indexOf(candidates[c]);
    if (i !== -1) {
      return i;
    }
  }
  return -1;
}
