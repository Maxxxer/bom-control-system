/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: export_engine.js
 *
 * Экспорт центра MATERIAL_STATE → BOM-файлы (Google Spreadsheet) в Drive.
 * Однонаправленная запись: центр → файлы. Импорт при этом НЕ запускается,
 * поэтому двусторонней петли и конфликтов нет.
 * =====================================================
 */

/**
 * Обновить все BOM-файлы (Google Spreadsheet) данными из MATERIAL_STATE.
 */
function exportBOMMaterialsToDrive() {
  const lock = acquireScriptLock();
  try {
    const files = getAllBOMFiles();
    let exported = 0;

    files.forEach((file) => {
      if (file.getMimeType() !== "application/vnd.google-apps.spreadsheet") {
        return;
      }
      exported += exportBOMFile(file);
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
 */
function exportBOMFile(file) {
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
    const idx = {
      row: findHeaderIndex(header, ["Строка", "BOM_ROW"]),
      reserved: findHeaderIndex(header, ["Зарезервировано", "RESERVED"]),
      ordered: findHeaderIndex(header, ["Заказано", "ORDERED"]),
      deadline: findHeaderIndex(header, ["Крайний срок поставки", "Крайний срок", "DEADLINE_DATE", "DEADLINE"]),
      expected: findHeaderIndex(header, ["Ожидаемая поставка", "EXPECTED_DATE", "EXPECTED"]),
      realDelivery: findHeaderIndex(header, ["Реальная поставка", "REAL_DELIVERY"]),
      status: findHeaderIndex(header, ["Статус", "STATUS"])
    };

    // Без колонки "Строка" сопоставление невозможно
    if (idx.row === -1) {
      logSystem("exportBOMFile", "В файле нет колонки «Строка»: " + file.getName(), "WARNING");
      return 0;
    }

    // Если нет ни одной целевой колонки — писать нечего
    if (
      idx.reserved === -1 && idx.ordered === -1 && idx.deadline === -1 &&
      idx.expected === -1 && idx.realDelivery === -1 && idx.status === -1
    ) {
      logSystem("exportBOMFile", "В файле нет целевых колонок: " + file.getName(), "WARNING");
      return 0;
    }

    const index = buildMaterialIndex();
    const C = V11_CONFIG.MATERIAL_COLUMNS;
    let count = 0;

    for (let i = 1; i < data.length; i++) {
      const rowNum = toNumber(data[i][idx.row]);
      if (!rowNum) {
        continue;
      }
      const material = findMaterialInBOM(bomName, rowNum, index);
      if (!material) {
        continue;
      }
      const values = material.values;

      if (idx.reserved !== -1) {
        sheet.getRange(i + 1, idx.reserved + 1).setValue(toNumber(values[C.RESERVED - 1]));
      }
      if (idx.ordered !== -1) {
        sheet.getRange(i + 1, idx.ordered + 1).setValue(toNumber(values[C.ORDERED - 1]));
      }
      if (idx.deadline !== -1) {
        sheet.getRange(i + 1, idx.deadline + 1).setValue(values[C.DEADLINE_DATE - 1] || "");
      }
      if (idx.expected !== -1) {
        sheet.getRange(i + 1, idx.expected + 1).setValue(values[C.EXPECTED_DATE - 1] || "");
      }
      if (idx.realDelivery !== -1) {
        sheet.getRange(i + 1, idx.realDelivery + 1).setValue(values[C.REAL_DELIVERY - 1] === true);
      }
      if (idx.status !== -1) {
        sheet.getRange(i + 1, idx.status + 1).setValue(values[C.STATUS - 1] || "");
      }

      count++;
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
