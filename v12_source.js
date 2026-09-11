/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_source.js
 *
 * Чтение ИСХОДНЫХ BOM из Drive — ТОЛЬКО на чтение (ТЗ №3, №136).
 * Система НЕ перезаписывает источник. Исходные BOM — единственный
 * источник потребности и резервирования (ТЗ №13).
 * =====================================================
 */

/**
 * Карта исключённых BOM («Выполнено») — одно чтение листа.
 */
function v12BuildExcludedMap() {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.EXCLUDED_BOMS);
  if (!sheet) {
    return {};
  }
  const data = readSheetValues(sheet);
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (v12IsChecked(data[i][V12_CONFIG.EXCLUDED_BOMS_COLUMNS.DONE - 1])) {
      const id = normalizeMaterialId(data[i][V12_CONFIG.EXCLUDED_BOMS_COLUMNS.BOM_ID - 1]);
      if (id) {
        map[id] = true;
      }
    }
  }
  return map;
}

/**
 * Список исходных BOM-файлов (без исключённых «Выполнено»).
 */
function v12ListSourceBOMFiles() {
  const folderId = V12_CONFIG.DRIVE.FOLDER_ID;
  if (!folderId) {
    throw new Error("Не задан FOLDER_ID в V12_CONFIG.DRIVE");
  }
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const allowed = V12_CONFIG.DRIVE.ALLOWED_MIME;
  const result = [];
  while (files.hasNext()) {
    const file = files.next();
    if (allowed.indexOf(file.getMimeType()) !== -1) {
      result.push(file);
    }
  }
  const excluded = v12BuildExcludedMap();
  return result.filter(function (file) {
    const name = file.getName().replace(/\.[^/.]+$/, "");
    return excluded[name] !== true;
  });
}

/**
 * Прочитать и распарсить один исходный BOM-файл.
 * Возвращает { bomName, sourceSpreadsheetId, sourceSheetName, materials: [...] }.
 */
function v12ReadSourceBOM(file) {
  if (!file) {
    return null;
  }
  const mime = file.getMimeType();
  let rows;
  let ss;
  if (mime === "application/vnd.google-apps.spreadsheet") {
    ss = SpreadsheetApp.openById(file.getId());
    const sheet = ss.getSheets()[0];
    rows = sheet.getDataRange().getValues();
  } else if (mime === "text/csv") {
    const text = file.getBlob().getDataAsString();
    rows = text.split(/\r?\n/)
      .filter(function (l) { return l.length > 0; })
      .map(function (l) { return l.split(";").map(function (c) { return c.trim(); }); });
  } else {
    throw new Error("Неподдерживаемый формат: " + mime);
  }
  const bomName = file.getName().replace(/\.[^/.]+$/, "");
  return {
    bomName: bomName,
    sourceSpreadsheetId: file.getId(),
    sourceSheetName: (mime === "application/vnd.google-apps.spreadsheet") ? ss.getSheets()[0].getName() : "CSV",
    materials: v12ParseSourceRows(rows)
  };
}

/**
 * Парсинг строк исходного BOM в канонический вид (ТЗ №8):
 * Строка, Код, Наименование, Модель, Ед.изм, Требуется, Зарезервировано, Срок.
 */
function v12ParseSourceRows(rows) {
  if (!rows || rows.length < 2) {
    return [];
  }
  const header = rows[0].map(function (h) { return normalizeMaterialId(h); });
  const idx = {
    row: v12FindHeader(header, ["Строка", "BOM_ROW", "№"]),
    code: v12FindHeader(header, ["Код", "Код материала", "CODE"]),
    name: v12FindHeader(header, ["Наименование", "Название", "NAME"]),
    model: v12FindHeader(header, ["Модель", "MODEL"]),
    unit: v12FindHeader(header, ["Ед.изм", "Ед. изм", "UNIT"]),
    qty: v12FindHeader(header, ["Требуется", "Количество", "REQUIRED", "QTY"]),
    reserved: v12FindHeader(header, ["Зарезервировано", "RESERVED"]),
    deadline: v12FindHeader(header, ["Крайний срок", "Срок", "DEADLINE"])
  };
  if (idx.row === -1 || idx.name === -1) {
    return [];
  }
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[idx.name] || "").trim();
    if (!name) {
      continue;
    }
    result.push({
      row: idx.row !== -1 ? toNumber(r[idx.row]) : i,
      code: idx.code !== -1 ? String(r[idx.code] || "").trim() : "",
      name: name,
      model: idx.model !== -1 ? String(r[idx.model] || "").trim() : "",
      unit: idx.unit !== -1 ? String(r[idx.unit] || "").trim() : "",
      requiredQty: idx.qty !== -1 ? toNumber(r[idx.qty]) : 0,
      reservedQty: idx.reserved !== -1 ? toNumber(r[idx.reserved]) : 0,
      deadline: idx.deadline !== -1 ? r[idx.deadline] : ""
    });
  }
  return result;
}

/**
 * Найти индекс колонки по списку кандидатов (case-insensitive, нормализованный).
 */
function v12FindHeader(headers, candidates) {
  for (let c = 0; c < candidates.length; c++) {
    const idx = headers.indexOf(candidates[c]);
    if (idx !== -1) {
      return idx;
    }
  }
  // Повторный проход без регистра
  const norm = headers.map(function (h) { return v12Norm(h); });
  for (let c = 0; c < candidates.length; c++) {
    const idx = norm.indexOf(v12Norm(candidates[c]));
    if (idx !== -1) {
      return idx;
    }
  }
  return -1;
}

/**
 * Хеш данных исходного BOM (для определения изменения ревизии).
 */
function v12HashSourceData(materials) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    JSON.stringify(materials),
    Utilities.Charset.UTF_8
  ).map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");
}

/**
 * Зарегистрировать/обновить BOM в BOM_REGISTRY по данным источника.
 * Возвращает { bomId, created, changed }.
 */
function v12UpsertSourceBOM(source, registryIndex) {
  // registryIndex передаётся вызывающим для массовой синхронизации — чтобы не
  // перечитывать BOM_REGISTRY на каждый BOM. При одиночном вызове строится сам.
  const registry = registryIndex || v12BuildBomRegistryIndex();
  const B = V12_CONFIG.BOM_REGISTRY_COLUMNS;
  let reg;

  // Ищем по имени BOM (bomName) — стабильный ключ для источника
  for (const [id, m] of registry) {
    if (v12Norm(m.values[B.BOM_NAME - 1]) === v12Norm(source.bomName)) {
      reg = m;
      break;
    }
  }

  const bomId = reg ? reg.values[B.BOM_ID - 1] : source.bomName;
  const hash = v12HashSourceData(source.materials);

  if (!reg) {
    // Новая BOM — создаём запись
    const sheet = v12GetSheetByKey("BOM_REGISTRY");
    const row = new Array(V12_CONFIG.COLUMN_COUNT.BOM_REGISTRY).fill("");
    row[B.BOM_ID - 1] = bomId;
    row[B.SOURCE_SPREADSHEET_ID - 1] = source.sourceSpreadsheetId;
    row[B.SOURCE_SHEET_NAME - 1] = source.sourceSheetName;
    row[B.WORKING_SPREADSHEET_ID - 1] = "";
    row[B.BOM_NAME - 1] = source.bomName;
    row[B.ACTIVE - 1] = true;
    row[B.COMPLETED_FLAG - 1] = false;
    row[B.SOURCE_REVISION - 1] = 1;
    row[B.LAST_HASH - 1] = hash;
    row[B.LAST_SYNC_AT - 1] = new Date();
    row[B.DIRTY - 1] = true;
    row[B.UPDATED_AT - 1] = new Date();
    appendRow(sheet, row);
    v12AppendBomRevision(bomId, 1);
    return { bomId: bomId, created: true, changed: true };
  }

  // Существующая — сравниваем hash
  const changed = String(reg.values[B.LAST_HASH - 1]) !== hash;
  const update = {
    SOURCE_SPREADSHEET_ID: source.sourceSpreadsheetId,
    SOURCE_SHEET_NAME: source.sourceSheetName,
    LAST_SYNC_AT: new Date()
  };
  if (changed) {
    update.LAST_HASH = hash;
    update.SOURCE_REVISION = toNumber(reg.values[B.SOURCE_REVISION - 1]) + 1;
    update.DIRTY = true;
  }
  v12UpdateBomRegistry(bomId, update, registry);
  if (changed) {
    v12AppendBomRevision(bomId, update.SOURCE_REVISION);
  }
  return { bomId: bomId, created: false, changed: changed };
}

/**
 * Зафиксировать ревизию BOM в BOM_REVISION.
 *
 * Проекции читают самую раннюю запись как «дату создания» BOM
 * (Dashboard «Дата создания», «Дата поставки» в ОТБОРКЕ у позиций,
 * закрытых резервом BOM). Без этой записи обе колонки всегда пусты.
 */
function v12AppendBomRevision(bomId, revision) {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.BOM_REVISION);
  if (!sheet) {
    return;
  }
  const R = V12_CONFIG.BOM_REVISION_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.BOM_REVISION).fill("");
  row[R.DATE - 1] = new Date();
  row[R.BOM_ID - 1] = bomId;
  row[R.REVISION - 1] = revision;
  row[R.USER - 1] = getCurrentUser();
  appendRow(sheet, row);
}
