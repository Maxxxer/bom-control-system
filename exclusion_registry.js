/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: exclusion_registry.js
 *
 * Реестр «Выполнено» BOM. Чекбокс в дашборде ставится
 * только после «Готов к производству». При отметке BOM
 * убирается из дашборда и исключается из дальнейшего
 * сканирования (файл при этом НЕ изменяется).
 * =====================================================
 */

/**
 * Является ли BOM отмеченным «Выполнено».
 */
function isBOMDone(bom) {
  const sheet = getSheetByKey("EXCLUDED_BOMS");
  const data = readSheetValues(sheet);
  const id = normalizeMaterialId(bom);
  if (!id) {
    return false;
  }
  for (let i = 1; i < data.length; i++) {
    if (
      normalizeMaterialId(data[i][0]) === id &&
      data[i][1] === true
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Отметить/снять «Выполнено» для BOM.
 */
function setBOMDone(bom, done) {
  const sheet = getSheetByKey("EXCLUDED_BOMS");
  const id = normalizeMaterialId(bom);
  if (!id) {
    return;
  }
  const data = readSheetValues(sheet);
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (normalizeMaterialId(data[i][0]) === id) {
      foundRow = i + 1;
      break;
    }
  }
  if (done) {
    if (foundRow === -1) {
      sheet.appendRow([id, true, new Date()]);
    } else {
      sheet.getRange(foundRow, 2).setValue(true);
      sheet.getRange(foundRow, 3).setValue(new Date());
    }
  } else {
    if (foundRow !== -1) {
      sheet.getRange(foundRow, 2).setValue(false);
    }
  }
  logSystem("setBOMDone", (done ? "Отмечен «Выполнено»: " : "Снята отметка «Выполнено»: ") + id, "INFO");
}

/**
 * Список исключённых BOM (имён).
 */
function getExcludedBOMList() {
  const sheet = getSheetByKey("EXCLUDED_BOMS");
  const data = readSheetValues(sheet);
  const result = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === true) {
      result.push(normalizeMaterialId(data[i][0]));
    }
  }
  return result;
}

/**
 * Исключить выполненные BOM из сканирования.
 */
function filterExcludedBOMFiles(files) {
  const excluded = getExcludedBOMList();
  return files.filter(function (file) {
    const name = file.getName().replace(/\.[^/.]+$/, "");
    return excluded.indexOf(name) === -1;
  });
}
