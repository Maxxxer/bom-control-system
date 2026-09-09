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
 *
 * ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ:
 *   - Индекс MATERIAL_STATE строится ОДИН раз на всю операцию (syncAllBOM/importBOM).
 *   - Новые материалы и изменения пишутся БАТЧЕМ, а не по одному вызову.
 *   - История/события копятся в памяти и пишутся одним вызовом.
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
 * ОДИН общий контекст (лист + данные + индекс + lastRow) на все файлы — читаем лист один раз.
 */
function syncAllBOM() {
  const lock = acquireScriptLock();
  try {
    const files = getAllBOMFiles();

    // Общий контекст: читаем MATERIAL_STATE один раз для всех файлов
    const sheet = getSheetByKey("MATERIAL_STATE");
    const data = readSheetValues(sheet);
    const ctx = {
      sheet: sheet,
      data: data,
      index: buildMaterialIndex(data),
      lastRow: sheet.getLastRow()
    };

    files.forEach((file) => {
      importBOMFile(file, ctx);
    });

    refreshAfterChange();
    logSystem("syncAllBOM", "Все BOM синхронизированы", "INFO");
  } catch (error) {
    logSystem("syncAllBOM", error.message, error, "ERROR");
    throw error;
  } finally {
    lock.releaseLock();
    flushSystemLog();
  }
}

/**
 * Импорт одного файла Drive.
 * Опциональный ctx — общий контекст для батч-импорта (см. syncAllBOM).
 */
function importBOMFile(file, ctx) {
  try {
    const bomData = parseBOMFile(file);
    if (!bomData || !bomData.name || !bomData.materials) {
      logSystem("importBOMFile", "Файл пропущен (нет данных): " + file.getName(), "WARNING");
      return;
    }
    importBOM(bomData, ctx);
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
 * Собрать новую строку MATERIAL_STATE для материала из BOM.
 * Статус/дефицит/состояние вычисляются ДО записи, чтобы не делать повторный проход.
 */
function buildNewMaterialRow(material, version) {
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  const row = new Array(V11_CONFIG.COLUMN_COUNT.MATERIAL_STATE).fill("");
  const materialId = generateMaterialId(material.bom, version, material.row);

  row[C.MATERIAL_ID - 1] = materialId;
  row[C.BOM - 1] = material.bom;
  row[C.BOM_VERSION - 1] = version || "V1";
  row[C.BOM_ROW - 1] = material.row || 0;
  row[C.MATERIAL_CODE - 1] = material.code || "";
  row[C.MATERIAL_NAME - 1] = material.name || "";
  row[C.UNIT - 1] = material.unit || "";
  row[C.REQUIRED - 1] = toNumber(material.required || 0);
  row[C.RESERVED - 1] = toNumber(material.reserved || 0);
  row[C.ORDERED - 1] = 0;
  row[C.DEFICIT - 1] = 0;
  row[C.EXPECTED_DATE - 1] = "";
  row[C.DEADLINE_DATE - 1] = material.deadline || "";
  row[C.REAL_DELIVERY - 1] = false;
  row[C.REAL_DELIVERY_DATE - 1] = "";
  row[C.RECEIVED - 1] = false;
  row[C.RECEIVED_DATE - 1] = "";
  row[C.RECEIVED_USER - 1] = "";
  row[C.STATUS - 1] = V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED;
  row[C.STATE - 1] = V11_CONFIG.MATERIAL_STATE.DEFICIT;
  row[C.UPDATED - 1] = new Date();

  const status = computeMaterialStatus(row);
  row[C.DEFICIT - 1] = status.deficit;
  row[C.STATUS - 1] = status.status;
  row[C.STATE - 1] = status.state;

  return row;
}

/**
 * Основной импорт BOM-данных (батч).
 * bomData: { name, materials: [...] }
 * ctx (опц.): { sheet, data, index, lastRow } — общий контекст для нескольких файлов.
 *
 * Отличие от прежней версии:
 *   - индекс строится один раз (через ctx или через переданные data)
 *   - новые материалы пишутся одним writeValues
 *   - изменения существующих — одним batchWrite
 *   - история/события — appendHistoryRows/appendEventRows одним вызовом
 */
function importBOM(bomData, ctx) {
  try {
    const bomName = bomData.name;
    const version = createBOMVersion(bomName);
    const materials = bomData.materials || [];
    if (!materials.length) {
      return;
    }

    const C = V11_CONFIG.MATERIAL_COLUMNS;
    const sheet = ctx ? ctx.sheet : getSheetByKey("MATERIAL_STATE");
    const data = ctx ? ctx.data : readSheetValues(sheet);
    const index = ctx ? ctx.index : buildMaterialIndex(data);

    const newRows = [];
    const allUpdates = [];
    const eventRows = [];
    const historyRows = [];

    materials.forEach((material) => {
      const exists = findMaterialInBOM(bomName, material.row, index);

      if (!exists) {
        const row = buildNewMaterialRow(material, version);
        const materialId = row[C.MATERIAL_ID - 1];
        // Внутри одного прохода не добавляем дубль (тот же ID уже создан)
        if (index.has(materialId)) {
          return;
        }
        newRows.push(row);
        index.set(materialId, { row: -1, values: row });
        historyRows.push([
          new Date(), materialId, V11_CONFIG.EVENTS.BOM_MATERIAL_ADDED, "", "",
          getCurrentUser(), "Добавлен материал из BOM"
        ]);
        return;
      }

      // Материал добавлен в этом же проходе (row = -1) — пропускаем дубль
      if (exists.row < 0) {
        return;
      }

      // Существующий материал — сравнение и изменение
      const old = exists.values;
      const oldQty = toNumber(old[C.REQUIRED - 1]);
      const oldName = old[C.MATERIAL_NAME - 1];
      const oldReserved = toNumber(old[C.RESERVED - 1]);
      const newQty = toNumber(material.qty);
      const newReserved = toNumber(material.reserved);

      const newRow = old.slice();
      let changed = false;

      if (oldQty !== newQty) {
        newRow[C.REQUIRED - 1] = newQty;
        changed = true;
        eventRows.push({
          date: new Date(),
          id: generateEventId(),
          type: V11_CONFIG.EVENTS.BOM_QTY_CHANGED,
          materialId: exists.id,
          bom: bomName,
          user: getCurrentUser(),
          data: JSON.stringify({ oldValue: oldQty, newValue: newQty })
        });
        historyRows.push([
          new Date(), exists.id, V11_CONFIG.EVENTS.BOM_QTY_CHANGED, oldQty, newQty,
          getCurrentUser(), "Изменено количество BOM"
        ]);
      }
      if (String(oldName) !== String(material.name)) {
        eventRows.push({
          date: new Date(),
          id: generateEventId(),
          type: V11_CONFIG.EVENTS.BOM_NAME_CHANGED,
          materialId: exists.id,
          bom: bomName,
          user: getCurrentUser(),
          data: JSON.stringify({ oldValue: oldName, newValue: material.name })
        });
      }
      if (oldReserved !== newReserved) {
        newRow[C.RESERVED - 1] = newReserved;
        changed = true;
      }

      if (changed) {
        const status = computeMaterialStatus(newRow);
        newRow[C.DEFICIT - 1] = status.deficit;
        newRow[C.STATUS - 1] = status.status;
        newRow[C.STATE - 1] = status.state;
        newRow[C.UPDATED - 1] = new Date();

        // Записываем ТОЛЬКО реально изменившиеся колонки
        [C.REQUIRED, C.RESERVED, C.DEFICIT, C.STATUS, C.STATE, C.UPDATED].forEach((col) => {
          if (newRow[col - 1] !== old[col - 1]) {
            allUpdates.push({ row: exists.row, col: col, value: newRow[col - 1] });
          }
        });
      }
    });

    // Запись новых строк одним батчем
    if (newRows.length) {
      const appendStartRow = ctx ? (ctx.lastRow + 1) : (sheet.getLastRow() + 1);
      writeValues(sheet, appendStartRow, 1, newRows);
      newRows.forEach((r, i) => {
        const materialId = r[C.MATERIAL_ID - 1];
        index.set(materialId, { row: appendStartRow + i, values: r });
      });
      if (ctx) {
        ctx.lastRow = appendStartRow + newRows.length - 1;
        ctx.data = ctx.data.concat(newRows);
      }
    }

    // Применение изменений существующих материалов одним батчем
    if (allUpdates.length) {
      batchWrite(sheet, allUpdates);
    }

    // История и события — одним вызовом
    if (historyRows.length) {
      appendHistoryRows(historyRows);
    }
    if (eventRows.length) {
      appendEventRows(eventRows);
    }

    logSystem(
      "importBOM",
      "BOM: " + bomName + ", новых: " + newRows.length + ", изменено: " + allUpdates.length,
      "INFO"
    );
  } catch (error) {
    logSystem("importBOM", error.message, error, "ERROR");
    throw error;
  }
}

/**
 * Сравнение изменений материала при импорте (одиночные вызовы, без батч-контекста).
 * Обновляет требуемое кол-во, наименование и «Зарезервировано».
 * Передаём index, чтобы не перечитывать лист.
 */
function compareMaterialChange(oldMaterial, newMaterial, index) {
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
    updateMaterialState(oldMaterial.id, { RESERVED: newMaterial.reserved }, index);
    recalculateMaterialDeficit(oldMaterial.id, index);
  }
}
