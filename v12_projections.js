/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_projections.js
 *
 * Проекции (ТЗ №33–№47, №68–№71):
 *   DEFICIT_SUMMARY — для снабжения;
 *   ОТБОРКА (PICKING) — для кладовщика/производства;
 *   WORKING BOM — периодический документ на BOM;
 *   СНАБЖЕНИЕ (SUPPLY) — агрегация по materialKey;
 *   DASHBOARD — сводка по BOM.
 *
 * К2: маппинг supplyState/productionState -> BOM-статус дашборда.
 * К7: обновление только затронутых (incremental) — здесь пересборка
 *     по флагам dirty (полную сверку оставляем для debug).
 * =====================================================
 */

/**
 * Пересчитать и записать ВСЕ проекции (после массовых операций).
 */
function v12RefreshAllProjections() {
  v12RefreshDeficitSummary();
  v12RefreshPicking();
  v12RefreshWorkingBOM();
  v12RefreshSupply();
  v12RefreshDashboard();
}

/**
 * Обновить только затронутые проекции после единичной операции (dirty).
 */
function v12RefreshProjections() {
  // Лёгкая версия: пересчитываем всё (для корректности), т.к. объёмы
  // на старте малы. Для 40k строк — перевести на dirty-флаги (К7).
  v12RefreshDeficitSummary();
  v12RefreshPicking();
  v12RefreshWorkingBOM();
  v12RefreshSupply();
  v12RefreshDashboard();
}

/**
 * Формат «только дата» (dd.MM.yyyy) — в проекциях колонки дат не содержат времени.
 */
function v12FormatDateOnly(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }
  // Нормализуем через v12ToDate: корректно обрабатывает Date, «dd.MM.yyyy»,
  // ISO и числовой серийный номер даты Sheets (иначе число дало бы 01.01.1970).
  const d = v12ToDate(value);
  if (!d) {
    return String(value);
  }
  const dd = ("0" + d.getDate()).slice(-2);
  const mm = ("0" + (d.getMonth() + 1)).slice(-2);
  const yyyy = d.getFullYear();
  return dd + "." + mm + "." + yyyy;
}

/**
 * Активна ли позиция для «Сводки дефицитов» (проходит фильтр проекции).
 * Фильтр НЕ зависит от «Заказано»/«Ожидаемой поставки», поэтому правки
 * этих полей не меняют состав строк сводки — это позволяет обновлять
 * сводку построчно, не пересобирая весь лист.
 */
function v12IsDeficitRowActive(r) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const lc = r[P.LIFECYCLE_STATE - 1];
  if (lc === V12_CONFIG.LIFECYCLE_STATE.ARCHIVED || lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
    return false;
  }
  if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) {
    return false;
  }
  const requiredQty = toNumber(r[P.REQUIRED_QTY - 1]);
  const availableQty = toNumber(r[P.RESERVED_QTY - 1]) + toNumber(r[P.REAL_DELIVERY_QTY - 1]);
  if (availableQty >= requiredQty || toNumber(r[P.DEFICIT_QTY - 1]) <= 0) {
    return false;   // материал на складе или нет дефицита — в сводку не берём
  }
  return true;
}

/**
 * Собрать строку «Сводки дефицитов» из строки POSITION_STATE.
 */
function v12BuildDeficitRow(r) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  return [
    r[P.POSITION_ID - 1],
    r[P.BOM_NAME - 1],
    r[P.BOM_ROW - 1],
    r[P.MATERIAL_CODE - 1],
    r[P.MATERIAL_NAME - 1],
    r[P.MODEL - 1],
    r[P.UNIT - 1],
    r[P.DEFICIT_QTY - 1],
    r[P.ORDERED_QTY - 1],
    v12FormatDateOnly(r[P.EXPECTED_DATE - 1]),
    v12FormatDateOnly(r[P.DEADLINE - 1]),
    false, // REAL_DELIVERY checkbox
    r[P.UNCOVERED_NEED - 1],
    v12DeficitStatusDisplay(r)
  ];
}

/**
 * Флаг: идёт подбор необработанных правок из листа сводки (защита от рекурсии).
 */
let _v12Harvesting = false;

/**
 * Разобрать дату из ячейки сводки. Поддерживает Date и формат dd.MM.yyyy
 * (в сводке даты отображаются как «dd.MM.yyyy», JavaScript их так не парсит).
 * Возвращает Date или null.
 */
function v12ParseSummaryDate(value) {
  // Единый нормализатор: Date, «dd.MM.yyyy», ISO и числовой серийный номер Sheets.
  return v12ToDate(value);
}

/**
 * Подобрать необработанные правки из «Сводки дефицитов» в POSITION_STATE.
 *
 * Страховка от пропущенных/задержанных onEdit: значение, введённое в сводку,
 * уже есть в листе — здесь оно переносится в POSITION_STATE ДО перезаписи
 * сводки, поэтому не теряется (и не затирает соседнюю ячейку строки).
 * В обычном состоянии значения совпадают и функция ничего не меняет.
 */
function v12HarvestDeficitInput(skip) {
  if (_v12Harvesting) {
    return;
  }
  _v12Harvesting = true;
  try {
    const sheet = getSheetByName(V12_CONFIG.SHEETS.DEFICIT_SUMMARY);
    if (!sheet) {
      return;
    }
    const D = V12_CONFIG.DEFICIT_COLUMNS;
    const P = V12_CONFIG.POSITION_COLUMNS;
    const M = V12_CONFIG.MATERIAL_COLUMNS;
    const data = readSheetValues(sheet);
    if (data.length < 2) {
      return;
    }
    const index = v12BuildPositionIndex();
    const posSheet = v12GetSheetByKey("POSITION_STATE");
    const writes = [];
    // Складские дельты от «реальной поставки», подобранной из чекбоксов.
    const warehouseDelta = {};
    // Колонка, которая только что зафиксирована этой правкой, не подбирается
    // из листа (иначе сотрёт её же значение, т.к. лист перезаписывается позже).
    const skipPid = skip && skip.positionId ? normalizeMaterialId(skip.positionId) : "";
    const skipKey = skip && skip.key ? skip.key : "";

    for (let i = 1; i < data.length; i++) {
      const pid = normalizeMaterialId(data[i][D.POSITION_ID - 1]);
      if (!pid) {
        continue;
      }
      const pos = index.get(pid);
      if (!pos) {
        continue;
      }
      const rowVals = pos.values.slice();
      let changed = false;
      let realDelta = 0;

      const orderedSheet = toNumber(data[i][D.ORDERED_QTY - 1]);
      const skipOrdered = (pid === skipPid && skipKey === "ORDERED_QTY");
      if (!skipOrdered && orderedSheet !== toNumber(pos.values[P.ORDERED_QTY - 1])) {
        rowVals[P.ORDERED_QTY - 1] = orderedSheet;
        changed = true;
      }
      const expDate = v12ParseSummaryDate(data[i][D.EXPECTED_DATE - 1]);
      const skipExpected = (pid === skipPid && skipKey === "EXPECTED_DATE");
      if (!skipExpected && expDate && expDate.getTime() !== v12DateValue(pos.values[P.EXPECTED_DATE - 1])) {
        rowVals[P.EXPECTED_DATE - 1] = expDate;
        changed = true;
      }

      // Чекбокс «Реальная поставка» — страховка от потери массовых отметок:
      // если строка отмечена в листе, но поставка ещё не зафиксирована в
      // POSITION_STATE — фиксируем её. Только положительное направление, чтобы
      // не сбрасывать уже сохранённые (в т.ч. частичные) поставки.
      const skipReal = (pid === skipPid && skipKey === "REAL_DELIVERY");
      if (!skipReal && v12IsChecked(data[i][D.REAL_DELIVERY - 1])) {
        const required = toNumber(rowVals[P.REQUIRED_QTY - 1]);
        const currentReal = toNumber(rowVals[P.REAL_DELIVERY_QTY - 1]);
        if (required > 0 && currentReal < required) {
          rowVals[P.REAL_DELIVERY_QTY - 1] = required;
          realDelta = required - currentReal;
          changed = true;
        }
      }

      if (!changed) {
        continue;
      }

      v12ApplyComputedToRow(rowVals, v12GetWarehouseQtyForPositionRow(rowVals, index) + realDelta);
      writes.push({ row: pos.row, col: P.ORDERED_QTY, value: rowVals[P.ORDERED_QTY - 1] });
      writes.push({ row: pos.row, col: P.EXPECTED_DATE, value: rowVals[P.EXPECTED_DATE - 1] });
      writes.push({ row: pos.row, col: P.REAL_DELIVERY_QTY, value: rowVals[P.REAL_DELIVERY_QTY - 1] });
      writes.push({ row: pos.row, col: P.SUPPLY_STATE, value: rowVals[P.SUPPLY_STATE - 1] });
      writes.push({ row: pos.row, col: P.PRODUCTION_STATE, value: rowVals[P.PRODUCTION_STATE - 1] });
      writes.push({ row: pos.row, col: P.DEFICIT_QTY, value: rowVals[P.DEFICIT_QTY - 1] });
      writes.push({ row: pos.row, col: P.UNCOVERED_NEED, value: rowVals[P.UNCOVERED_NEED - 1] });
      writes.push({ row: pos.row, col: P.OVER_ORDERED_QTY, value: rowVals[P.OVER_ORDERED_QTY - 1] });
      writes.push({ row: pos.row, col: P.SHORT_DELIVERY_QTY, value: rowVals[P.SHORT_DELIVERY_QTY - 1] });
      writes.push({ row: pos.row, col: P.AVAILABLE_FOR_PRODUCTION, value: rowVals[P.AVAILABLE_FOR_PRODUCTION - 1] });
      writes.push({ row: pos.row, col: P.FLAGS, value: rowVals[P.FLAGS - 1] });
      writes.push({ row: pos.row, col: P.UPDATED_AT, value: new Date() });

      if (realDelta !== 0) {
        const matKey = v12BuildMaterialKey({
          code: rowVals[P.MATERIAL_CODE - 1],
          name: rowVals[P.MATERIAL_NAME - 1],
          model: rowVals[P.MODEL - 1],
          unit: rowVals[P.UNIT - 1]
        });
        warehouseDelta[matKey] = (warehouseDelta[matKey] || 0) + realDelta;
      }
    }

    if (writes.length) {
      batchWrite(posSheet, writes);
      SpreadsheetApp.flush();
    }

    // Складские остатки: применить суммарные дельты по materialKey одним батчем.
    const matKeys = Object.keys(warehouseDelta);
    if (matKeys.length) {
      const materialSheet = v12GetSheetByKey("MATERIAL_STATE");
      const mIdx = v12BuildMaterialIndex();
      const mWrites = [];
      matKeys.forEach(function (mk) {
        const delta = warehouseDelta[mk];
        if (!delta) {
          return;
        }
        const m = mIdx.get(mk);
        if (m) {
          const next = Math.max(0, toNumber(m.values[M.WAREHOUSE_QTY - 1]) + delta);
          mWrites.push({ row: m.row, col: M.WAREHOUSE_QTY, value: next });
          mWrites.push({ row: m.row, col: M.UPDATED_AT, value: new Date() });
        } else {
          const rowVals2 = new Array(V12_CONFIG.COLUMN_COUNT.MATERIAL_STATE).fill("");
          rowVals2[M.MATERIAL_KEY - 1] = mk;
          rowVals2[M.MATERIAL_CODE - 1] = mk;
          rowVals2[M.WAREHOUSE_QTY - 1] = Math.max(0, delta);
          rowVals2[M.UPDATED_AT - 1] = new Date();
          appendRow(materialSheet, rowVals2);
        }
      });
      if (mWrites.length) {
        batchWrite(materialSheet, mWrites);
      }
    }
  } finally {
    _v12Harvesting = false;
  }
}

/**
 * DEFICIT_SUMMARY: активные (не архив/не удалённые, не переданные производству)
 * позиции для снабжения. Колонки из V12_CONFIG.DEFICIT_COLUMNS.
 */
function v12RefreshDeficitSummary() {
  v12HarvestDeficitInput();
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!v12IsDeficitRowActive(r)) {
      continue;
    }
    rows.push(v12BuildDeficitRow(r));
  }

  v12ClearBody("DEFICIT_SUMMARY");
  if (rows.length) {
    v12WriteRows("DEFICIT_SUMMARY", 2, rows);
  }
  v12InstallDeficitCheckboxes(rows.length);
  v12ApplyDeficitColors(rows);
}

/**
 * Точечно обновить одну строку «Сводки дефицитов» (по positionId).
 *
 * Не очищает тело листа — пишет только затронутую строку, поэтому быстрый
 * ввод не затирает значения в остальных строках. Если позиция выпала из
 * сводки или порядок строк на листе разошёлся с POSITION_STATE — выполняется
 * безопасный полный пересчёт.
 */
function v12RefreshDeficitSummaryRow(positionId, committedKey) {
  // Переносим в POSITION_STATE всё, что уже введено в строку сводки (кроме
  // только что зафиксированной колонки), чтобы перезапись строки не затёрла
  // соседнюю ячейку (например, «Заказано», введённое раньше своего onEdit).
  v12HarvestDeficitInput(committedKey ? { positionId: positionId, key: committedKey } : null);
  const id = normalizeMaterialId(positionId);
  if (!id) {
    v12RefreshDeficitSummary();
    return;
  }
  const P = V12_CONFIG.POSITION_COLUMNS;
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];
  let targetIndex = -1;

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!v12IsDeficitRowActive(r)) {
      continue;
    }
    rows.push(v12BuildDeficitRow(r));
    if (targetIndex === -1 && normalizeMaterialId(r[P.POSITION_ID - 1]) === id) {
      targetIndex = rows.length - 1;
    }
  }

  if (targetIndex === -1) {
    // позиция больше не в сводке (например, поставлена) — полный пересчёт
    v12RefreshDeficitSummary();
    return;
  }

  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  const sheetRow = targetIndex + 2;
  const currentId = normalizeMaterialId(sheet.getRange(sheetRow, D.POSITION_ID).getValue());
  if (currentId !== id) {
    // порядок строк на листе разошёлся с POSITION_STATE — безопасный полный пересчёт
    v12RefreshDeficitSummary();
    return;
  }

  const row = rows[targetIndex];
  sheet.getRange(sheetRow, 1, 1, row.length).setValues([row]);
  v12InstallDeficitCheckboxForRow(sheetRow, true);
  v12ApplyDeficitColorForRow(sheetRow, row[D.STATUS - 1]);
}

/**
 * Чекбокс «Реальная поставка» для одной строки сводки.
 */
function v12InstallDeficitCheckboxForRow(sheetRow, enabled) {
  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const cell = sheet.getRange(sheetRow, D.REAL_DELIVERY);
  cell.clearDataValidations();
  if (enabled) {
    cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Цвет строки сводки по статусу (та же палитра, что и в полном пересчёте).
 */
function v12ApplyDeficitColorForRow(sheetRow, status) {
  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  const C = V12_CONFIG.COLORS;
  let color = C.WHITE;
  if (status === "Ожидание поставки (в Срок)") {
    color = C.YELLOW;
  } else if (status === "Ожидание поставки (Опаздывает)") {
    color = C.ORANGE;
  } else if (status === "Заказано частично") {
    color = C.RED;
  } else if (status === "Ошибка данных") {
    color = C.GRAY;
  }
  const cols = V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY;
  sheet.getRange(sheetRow, 1, 1, cols).setBackgrounds([new Array(cols).fill(color)]);
}

/**
 * Статус «Сводки дефицитов» — обновляется только при введённых «Заказано» и «Ожидаемая поставка».
 *   ordered < дефицит → «Заказано частично»;
 *   ordered >= дефицит и ожидаемая <= крайний срок → «Ожидание поставки (в Срок)»;
 *   ordered >= дефицит и ожидаемая > крайний срок → «Ожидание поставки (Опаздывает)».
 */
function v12DeficitStatusDisplay(row) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  if (row[P.VALIDATION_STATUS - 1] === V12_CONFIG.VALIDATION_STATUS.ERROR) {
    return "Ошибка данных";
  }
  const ordered = toNumber(row[P.ORDERED_QTY - 1]);
  const deficit = toNumber(row[P.DEFICIT_QTY - 1]);
  const expected = row[P.EXPECTED_DATE - 1];
  const deadline = row[P.DEADLINE - 1];

  if (ordered <= 0) {
    return "Не заказано";
  }
  // Статус обновляется только когда введены и количество заказа, и ожидаемая поставка.
  if (!expected) {
    return "Заказано";
  }
  // Толерантный разбор дат: ячейка может содержать Date, ISO-строку или «dd.MM.yyyy».
  const expDate = v12ParseSummaryDate(expected);
  const deadDate = v12ParseSummaryDate(deadline);
  const exp = expDate ? expDate.getTime() : NaN;
  const dead = deadDate ? deadDate.getTime() : NaN;
  if (ordered < deficit) {
    return "Заказано частично";
  }
  if (isNaN(exp) || isNaN(dead)) {
    return "Заказано";
  }
  return exp <= dead ? "Ожидание поставки (в Срок)" : "Ожидание поставки (Опаздывает)";
}

/**
 * Окраска строк «Сводки дефицитов» по статусу: жёлтый/оранжевый/красный/серый.
 */
function v12ApplyDeficitColors(rows) {
  if (!rows.length) {
    return;
  }
  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const C = V12_CONFIG.COLORS;
  const colors = rows.map(function (r) {
    const status = r[D.STATUS - 1];
    if (status === "Ожидание поставки (в Срок)") return C.YELLOW;
    if (status === "Ожидание поставки (Опаздывает)") return C.ORANGE;
    if (status === "Заказано частично") return C.RED;
    if (status === "Ошибка данных") return C.GRAY;
    return C.WHITE;
  });
  const background = colors.map(function (c) {
    return new Array(V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY).fill(c);
  });
  sheet.getRange(2, 1, rows.length, V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY).setBackgrounds(background);
}

/**
 * Человекочитаемый статус для сводки.
 */
function v12SupplyStatusDisplay(supplyState, validation) {
  if (validation === V12_CONFIG.VALIDATION_STATUS.ERROR) {
    return "Ошибка данных";
  }
  const map = {
    [V12_CONFIG.SUPPLY_STATE.NO_REQUIREMENT]: "Нет потребности",
    [V12_CONFIG.SUPPLY_STATE.RESERVED]: "Зарезервировано",
    [V12_CONFIG.SUPPLY_STATE.NOT_ORDERED]: "Не заказано",
    [V12_CONFIG.SUPPLY_STATE.PARTIALLY_ORDERED]: "Заказано частично",
    [V12_CONFIG.SUPPLY_STATE.ORDERED]: "Заказано",
    [V12_CONFIG.SUPPLY_STATE.PARTIALLY_DELIVERED]: "Поставлено частично",
    [V12_CONFIG.SUPPLY_STATE.DELIVERED]: "Поставлено"
  };
  return map[supplyState] || supplyState || "";
}

/**
 * Человекочитаемый статус производства (для ОТБОРКИ и WORKING BOM).
 * READY_FOR_HANDOFF → «На складе» (материал приехал и готов к отборке).
 */
function v12ProductionStatusDisplay(state) {
  const map = {
    [V12_CONFIG.PRODUCTION_STATE.NOT_AVAILABLE]: "Нет в наличии",
    [V12_CONFIG.PRODUCTION_STATE.PARTIALLY_AVAILABLE]: "Частично доступно",
    [V12_CONFIG.PRODUCTION_STATE.READY_FOR_HANDOFF]: "На складе",
    [V12_CONFIG.PRODUCTION_STATE.RECEIVED]: "Передано"
  };
  return map[state] || state || "";
}

/**
 * Чекбокс «Реальная поставка» (REAL_DELIVERY, кол. 12).
 */
function v12InstallDeficitCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const lastRow = sheet.getLastRow();
  const maxRows = Math.max(lastRow - 1, rowCount || 0);
  if (maxRows <= 0) {
    return;
  }
  sheet.getRange(2, D.REAL_DELIVERY, maxRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, D.REAL_DELIVERY, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Флаг: идёт подбор необработанных отметок передачи из «Отборки» (защита от рекурсии).
 */
let _v12HarvestingPicking = false;

/**
 * Подобрать необработанные отметки передачи из «Отборки» (ОТБОРКА).
 *
 * Страховка от потери массовых отметок чекбоксов передачи: если строка отмечена
 * в листе, но передача ещё не зафиксирована — выполняем передачу идемпотентно,
 * без пересчёта проекций (skipRefresh=true); пересчёт делает вызывающая сторона
 * (v12RefreshPicking). Вызывается в начале v12RefreshPicking ДО перезаписи листа.
 */
function v12HarvestPickingInput() {
  if (_v12HarvestingPicking) {
    return;
  }
  _v12HarvestingPicking = true;
  try {
    const sheet = getSheetByName(V12_CONFIG.SHEETS.PICKING);
    if (!sheet) {
      return;
    }
    const K = V12_CONFIG.PICKING_COLUMNS;
    const data = readSheetValues(sheet);
    if (data.length < 2) {
      return;
    }
    let handedAny = false;
    for (let i = 1; i < data.length; i++) {
      if (!v12IsChecked(data[i][K.CHECKBOX - 1])) {
        continue;
      }
      const positionId = normalizeMaterialId(data[i][K.POSITION_ID - 1]);
      if (!positionId) {
        continue;
      }
      // skipRefresh=true — проекции пересчитает вызывающая сторона.
      v12MarkReceivedByProduction(positionId, V12_CONFIG.SOURCE_UI.PICKING, true);
      handedAny = true;
    }
    if (handedAny) {
      SpreadsheetApp.flush();
    }
  } finally {
    _v12HarvestingPicking = false;
  }
}

/**
 * ОТБОРКА (PICKING): активные позиции, готовые/частично готовые к передаче.
 */
function v12RefreshPicking() {
  v12HarvestPickingInput();
  const P = V12_CONFIG.POSITION_COLUMNS;
  const K = V12_CONFIG.PICKING_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) {
      continue;
    }
    if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) {
      continue;
    }
    rows.push([
      r[P.POSITION_ID - 1],
      r[P.BOM_NAME - 1],
      r[P.BOM_ROW - 1],
      r[P.MATERIAL_CODE - 1],
      r[P.MATERIAL_NAME - 1],
      r[P.MODEL - 1],
      r[P.UNIT - 1],
      r[P.REQUIRED_QTY - 1],
      r[P.RESERVED_QTY - 1],
      r[P.AVAILABLE_FOR_PRODUCTION - 1],
      v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1]),
      false, // CHECKBOX
      new Date()
    ]);
  }

  v12ClearBody("PICKING");
  if (rows.length) {
    v12WriteRows("PICKING", 2, rows);
  }
  v12InstallPickingCheckboxes(rows.length);
  v12ApplyPickingColors(rows);
}

/**
 * Чекбокс передачи в ОТБОРКЕ (кол. 13).
 */
function v12InstallPickingCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("PICKING");
  const K = V12_CONFIG.PICKING_COLUMNS;
  const lastRow = sheet.getLastRow();
  const maxRows = Math.max(lastRow - 1, rowCount || 0);
  if (maxRows <= 0) {
    return;
  }
  sheet.getRange(2, K.CHECKBOX, maxRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, K.CHECKBOX, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Окраска строк ОТБОРКИ: «На складе» — голубой.
 */
function v12ApplyPickingColors(rows) {
  if (!rows.length) {
    return;
  }
  const sheet = v12GetSheetByKey("PICKING");
  const K = V12_CONFIG.PICKING_COLUMNS;
  const C = V12_CONFIG.COLORS;
  const colors = rows.map(function (r) {
    return r[K.PRODUCTION_STATE - 1] === "На складе" ? C.STOCK : C.WHITE;
  });
  const background = colors.map(function (c) {
    return new Array(V12_CONFIG.COLUMN_COUNT.PICKING).fill(c);
  });
  sheet.getRange(2, 1, rows.length, V12_CONFIG.COLUMN_COUNT.PICKING).setBackgrounds(background);
}

/**
 * WORKING BOM: активные позиции по всем BOM (для производства).
 */
function v12RefreshWorkingBOM() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const W = V12_CONFIG.WORKING_BOM_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) {
      continue;
    }
    rows.push([
      r[P.POSITION_ID - 1],
      r[P.BOM_NAME - 1],
      r[P.BOM_ROW - 1],
      r[P.MATERIAL_CODE - 1],
      r[P.MATERIAL_NAME - 1],
      r[P.MODEL - 1],
      r[P.UNIT - 1],
      r[P.REQUIRED_QTY - 1],
      r[P.RESERVED_QTY - 1],
      r[P.REAL_DELIVERY_QTY - 1],
      r[P.AVAILABLE_FOR_PRODUCTION - 1],
      r[P.RECEIVED_BY_PRODUCTION_QTY - 1],
      v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1]),
      new Date()
    ]);
  }

  v12ClearBody("WORKING_BOM");
  if (rows.length) {
    v12WriteRows("WORKING_BOM", 2, rows);
  }
}
/**
 * СНАБЖЕНИЕ (SUPPLY): агрегация по materialKey (ТЗ №68–71).
 */
function v12RefreshSupply() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const S = V12_CONFIG.SUPPLY_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const agg = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc === V12_CONFIG.LIFECYCLE_STATE.ARCHIVED || lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
      continue;
    }
    const key = v12BuildMaterialKey({
      code: r[P.MATERIAL_CODE - 1],
      name: r[P.MATERIAL_NAME - 1],
      model: r[P.MODEL - 1],
      unit: r[P.UNIT - 1]
    });
    if (!agg[key]) {
      agg[key] = {
        code: r[P.MATERIAL_CODE - 1],
        name: r[P.MATERIAL_NAME - 1],
        model: r[P.MODEL - 1],
        unit: r[P.UNIT - 1],
        required: 0, reserved: 0, deficit: 0, ordered: 0,
        realDelivery: 0, uncovered: 0, bomCount: 0
      };
    }
    const a = agg[key];
    a.required += toNumber(r[P.REQUIRED_QTY - 1]);
    a.reserved += toNumber(r[P.RESERVED_QTY - 1]);
    a.deficit += toNumber(r[P.DEFICIT_QTY - 1]);
    a.ordered += toNumber(r[P.ORDERED_QTY - 1]);
    a.realDelivery += toNumber(r[P.REAL_DELIVERY_QTY - 1]);
    a.uncovered += toNumber(r[P.UNCOVERED_NEED - 1]);
    a.bomCount += 1;
  }

  const rows = Object.keys(agg).map(function (key) {
    const a = agg[key];
    return [key, a.code, a.name, a.model, a.unit,
      a.required, a.reserved, a.deficit, a.ordered,
      a.realDelivery, a.uncovered, a.bomCount, new Date()];
  });

  v12ClearBody("SUPPLY");
  if (rows.length) {
    v12WriteRows("SUPPLY", 2, rows);
  }
}

/**
 * Агрегация по BOM: подсчёт позиций и BOM-статус (К2).
 * Возвращает Map<bomId, { total, collected, notOrdered, partial, late, onTime, errors, status, missing }>.
 */
function v12AggregateBomStates() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const bomMap = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const bomId = normalizeMaterialId(r[P.BOM_ID - 1]);
    if (!bomId) {
      continue;
    }
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
      continue;
    }
    if (!bomMap[bomId]) {
      bomMap[bomId] = {
        bomName: r[P.BOM_NAME - 1],
        total: 0, collected: 0, notOrdered: 0, partial: 0,
        late: 0, onTime: 0, errors: 0, missing: [],
        minDeadline: null
      };
    }
    const b = bomMap[bomId];
    b.total++;
    const deadline = r[P.DEADLINE - 1];
    if (deadline && (b.minDeadline === null || new Date(b.minDeadline) > new Date(deadline))) {
      b.minDeadline = deadline;
    }
    const supply = r[P.SUPPLY_STATE - 1];
    const production = r[P.PRODUCTION_STATE - 1];
    const validation = r[P.VALIDATION_STATUS - 1];
    const received = r[P.RECEIVED_BY_PRODUCTION - 1] === true;

    if (validation === V12_CONFIG.VALIDATION_STATUS.ERROR) {
      b.errors++;
      b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Ошибка данных" });
      continue;
    }
    if (production === V12_CONFIG.PRODUCTION_STATE.RECEIVED) {
      b.collected++;
      continue;
    }
    switch (supply) {
      case V12_CONFIG.SUPPLY_STATE.NOT_ORDERED:
        b.notOrdered++;
        b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Не заказано" });
        break;
      case V12_CONFIG.SUPPLY_STATE.PARTIALLY_ORDERED:
        b.partial++;
        b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Заказано частично" });
        break;
      case V12_CONFIG.SUPPLY_STATE.PARTIALLY_DELIVERED:
        b.partial++;
        b.missing.push({ code: r[P.MATERIAL_CODE - 1], name: r[P.MATERIAL_NAME - 1], reason: "Поставлено частично" });
        break;
      case V12_CONFIG.SUPPLY_STATE.ORDERED:
        b.onTime++;
        break;
      default:
        b.onTime++;
    }
  }
  return bomMap;
}

/**
 * Определить BOM-статус по агрегату (К2).
 */
function v12ComputeBomStatus(agg) {
  const BS = V12_CONFIG.BOM_STATUS;
  if (agg.errors > 0) {
    return BS.ERROR;
  }
  if (agg.collected === agg.total && agg.total > 0) {
    return BS.READY;
  }
  if (agg.notOrdered === agg.total) {
    return BS.NOT_PROCESSED;
  }
  if (agg.notOrdered > 0 || agg.partial > 0) {
    return BS.PARTIAL_SELECTED;
  }
  if (agg.late > 0) {
    return BS.WAITING_LATE;
  }
  return BS.WAITING_ON_TIME;
}

/**
 * DASHBOARD: сводка по BOM. Чекбокс «Выполнено» (DONE) активен только
 * при «Готов к производству» (ТЗ №53).
 */
function v12RefreshDashboard() {
  const D = V12_CONFIG.DASHBOARD_COLUMNS;
  const agg = v12AggregateBomStates();
  const excluded = v12BuildExcludedMap();
  const bomIds = Object.keys(agg);
  const revDates = v12BuildRevisionDateMap();
  const rows = [];

  bomIds.forEach(function (bomId) {
    const a = agg[bomId];
    const status = v12ComputeBomStatus(a);
    const progress = a.total > 0 ? Math.round((a.collected / a.total) * 100) : 0;
    const missingText = a.missing.length
      ? a.missing.map(function (m) {
          return (m.code || m.name) + " (" + m.reason + ")";
        }).join("; ")
      : "";
    const done = excluded[bomId] === true;
    rows.push([
      done,
      bomId,
      a.bomName,
      status,
      a.total,
      a.collected,
      progress,
      revDates[bomId] || "",
      a.minDeadline || "",
      missingText,
      new Date()
    ]);
  });

  v12ClearBody("DASHBOARD");
  if (rows.length) {
    v12WriteRows("DASHBOARD", 2, rows);
  }
  v12InstallDashboardCheckboxes(rows.length);
  v12ApplyDashboardColors();
  v12SetupDashboardNotes(rows);
}

/**
 * Карта «дата создания» BOM из BOM_REVISION (самая ранняя ревизия).
 * Возвращает { bomId: date }.
 */
function v12BuildRevisionDateMap() {
  const revData = v12ReadSheet("BOM_REVISION");
  const R = V12_CONFIG.BOM_REVISION_COLUMNS;
  const map = {};
  for (let i = 1; i < revData.length; i++) {
    const bomId = normalizeMaterialId(revData[i][R.BOM_ID - 1]);
    const date = revData[i][R.DATE - 1];
    if (!bomId || !date) {
      continue;
    }
    const t = new Date(date).getTime();
    if (!map[bomId] || (!isNaN(t) && t < new Date(map[bomId]).getTime())) {
      map[bomId] = date;
    }
  }
  return map;
}

/**
 * Чекбокс «Выполнено» в DASHBOARD (кол. 1).
 */
function v12InstallDashboardCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("DASHBOARD");
  const lastRow = sheet.getLastRow();
  const maxRows = Math.max(lastRow - 1, rowCount || 0);
  if (maxRows <= 0) {
    return;
  }
  sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.DONE, maxRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.DONE, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Условное форматирование статусной колонки DASHBOARD.
 */
function v12ApplyDashboardColors() {
  const sheet = v12GetSheetByKey("DASHBOARD");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  const range = sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.STATUS, lastRow - 1, 1);
  const rules = [];
  const BS = V12_CONFIG.BOM_STATUS;
  const BSC = V12_CONFIG.BOM_STATUS_COLOR;
  Object.keys(BSC).forEach(function (label) {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextContains(label)
        .setBackground(V12_CONFIG.COLORS[BSC[label]])
        .setRanges([range])
        .build()
    );
  });
  sheet.setConditionalFormatRules(rules);
}

/**
 * Hover-подсказки (ноты) на статус DASHBOARD — «недостающие позиции».
 */
function v12SetupDashboardNotes(rows) {
  const sheet = v12GetSheetByKey("DASHBOARD");
  const notes = rows.map(function (r) {
    return [r[V12_CONFIG.DASHBOARD_COLUMNS.MISSING_ITEMS - 1]
      ? "Недостающие позиции:\n" + r[V12_CONFIG.DASHBOARD_COLUMNS.MISSING_ITEMS - 1]
      : ""];
  });
  if (notes.length) {
    sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.STATUS, notes.length, 1).setNotes(notes);
  }
}
