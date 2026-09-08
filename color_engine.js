/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: color_engine.js
 *
 * Цветовое оформление. Единая карта цветов.
 * По ТЗ серым подсвечиваются позиции с ошибками («Ошибка данных»).
 * =====================================================
 */

function applyStatusColors() {
  colorMaterialStateRows();
  colorDeficitSummaryRows();
  colorBOMStateRows();
}

/**
 * Справочник цвета по статусу.
 */
function getStatusColor(status) {
  if (!status) {
    return V11_CONFIG.COLORS.WHITE;
  }
  const normalized = String(status).replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, "").trim();

  switch (normalized) {
    // Серый — ошибка / неполные данные
    case "Ошибка данных":
      return V11_CONFIG.COLORS.GRAY;

    // Красная зона
    case "Не заказано":
    case "Не указана дата поставки":
    case "Заказано частично":
    case "Не обработан":
      return V11_CONFIG.COLORS.RED;

    // Оранжевая зона
    case "Ожидаем (опаздывает)":
    case "Частично отобран":
    case "Ожидание поставки (опаздывает)":
      return V11_CONFIG.COLORS.ORANGE;

    // Жёлтая зона
    case "Ожидаем (в срок)":
    case "Ожидание поставки (в срок)":
    case "WAITING":
      return V11_CONFIG.COLORS.YELLOW;

    // Синяя зона (склад)
    case "На складе":
    case "STOCK":
      return V11_CONFIG.COLORS.STOCK;

    // Зелёная зона (получено / готово)
    case "Получено":
    case "Получено производством":
    case "RECEIVED":
    case "Готов":
    case "Готов к производству":
    case "READY":
      return V11_CONFIG.COLORS.READY;

    default:
      return V11_CONFIG.COLORS.WHITE;
  }
}

/**
 * MATERIAL_STATE
 */
function colorMaterialStateRows() {
  const sheet = getSheetByKey("MATERIAL_STATE");
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2) {
    return;
  }
  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);
  const data = range.getValues();
  const C = V11_CONFIG.MATERIAL_COLUMNS;

  const colors = data.map(function (row) {
    const received = row[C.RECEIVED - 1] === true;
    const stock = row[C.REAL_DELIVERY - 1] === true;
    let color;
    if (received) {
      color = V11_CONFIG.COLORS.RECEIVED;
    } else if (stock) {
      color = V11_CONFIG.COLORS.STOCK;
    } else {
      color = getStatusColor(row[C.STATUS - 1]);
    }
    return new Array(lastColumn).fill(color);
  });

  range.setBackgrounds(colors);
}

/**
 * DEFICIT_SUMMARY (13 колонок)
 */
function colorDeficitSummaryRows() {
  const sheet = getSheetByKey("DEFICIT_SUMMARY");
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2) {
    return;
  }
  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);
  const data = range.getValues();
  const D = V11_CONFIG.DEFICIT_COLUMNS;

  const colors = data.map(function (row) {
    const status = row[D.STATUS - 1];
    return new Array(lastColumn).fill(getStatusColor(status));
  });

  range.setBackgrounds(colors);
}

/**
 * BOM_STATE (STATUS — колонка 9)
 */
function colorBOMStateRows() {
  const sheet = getSheetByKey("BOM_STATE");
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2) {
    return;
  }
  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);
  const data = range.getValues();
  const colors = data.map(function (row) {
    return new Array(lastColumn).fill(getStatusColor(row[V11_CONFIG.BOM_COLUMNS.STATUS - 1]));
  });
  range.setBackgrounds(colors);
}
