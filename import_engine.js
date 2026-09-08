/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: import_engine.js
 *
 * Импорт BOM из папки Google Drive.
 * getAllBOMFiles() перебирает файлы в папке V11_CONFIG.DRIVE.FOLDER_ID.
 * По ТЗ экономист вводит «Зарезервировано» в колонке BOM-файла.
 * BOM, отмеченные «Выполнено», исключаются из сканирования.
 * =====================================================
 */

/**
 * Получить все актуальные BOM-файлы из папки Drive.
 * Возвращает массив файлов, допустимых по типу, без исключённых.
 */
function getAllBOMFiles() {
  const folderId = V11_CONFIG.DRIVE.FOLDER_ID;
  if (!folderId) {
    logSystem("getAllBOMFiles", "Не задан FOLDER_ID в V11_CONFIG.DRIVE", "ERROR");
    throw new Error("Не задан ID папки Drive для импорта BOM");
  }

  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const result = [];
  const allowed = V11_CONFIG.DRIVE.ALLOWED_MIME;

  while (files.hasNext()) {
    const file = files.next();
    const mime = file.getMimeType();
    if (allowed.indexOf(mime) !== -1) {
      result.push(file);
    }
  }

  // ТЗ: BOM, отмеченные «Выполнено», исключаются из дальнейшего сканирования
  const filtered = filterExcludedBOMFiles(result);

  logSystem("getAllBOMFiles", "Найдено BOM-файлов (без исключённых): " + filtered.length, "INFO");
  return filtered;
}

/**
 * Синхронизация всех BOM из папки Drive.
 */
function syncAllBOM() {
  const lock = acquireScriptLock();
  try {
    const files = getAllBOMFiles();
    files.forEach((file) => {
      importBOMFile(file);
    });
    refreshAfterChange();
    logSystem("syncAllBOM", "Все BOM синхронизированы", "INFO");
  } catch (error) {
    logSystem("syncAllBOM", error.message, error, "ERROR");
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Импорт одного файла Drive.
 */
function importBOMFile(file) {
  try {
    const bomData = parseBOMFile(file);
    if (!bomData || !bomData.name || !bomData.materials) {
      logSystem("importBOMFile", "Файл пропущен (нет данных): " + file.getName(), "WARNING");
      return;
    }
    importBOM(bomData);
  } catch (error) {
    logSystem("importBOMFile", file.getName() + ": " + error.message, error, "ERROR");
  }
}

/**
 * Парсинг BOM-файла.
 * Авто-детект: Google Spreadsheet или CSV.
 */
function parseBOMFile(file) {
  const mime = file.getMimeType();
  let rows;

  if (mime === "application/vnd.google-apps.spreadsheet") {
    rows = readSpreadsheet(file);
  } else if (mime === "text/csv") {
    rows = readCSV(file);
  } else {
    throw new Error("Неподдерживаемый формат файла: " + mime);
  }

  if (!rows || rows.length < 2) {
    throw new Error("Файл пуст или без данных");
  }

  // Первая строка — заголовки; ищем колонки по имени (RU/EN)
  const header = rows[0].map((h) => normalizeMaterialId(h));
  const idx = {
    row: header.indexOf("Строка") !== -1 ? header.indexOf("Строка") : header.indexOf("BOM_ROW"),
    code: header.indexOf("Код") !== -1 ? header.indexOf("Код") : header.indexOf("CODE"),
    name: header.indexOf("Наименование") !== -1 ? header.indexOf("Наименование") : header.indexOf("NAME"),
    unit: header.indexOf("Ед.изм") !== -1 ? header.indexOf("Ед.изм") : header.indexOf("UNIT"),
    qty: header.indexOf("Требуется") !== -1 ? header.indexOf("Требуется") : header.indexOf("REQUIRED"),
    deadline: header.indexOf("Крайний срок") !== -1 ? header.indexOf("Крайний срок") : header.indexOf("DEADLINE"),
    reserved: header.indexOf("Зарезервировано") !== -1 ? header.indexOf("Зарезервировано") : header.indexOf("RESERVED")
  };

  const materials = [];
  const nameCol = idx.name;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) {
      continue;
    }
    const name = nameCol !== -1 ? String(r[nameCol] || "").trim() : "";
    if (!name) {
      continue;
    }
    materials.push({
      row: idx.row !== -1 ? toNumber(r[idx.row]) : i,
      code: idx.code !== -1 ? r[idx.code] : "",
      name: name,
      unit: idx.unit !== -1 ? r[idx.unit] : "",
      qty: idx.qty !== -1 ? toNumber(r[idx.qty]) : 0,
      deadline: idx.deadline !== -1 ? r[idx.deadline] : "",
      reserved: idx.reserved !== -1 ? toNumber(r[idx.reserved]) : 0
    });
  }

  return {
    name: file.getName().replace(/\.[^/.]+$/, ""),
    materials: materials
  };
}

/**
 * Чтение Google Spreadsheet.
 */
function readSpreadsheet(file) {
  const ss = SpreadsheetApp.openById(file.getId());
  const sheet = ss.getSheets()[0];
  return sheet.getDataRange().getValues();
}

/**
 * Чтение CSV-файла через Drive API.
 */
function readCSV(file) {
  const blob = file.getBlob();
  const text = blob.getDataAsString();
  const lines = text.split(/\r?\n/);
  return lines
    .filter((l) => l.length > 0)
    .map((l) => l.split(";").map((c) => c.trim()));
}

/**
 * Основной импорт BOM-данных.
 * bomData: { name, materials: [...] }
 */
function importBOM(bomData) {
  try {
    const bomName = bomData.name;
    const version = createBOMVersion(bomName);
    const materials = bomData.materials || [];

    materials.forEach((material) => {
      const exists = findMaterialInBOM(bomName, material.row);
      if (!exists) {
        addMaterialFromBOM({
          bom: bomName,
          version: version,
          row: material.row,
          code: material.code,
          name: material.name,
          unit: material.unit,
          required: material.qty,
          deadline: material.deadline,
          reserved: material.reserved
        });
      } else {
        compareMaterialChange(exists, material);
      }
    });

    createEvent(V11_CONFIG.EVENTS.BOM_IMPORTED, { bom: bomName, version: version });
    refreshAfterChange();
  } catch (error) {
    logSystem("importBOM", error.message, error, "ERROR");
    throw error;
  }
}

/**
 * Сравнение изменений материала при импорте.
 * Обновляет требуемое кол-во, наименование и «Зарезервировано».
 */
function compareMaterialChange(oldMaterial, newMaterial) {
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  const oldQty = toNumber(oldMaterial.values[C.REQUIRED - 1]);
  if (oldQty !== toNumber(newMaterial.qty)) {
    createEvent(V11_CONFIG.EVENTS.BOM_QTY_CHANGED, {
      materialId: oldMaterial.id,
      oldValue: oldQty,
      newValue: newMaterial.qty
    });
  }
  const oldName = oldMaterial.values[C.MATERIAL_NAME - 1];
  if (String(oldName) !== String(newMaterial.name)) {
    createEvent(V11_CONFIG.EVENTS.BOM_NAME_CHANGED, {
      materialId: oldMaterial.id,
      oldValue: oldName,
      newValue: newMaterial.name
    });
  }
  // «Зарезервировано» (введено экономистом) может обновиться
  const oldReserved = toNumber(oldMaterial.values[C.RESERVED - 1]);
  if (oldReserved !== toNumber(newMaterial.reserved)) {
    updateMaterialState(oldMaterial.id, { RESERVED: newMaterial.reserved });
    recalculateMaterialDeficit(oldMaterial.id);
  }
}
