/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: color_engine.js
 *
 * Цветовое оформление. Единая карта цветов.
 * Исправлены маппинги BOM-статусов (PARTIAL → оранжевый, ORANGE → оранжевый).
 * =====================================================
 */

function applyStatusColors() {
  colorMaterialStateRows();
  colorDeficitSummaryRows();
  colorBOMStateRows();
}

/**
 * Справочник цветов. Срезает ведущие эмодзи/небуквенные символы.
 */
function getStatusColor(status) {
  if (!status) {
    return V11_CONFIG.COLORS.WHITE;
  }
  const normalized = String(status).replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, "").trim();

  switch (normalized) {
    // Красная зона
    case "Не заказано":
    case "Дата поставки неизвестна":
    case "Есть незаказанный материал":
    case "Есть незаказанные материалы":
    case "Заказано частично":
    case "Частично заказан":
      return V11_CONFIG.COLORS.RED;

    // Оранжевая зона
    case "Заказано (опаздывает)":
    case "Поставка позже срока":
    case "Просрочено":
    case "Просрочка поставки":
      return V11_CONFIG.COLORS.ORANGE;

    // Жёлтая зона
    case "Заказано (в срок)":
    case "Ожидается поставка":
    case "WAITING":
      return V11_CONFIG.COLORS.YELLOW;

    // Синяя зона (склад)
    case "На складе":
    case "STOCK":
      return V11_CONFIG.COLORS.STOCK;

    // Зелёная зона (получено)
    case "Получено":
    case "Получено производством":
    case "RECEIVED":
      return V11_CONFIG.COLORS.RECEIVED;

    // Зелёная зона (готово)
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

  const colors = data.map((row) => {
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
 * DEFICIT_SUMMARY
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

  const colors = data.map((row) => {
    const ordered = toNumber(row[D.ORDERED - 1]);
    const deficit = toNumber(row[D.DEFICIT - 1]);
    const expected = row[D.EXPECTED_DATE - 1];
    const deadline = row[D.DEADLINE_DATE - 1];
    const realDelivery = row[D.REAL_DELIVERY - 1] === true;
    const status = row[D.STATUS - 1];

    let color;
    if (status === V11_CONFIG.MATERIAL_STATUS.RECEIVED) {
      color = V11_CONFIG.COLORS.RECEIVED;
    } else if (realDelivery) {
      color = V11_CONFIG.COLORS.STOCK;
    } else if (deficit > 0 && ordered === 0) {
      color = V11_CONFIG.COLORS.RED;
    } else if (deficit > 0 && ordered > 0) {
      color = V11_CONFIG.COLORS.RED;
    } else if (expected && deadline && new Date(expected) > new Date(deadline)) {
      color = V11_CONFIG.COLORS.ORANGE;
    } else {
      color = getStatusColor(status);
    }
    return new Array(lastColumn).fill(color);
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
  const colors = data.map((row) =>
    new Array(lastColumn).fill(getStatusColor(row[V11_CONFIG.BOM_COLUMNS.STATUS - 1]))
  );
  range.setBackgrounds(colors);
}
