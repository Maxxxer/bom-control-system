/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: debug_engine.js
 *
 * Диагностика, тесты, статус-тест, Debug API.
 * Единственный debugMaterial (дубль устранён).
 * =====================================================
 */

/**
 * Общая диагностика системы.
 */
function debugSystemStatus() {
  const result = {
    version: V11_CONFIG.VERSION,
    timestamp: new Date(),
    sheets: {},
    materials: 0,
    errors: []
  };

  try {
    Object.keys(V11_CONFIG.SHEETS).forEach((key) => {
      const name = V11_CONFIG.SHEETS[key];
      result.sheets[key] = Boolean(SpreadsheetApp.getActive().getSheetByName(name));
    });

    const sheet = getSheetByKey("MATERIAL_STATE");
    result.materials = sheet.getLastRow() - 1;
  } catch (e) {
    result.errors.push(e.message);
  }
  return result;
}

/**
 * Проверка одного материала.
 */
function debugMaterial(materialId) {
  const material = getMaterialById(materialId);
  if (!material) {
    return { error: "Материал не найден" };
  }
  const row = material.values;
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  return {
    materialId: row[C.MATERIAL_ID - 1],
    status: row[C.STATUS - 1],
    state: row[C.STATE - 1],
    ordered: row[C.ORDERED - 1],
    deficit: row[C.DEFICIT - 1],
    realDelivery: row[C.REAL_DELIVERY - 1],
    received: row[C.RECEIVED - 1]
  };
}

/**
 * Проверка цветового движка.
 */
function debugColorEngine() {
  return {
    material: typeof colorMaterialStateRows === "function",
    deficit: typeof colorDeficitSummaryRows === "function",
    bom: typeof colorBOMStateRows === "function",
    statusColor: typeof getStatusColor === "function"
  };
}

/**
 * Полный тест обновления.
 */
function debugFullUpdate() {
  try {
    runFullUpdate();
    return { success: true, message: "Обновление выполнено" };
  } catch (e) {
    return { success: false, error: e.message, stack: e.stack };
  }
}

/**
 * Web API (doGet).
 */
function doGet(e) {
  const action = e.parameter && e.parameter.action;
  let result;
  switch (action) {
    case "status":
      result = debugSystemStatus();
      break;
    case "colors":
      result = debugColorEngine();
      break;
    case "update":
      result = debugFullUpdate();
      break;
    default:
      result = { error: "Unknown action" };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Главный тест V11.
 */
function runV11Debug() {
  const result = {
    version: V11_CONFIG.VERSION,
    time: new Date(),
    sheets: debugCheckSheets(),
    colors: debugCheckColors(),
    materials: debugCheckMaterials(),
    errors: []
  };

  try {
    result.sheets = debugCheckSheets();
    result.colors = debugCheckColors();
    result.materials = debugCheckMaterials();
  } catch (e) {
    result.errors.push(e.message);
  }

  logSystem("runV11Debug", "Диагностика завершена", result);
  SpreadsheetApp.getUi().alert("Диагностика V11 завершена.\nОшибок: " + result.errors.length);
  return result;
}

function debugCheckSheets() {
  const ss = SpreadsheetApp.getActive();
  const result = {};
  Object.keys(V11_CONFIG.SHEETS).forEach((key) => {
    result[key] = ss.getSheetByName(V11_CONFIG.SHEETS[key]) !== null;
  });
  return result;
}

function debugCheckColors() {
  const testStatuses = [
    "Ошибка данных",
    "Не заказано",
    "Не указана дата поставки",
    "Заказано частично",
    "Ожидаем (опаздывает)",
    "Ожидаем (в срок)",
    "На складе",
    "Получено производством",
    "Готов к производству"
  ];
  const result = {};
  testStatuses.forEach((status) => {
    result[status] = getStatusColor(status);
  });
  return result;
}

function debugCheckMaterials() {
  const sheet = getSheetByKey("MATERIAL_STATE");
  const data = readSheetValues(sheet);
  const result = { total: data.length - 1, received: 0, stock: 0, deficit: 0, partial: 0, waiting: 0 };
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  for (let i = 1; i < data.length; i++) {
    const status = data[i][C.STATUS - 1];
    switch (status) {
      case V11_CONFIG.MATERIAL_STATUS.RECEIVED:
        result.received++;
        break;
      case V11_CONFIG.MATERIAL_STATUS.STOCK:
        result.stock++;
        break;
      case V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED:
        result.deficit++;
        break;
      case V11_CONFIG.MATERIAL_STATUS.PARTIAL_ORDER:
        result.partial++;
        break;
      case V11_CONFIG.MATERIAL_STATUS.ORDERED_ON_TIME:
      case V11_CONFIG.MATERIAL_STATUS.ORDERED_LATE:
        result.waiting++;
        break;
    }
  }
  return result;
}

function debugRecalculateMaterial(materialId) {
  recalculateMaterialStatus(materialId);
  applyStatusColors();
  return debugMaterial(materialId);
}

/**
 * Тест цветовой логики статусов.
 */
function runV11StatusTest() {
  const testName = "runV11StatusTest";
  logSystem(testName, "Проверка цветов статусов", "INFO");

  const tests = [
    { status: "Ошибка данных", expected: V11_CONFIG.COLORS.GRAY },
    { status: "Не заказано", expected: V11_CONFIG.COLORS.RED },
    { status: "Не указана дата поставки", expected: V11_CONFIG.COLORS.RED },
    { status: "Заказано частично", expected: V11_CONFIG.COLORS.RED },
    { status: "Ожидаем (опаздывает)", expected: V11_CONFIG.COLORS.ORANGE },
    { status: "Ожидаем (в срок)", expected: V11_CONFIG.COLORS.YELLOW },
    { status: "На складе", expected: V11_CONFIG.COLORS.STOCK },
    { status: "Получено производством", expected: V11_CONFIG.COLORS.RECEIVED },
    { status: "Готов к производству", expected: V11_CONFIG.COLORS.READY }
  ];

  let errors = 0;
  tests.forEach((test) => {
    const result = getStatusColor(test.status);
    if (result !== test.expected) {
      errors++;
      logSystem(testName, "ОШИБКА: " + test.status + " ожидался " + test.expected + " получен " + result, "ERROR");
    } else {
      logSystem(testName, "OK: " + test.status + " = " + result, "INFO");
    }
  });

  logSystem(testName, "Тест статусов завершён. Ошибок: " + errors, "INFO");
  SpreadsheetApp.getUi().alert("Тест статусов завершён\n\nОшибок: " + errors);
}
