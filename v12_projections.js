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
 * Кэш «уже применённого UI» по проекциям (число строк). Позволяет не
 * пересоздавать conditional-formatting правила на каждом пересчёте — это
 * дорогой вызов уровня листа.
 *
 * Замечание: в Google Apps Script модуль-глобалы НЕ переживают отдельные
 * запуски (каждый триггер/меню — новый контекст), поэтому кэш фактически
 * действует лишь в пределах одного исполнения. data-validation (чекбоксы
 * Сводки/ОТБОРКИ) здесь не кэшируется намеренно: её владелец —
 * v12Install*Checkboxes — восстанавливает валидацию безусловно.
 */
const _v12ProjectionUiState = {};

/**
 * Пересчитать и записать ВСЕ проекции (после массовых операций).
 */
function v12RefreshAllProjections() {
  v12RefreshProjections();
}

/**
 * Пересобрать все проекции.
 *
 * V3 — модель «Применить»: единственные входы пересборки — кнопка «Применить
 * изменения» (v12ApplyChanges) и полная синхронизация (v12RunFullSync).
 * Подбора необработанных правок из листов (harvest) БОЛЬШЕ НЕТ: правки
 * пользователя фиксирует очередь PENDING_EDITS, поэтому проекция пересобирается
 * только из актуального POSITION_STATE и не конкурирует с вводом.
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ: POSITION_STATE читается ОДИН раз и передаётся во все
 * проекции. Ранее каждая проекция читала лист самостоятельно — 5–6 полных
 * чтений на один пересчёт.
 */
function v12RefreshProjections() {
  const posData = v12ReadSheet("POSITION_STATE");
  // Даты ревизий и карта исключённых BOM читаются ОДИН раз на пересчёт и
  // раздаются проекциям (ранее BOM_REVISION читался дважды — в ОТБОРКЕ и в
  // Dashboard; EXCLUDED_BOMS — из Dashboard).
  const revDates = v12BuildRevisionDateMap();
  const excluded = v12BuildExcludedMap();
  v12RefreshDeficitSummary(posData);
  v12RefreshPicking(posData, revDates);
  v12RefreshWorkingBOM(posData);
  v12RefreshSupply(posData);
  v12RefreshDashboard(posData, revDates, excluded);
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
  if (v12IsChecked(r[P.RECEIVED_BY_PRODUCTION - 1])) {
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
 * Разобрать дату из ячейки сводки. Поддерживает Date и формат dd.MM.yyyy
 * (в сводке даты отображаются как «dd.MM.yyyy», JavaScript их так не парсит).
 * Возвращает Date или null.
 */
function v12ParseSummaryDate(value) {
  // Единый нормализатор: Date, «dd.MM.yyyy», ISO и числовой серийный номер Sheets.
  return v12ToDate(value);
}

/**
 * DEFICIT_SUMMARY: активные (не архив/не удалённые, не переданные производству)
 * позиции для снабжения. Колонки из V12_CONFIG.DEFICIT_COLUMNS.
 *
 * V3: подбора необработанных правок из листа (harvest) больше нет — правки
 * фиксирует очередь PENDING_EDITS, а проекция всегда строится из POSITION_STATE.
 */
function v12RefreshDeficitSummary(posData) {
  const data = posData || v12ReadSheet("POSITION_STATE");
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
  v12EnsureDeficitFilter(rows.length);
}

/**
 * Точечно обновить одну строку «Сводки дефицитов» (по positionId).
 *
 * Не очищает тело листа — пишет только затронутую строку, поэтому быстрый
 * ввод не затирает значения в остальных строках. Если позиция выпала из
 * сводки или порядок строк на листе разошёлся с POSITION_STATE — выполняется
 * безопасный полный пересчёт.
 */
function v12RefreshDeficitSummaryRow(positionId, posData) {
  const id = normalizeMaterialId(positionId);
  if (!id) {
    v12RefreshDeficitSummary();
    return;
  }
  const P = V12_CONFIG.POSITION_COLUMNS;
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const data = posData || v12ReadSheet("POSITION_STATE");
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
  const color = v12DeficitStatusColor(status);
  const cols = V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY;
  sheet.getRange(sheetRow, 1, 1, cols).setBackgrounds([new Array(cols).fill(color)]);
}

/**
 * Статус «Сводки дефицитов». Заказ считается оформленным только когда введены
 * И количество заказа, И ожидаемая дата поставки; иначе позиция «Не заказано».
 *   нет заказа или нет ожидаемой даты → «Не заказано»;
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

  // Заказ не оформлен или не указана ожидаемая дата поставки — «Не заказано».
  if (ordered <= 0 || !expected) {
    return "Не заказано";
  }
  // Толерантный разбор дат: ячейка может содержать Date, ISO-строку или «dd.MM.yyyy».
  const expDate = v12ParseSummaryDate(expected);
  const deadDate = v12ParseSummaryDate(deadline);
  const exp = expDate ? expDate.getTime() : NaN;
  const dead = deadDate ? deadDate.getTime() : NaN;
  // Даты не распознаны (нет валидного срока поставки) — «Не заказано».
  if (isNaN(exp) || isNaN(dead)) {
    return "Не заказано";
  }
  if (ordered < deficit) {
    return "Заказано частично";
  }
  return exp <= dead ? "Ожидание поставки (в Срок)" : "Ожидание поставки (Опаздывает)";
}

/**
 * Цвет строки «Сводки дефицитов» по статусу (ключ из V12_CONFIG.COLORS).
 * Единый источник правды для раскраски — используется и полным пересчётом
 * (v12ApplyDeficitColors), и точечным обновлением строки
 * (v12ApplyDeficitColorForRow), чтобы логика не расходилась.
 *
 *   «Не заказано» / «Заказано частично» → красный (дефицит не покрыт заказом);
 *   «Ожидание поставки (в Срок)» → жёлтый; «(Опаздывает)» → оранжевый;
 *   «Ошибка данных» → серый; иначе → белый.
 */
function v12DeficitStatusColor(status) {
  const C = V12_CONFIG.COLORS;
  if (status === "Ошибка данных") {
    return C.GRAY;
  }
  if (status === "Не заказано" || status === "Заказано частично") {
    return C.RED;
  }
  if (status === "Ожидание поставки (в Срок)") {
    return C.YELLOW;
  }
  if (status === "Ожидание поставки (Опаздывает)") {
    return C.ORANGE;
  }
  return C.WHITE;
}

/**
 * Окраска строк «Сводки дефицитов» по статусу: красный (не заказано / заказано
 * частично), жёлтый (в срок), оранжевый (опаздывает), серый (ошибка данных).
 * Цвет берётся из v12DeficitStatusColor — единого источника правды.
 */
function v12ApplyDeficitColors(rows) {
  if (!rows.length) {
    return;
  }
  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const background = rows.map(function (r) {
    const color = v12DeficitStatusColor(r[D.STATUS - 1]);
    return new Array(V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY).fill(color);
  });
  sheet.getRange(2, 1, rows.length, V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY).setBackgrounds(background);
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
  // clearBody больше НЕ сбрасывает валидации (см. clearRange), поэтому чистим
  // колонку на всю высоту листа — иначе ниже новых данных останутся «фантомные» чекбоксы.
  const totalRows = Math.max(sheet.getMaxRows() - 1, rowCount || 0);
  if (totalRows <= 0) {
    return;
  }
  sheet.getRange(2, D.REAL_DELIVERY, totalRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, D.REAL_DELIVERY, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Уникальные коды проектов для фильтра ОТБОРКИ.
 *
 * Код проекта = v12ExtractBomProjectCode(BOM_NAME) (часть имени BOM до первого
 * дефиса). Учитываются только активные, ещё не переданные позиции. Пустые коды
 * игнорируются (в фильтр не попадают).
 * data (опц.): уже прочитанные значения POSITION_STATE — чтобы не читать лист
 * повторно внутри одного пересчёта.
 */
function v12GetBomProjectCodes(data) {
  const rows = data || v12ReadSheet("POSITION_STATE");
  const P = V12_CONFIG.POSITION_COLUMNS;
  const seen = {};
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[P.LIFECYCLE_STATE - 1] !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) {
      continue;
    }
    if (v12IsChecked(r[P.RECEIVED_BY_PRODUCTION - 1])) {
      continue;
    }
    const code = v12ExtractBomProjectCode(r[P.BOM_NAME - 1]);
    if (!code || seen[code]) {
      continue;
    }
    seen[code] = true;
    out.push(code);
  }
  return out.sort(function (a, b) { return a.localeCompare(b, "ru"); });
}

/**
 * Прочитать выбранный проект-фильтр из ячейки B1 листа ОТБОРКА.
 * Возвращает "" (без фильтра) для пустого значения, пункта «Все проекты» и
 * легаси-заголовка «BOM» (чтобы не отфильтровать всё на старом листе).
 */
function v12GetPickingFilter() {
  const K = V12_CONFIG.PICKING_COLUMNS;
  const F = V12_CONFIG.PICKING_FILTER;
  const cell = v12GetSheetByKey("PICKING").getRange(F.CELL_ROW, F.CELL_COL);
  const raw = String(cell.getValue() || "").trim();
  if (!raw || raw === F.ALL || raw === V12_CONFIG.HEADERS.PICKING[K.BOM_NAME - 1]) {
    return "";
  }
  return raw;
}

/**
 * Установить выпадающий список фильтра в ячейку B1 листа ОТБОРКА.
 * Список: «(Все проекты)» + коды проектов. Если текущее значение ячейки не
 * входит в список (легаси-заголовок «BOM» или исчезнувший проект) — сбрасываем
 * на «(Все проекты)».
 */
function v12InstallPickingBomFilter(codes) {
  const F = V12_CONFIG.PICKING_FILTER;
  const codeList = codes || v12GetBomProjectCodes();
  const list = [F.ALL].concat(codeList);
  const cell = v12GetSheetByKey("PICKING").getRange(F.CELL_ROW, F.CELL_COL);
  cell.clearDataValidations();
  cell.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(list, true).build()
  );
  const current = String(cell.getValue() || "").trim();
  if (current !== F.ALL && codeList.indexOf(current) === -1) {
    cell.setValue(F.ALL);
  }
}

/**
 * ОТБОРКА (PICKING): активные позиции, готовые/частично готовые к передаче.
 *
 * Фильтр по проекту (код = первая часть BOM до дефиса) берётся из ячейки B1;
 * «(Все проекты)»/пусто — без фильтра.
 * Порядок строк: BOM -> «На складе» сверху -> номер строки в BOM.
 */
function v12RefreshPicking(posData, revDates) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const K = V12_CONFIG.PICKING_COLUMNS;
  const data = posData || v12ReadSheet("POSITION_STATE");
  const codes = v12GetBomProjectCodes(data);
  // Даты создания BOM (самая ранняя ревизия) — для колонки «Дата поставки»
  // у позиций, изначально закрытых резервом BOM. revDates передаётся из
  // v12RefreshProjections, чтобы не читать BOM_REVISION повторно.
  const bomCreatedDates = revDates || v12BuildRevisionDateMap();
  let filter = v12GetPickingFilter();
  // Выбран несуществующий/исчезнувший проект — сбрасываем фильтр на «Все проекты»
  // до сборки строк (иначе лист окажется пустым).
  if (filter && codes.indexOf(filter) === -1) {
    v12GetSheetByKey("PICKING")
      .getRange(V12_CONFIG.PICKING_FILTER.CELL_ROW, V12_CONFIG.PICKING_FILTER.CELL_COL)
      .setValue(V12_CONFIG.PICKING_FILTER.ALL);
    filter = "";
  }
  // Каждая запись несёт строку листа и её цвет (рассчитан из POSITION_STATE,
  // т.к. после сортировки цвета должны следовать за своими строками).
  const records = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) {
      continue;
    }
    if (v12IsChecked(r[P.RECEIVED_BY_PRODUCTION - 1])) {
      continue;
    }
    const bomName = r[P.BOM_NAME - 1];
    if (filter && v12ExtractBomProjectCode(bomName) !== filter) {
      continue;   // позиция другого проекта — скрываем
    }
    records.push({
      row: [
        r[P.POSITION_ID - 1],
        bomName,
        r[P.BOM_ROW - 1],
        r[P.MATERIAL_CODE - 1],
        r[P.MATERIAL_NAME - 1],
        r[P.MODEL - 1],
        r[P.UNIT - 1],
        r[P.REQUIRED_QTY - 1],
        r[P.AVAILABLE_FOR_PRODUCTION - 1],
        v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1]),
        v12PickingDeliveryDate(r, bomCreatedDates[normalizeMaterialId(r[P.BOM_ID - 1])]), // «Дата поставки» (кол. 11)
        false // CHECKBOX
      ],
      color: v12PickingRowColor(r)
    });
  }

  // Сортировка: первично BOM, затем «На складе» сверху, затем номер строки BOM.
  const readyLabel = v12ProductionStatusDisplay(V12_CONFIG.PRODUCTION_STATE.READY_FOR_HANDOFF);
  records.sort(function (a, b) {
    const byBom = String(a.row[K.BOM_NAME - 1] || "")
      .localeCompare(String(b.row[K.BOM_NAME - 1] || ""), "ru");
    if (byBom !== 0) {
      return byBom;
    }
    const aReady = a.row[K.PRODUCTION_STATE - 1] === readyLabel ? 0 : 1;
    const bReady = b.row[K.PRODUCTION_STATE - 1] === readyLabel ? 0 : 1;
    if (aReady !== bReady) {
      return aReady - bReady;
    }
    return toNumber(a.row[K.BOM_ROW - 1]) - toNumber(b.row[K.BOM_ROW - 1]);
  });

  const rows = records.map(function (rec) { return rec.row; });
  const colors = records.map(function (rec) { return rec.color; });

  v12ClearBody("PICKING");
  if (rows.length) {
    v12WriteRows("PICKING", 2, rows);
  }
  v12InstallPickingCheckboxes(rows.length);
  v12ApplyPickingColors(colors);
  v12InstallPickingBomFilter(codes);
}

/**
 * Значение колонки «Дата поставки» ОТБОРКИ (кол. 11).
 *
 * Приоритет значений:
 *   1) Если в BOM изначально зарезервировано >= требуется (материал закрыт
 *      резервом BOM) — дата создания BOM (bomCreatedDate);
 *   2) иначе для материала на складе (READY_FOR_HANDOFF) — дата реальной
 *      поставки (REAL_DELIVERY_DATE);
 *   3) иначе — ожидаемая дата прихода (EXPECTED_DATE).
 */
function v12PickingDeliveryDate(r, bomCreatedDate) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const required = toNumber(r[P.REQUIRED_QTY - 1]);
  const reserved = toNumber(r[P.RESERVED_QTY - 1]);
  // Материал изначально закрыт резервом BOM (зарезервировано >= требуется) —
  // дата поставки = дата создания BOM.
  if (required > 0 && reserved >= required && bomCreatedDate) {
    return v12FormatDateOnly(bomCreatedDate);
  }
  if (r[P.PRODUCTION_STATE - 1] === V12_CONFIG.PRODUCTION_STATE.READY_FOR_HANDOFF) {
    const realDate = r[P.REAL_DELIVERY_DATE - 1];
    if (realDate !== "" && realDate !== null && realDate !== undefined) {
      return v12FormatDateOnly(realDate);
    }
  }
  return v12FormatDateOnly(r[P.EXPECTED_DATE - 1]);
}

/**
 * Чекбокс передачи в ОТБОРКЕ (кол. 12).
 */
function v12InstallPickingCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("PICKING");
  const K = V12_CONFIG.PICKING_COLUMNS;
  const totalRows = Math.max(sheet.getMaxRows() - 1, rowCount || 0);
  if (totalRows <= 0) {
    return;
  }
  sheet.getRange(2, K.CHECKBOX, totalRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, K.CHECKBOX, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

/**
 * Цвет строки ОТБОРКИ по состоянию обеспечения позиции.
 *
 *   «На складе» (READY_FOR_HANDOFF, доступно ≥ требуется) → голубой (STOCK);
 *   материала не хватает и он НЕ заказан / заказан частично → красный (RED);
 *   материала не хватает, заказан, ожидаемый приход ≤ крайний срок → жёлтый (YELLOW);
 *   материала не хватает, заказан, приход позже срока / срок неизвестен → оранжевый (ORANGE);
 *   прочее → белый (WHITE).
 */
function v12PickingRowColor(r) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const C = V12_CONFIG.COLORS;
  const SS = V12_CONFIG.SUPPLY_STATE;
  const PS = V12_CONFIG.PRODUCTION_STATE;

  // Материал пришёл и готов к отборке — «На складе».
  if (r[P.PRODUCTION_STATE - 1] === PS.READY_FOR_HANDOFF) {
    return C.STOCK;
  }
  const supply = r[P.SUPPLY_STATE - 1];
  if (supply === SS.NOT_ORDERED || supply === SS.PARTIALLY_ORDERED) {
    return C.RED;
  }
  if (supply === SS.ORDERED || supply === SS.PARTIALLY_DELIVERED) {
    const exp = v12ToDate(r[P.EXPECTED_DATE - 1]);
    const dead = v12ToDate(r[P.DEADLINE - 1]);
    if (exp && dead) {
      return exp.getTime() <= dead.getTime() ? C.YELLOW : C.ORANGE;
    }
    // Заказан, но подтверждённого срока прихода нет — трактуем как риск (оранжевый).
    return C.ORANGE;
  }
  return C.WHITE;
}

/**
 * Окраска строк ОТБОРКИ по заранее рассчитанным цветам
 * (ширина полосы — COLUMN_COUNT.PICKING).
 */
function v12ApplyPickingColors(colors) {
  if (!colors || !colors.length) {
    return;
  }
  const sheet = v12GetSheetByKey("PICKING");
  const cols = V12_CONFIG.COLUMN_COUNT.PICKING;
  const background = colors.map(function (c) {
    return new Array(cols).fill(c || V12_CONFIG.COLORS.WHITE);
  });
  sheet.getRange(2, 1, colors.length, cols).setBackgrounds(background);
}

/**
 * WORKING BOM: активные позиции по всем BOM (для производства).
 */
function v12RefreshWorkingBOM(posData) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const data = posData || v12ReadSheet("POSITION_STATE");
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
      false, // CHECKBOX (кол. 14)
      new Date() // UPDATED_AT (кол. 15)
    ]);
  }

  v12ClearBody("WORKING_BOM");
  if (rows.length) {
    v12WriteRows("WORKING_BOM", 2, rows);
  }
  v12InstallWorkingBomCheckboxes(rows.length);
}

/**
 * Чекбокс передачи в WORKING BOM (кол. 14).
 */
function v12InstallWorkingBomCheckboxes(rowCount) {
  const sheet = v12GetSheetByKey("WORKING_BOM");
  const W = V12_CONFIG.WORKING_BOM_COLUMNS;
  const totalRows = Math.max(sheet.getMaxRows() - 1, rowCount || 0);
  if (totalRows <= 0) {
    return;
  }
  sheet.getRange(2, W.CHECKBOX, totalRows, 1).clearDataValidations();
  if (rowCount > 0) {
    sheet.getRange(2, W.CHECKBOX, rowCount, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}
/**
 * СНАБЖЕНИЕ (SUPPLY): агрегация по materialKey (ТЗ №68–71).
 *
 * Колонка «Проекты» перечисляет проекты, использующие материал, в формате
 * «<дефицит> - <номер проекта> - <крайний срок>» (по строке на проект),
 * отсортированные по крайнему сроку по возрастанию (самый ранний сверху).
 * Для проекта берётся самый РАННИЙ крайний срок его позиций.
 */
function v12RefreshSupply(posData) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const data = posData || v12ReadSheet("POSITION_STATE");
  const agg = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!v12IsSupplyRowActive(r)) {
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
        deficit: 0, ordered: 0,
        realDelivery: 0,
        projects: {}
      };
    }
    const a = agg[key];
    a.deficit += toNumber(r[P.DEFICIT_QTY - 1]);
    a.ordered += toNumber(r[P.ORDERED_QTY - 1]);
    a.realDelivery += toNumber(r[P.REAL_DELIVERY_QTY - 1]);
    v12AccumulateSupplyProject(a.projects, r);
  }

  const rows = Object.keys(agg).map(function (key) {
    const a = agg[key];
    return [key, a.code, a.name, a.model, a.unit,
      a.deficit, a.ordered, a.realDelivery,
      v12BuildSupplyProjectsText(a.projects)];
  });

  v12ClearBody("SUPPLY");
  if (rows.length) {
    v12WriteRows("SUPPLY", 2, rows);
  }
  v12EnsureSupplyFilter(rows.length);
}

/**
 * Обеспечить автофильтр на листе-проекции — сортировка и фильтр по любому
 * столбцу таблицы (выпадающие списки в строке заголовков).
 *
 * Диапазон автофильтра — строка заголовков (1) + строки данных (rowCount),
 * колонки 1..cols. Если существующий фильтр уже покрывает нужный диапазон —
 * НЕ трогаем его (не сбрасываем пользовательскую сортировку/фильтр при простом
 * пересчёте). Иначе — старый фильтр удаляется и создаётся новый.
 *
 * Общий помощник для проекций (СНАБЖЕНИЕ, Сводка дефицитов): диапазон фильтра
 * зависит только от числа строк данных и ширины таблицы. В окружениях без
 * фильтров (локальные Node-тесты) функция ничего не делает.
 */
function v12EnsureTableFilter(sheetKey, rowCount, cols) {
  const sheet = v12GetSheetByKey(sheetKey);
  if (!sheet || typeof sheet.getFilter !== "function") {
    return;
  }
  const lastRow = Math.max((rowCount || 0) + 1, 2);
  const existing = sheet.getFilter();
  if (existing) {
    const r = existing.getRange();
    if (r.getRow() === 1 && r.getColumn() === 1 &&
        r.getLastRow() === lastRow && r.getLastColumn() === cols) {
      return;
    }
    existing.remove();
  }
  sheet.getRange(1, 1, lastRow, cols).createFilter();
}

/**
 * Обеспечить автофильтр на листе СНАБЖЕНИЕ (сортировка/фильтр по любому
 * столбцу — удобство работы снабжения с таблицей).
 */
function v12EnsureSupplyFilter(rowCount) {
  v12EnsureTableFilter("SUPPLY", rowCount, V12_CONFIG.COLUMN_COUNT.SUPPLY);
}

/**
 * Обеспечить автофильтр на листе «Сводка дефицитов» — сортировка/фильтр по
 * любому столбцу таблицы (в т.ч. «Наименование», «Модель», «Крайний срок»,
 * «Ожидаемая поставка»): в строке заголовков появляются выпадающие списки
 * сортировки. Набор строк сводки при этом не меняется — только порядок,
 * выбранный пользователем.
 */
function v12EnsureDeficitFilter(rowCount) {
  v12EnsureTableFilter("DEFICIT_SUMMARY", rowCount, V12_CONFIG.COLUMN_COUNT.DEFICIT_SUMMARY);
}

/**
 * Включена ли позиция в лист СНАБЖЕНИЕ.
 *
 * В снабжение попадают только позиции с непокрытым дефицитом. Позиция
 * «закрыта» (выпадает из листа), когда снабжение отметило «Реальную поставку» —
 * её обработчик проставляет realDeliveryQty = required, т.е. материал
 * обеспечен (reserved + realDelivery >= required), либо когда дефицита нет.
 */
function v12IsSupplyRowActive(r) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const lc = r[P.LIFECYCLE_STATE - 1];
  if (lc === V12_CONFIG.LIFECYCLE_STATE.ARCHIVED || lc === V12_CONFIG.LIFECYCLE_STATE.REMOVED) {
    return false;
  }
  if (toNumber(r[P.DEFICIT_QTY - 1]) <= 0) {
    return false;
  }
  const available = toNumber(r[P.RESERVED_QTY - 1]) + toNumber(r[P.REAL_DELIVERY_QTY - 1]);
  if (available >= toNumber(r[P.REQUIRED_QTY - 1])) {
    return false;   // материал обеспечен (отмечена «Реальная поставка»)
  }
  return true;
}

/**
 * Учесть проект позиции в карте проектов материала (колонка «Проекты»).
 *
 * projectsMap: { <код проекта>: { project, deadline, deficit } }. Для каждого
 * проекта суммируется дефицит его позиций и хранится САМЫЙ РАННИЙ крайний срок
 * (самое жёсткое ограничение проекта) — по нему затем идёт сортировка проектов.
 * Проекты без кода (пустое имя BOM) не учитываются.
 */
function v12AccumulateSupplyProject(projectsMap, r) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const project = v12ExtractBomProjectCode(r[P.BOM_NAME - 1]);
  if (!project) {
    return;
  }
  let entry = projectsMap[project];
  if (!entry) {
    entry = { project: project, deadline: "", deficit: 0 };
    projectsMap[project] = entry;
  }
  entry.deficit += toNumber(r[P.DEFICIT_QTY - 1]);
  const deadline = v12FormatDateOnly(r[P.DEADLINE - 1]);
  if (v12IsEarlierDate(deadline, entry.deadline)) {
    entry.deadline = deadline;
  }
}

/**
 * true, если date строго раньше than. Пустая/нераспознанная date не считается
 * «раньше» (не затирает уже сохранённый срок), пустая than — считается.
 */
function v12IsEarlierDate(date, than) {
  const d = v12ToDate(date);
  if (!d) {
    return false;
  }
  const t = v12ToDate(than);
  if (!t) {
    return true;
  }
  return d.getTime() < t.getTime();
}

/**
 * Текст колонки «Проекты»: по строке на проект в формате
 * «<дефицит> - <номер проекта> - <крайний срок>»
 * (пример: «4 - 1234.АБВ - 20.09.2026»).
 *
 * Сортировка по крайнему сроку по возрастанию (самый ранний проект сверху);
 * проекты без распознанного срока — в конце (в порядке кода проекта).
 * Формат даты — dd.MM.yyyy.
 */
function v12BuildSupplyProjectsText(projectsMap) {
  const list = Object.keys(projectsMap).map(function (k) { return projectsMap[k]; });
  list.sort(function (a, b) {
    const da = v12ToDate(a.deadline);
    const db = v12ToDate(b.deadline);
    const ta = da ? da.getTime() : Infinity;
    const tb = db ? db.getTime() : Infinity;
    if (ta !== tb) {
      return ta - tb;
    }
    return String(a.project).localeCompare(String(b.project), "ru");
  });
  return list.map(function (p) {
    const dl = v12FormatDateOnly(p.deadline);
    return dl
      ? (p.deficit + " - " + p.project + " - " + dl)
      : (p.deficit + " - " + p.project);
  }).join("\n");
}

/**
 * Агрегация по BOM: подсчёт позиций и BOM-статус (К2).
 * Возвращает Map<bomId, { total, collected, notOrdered, partial, late, onTime, errors, status, missing }>.
 */
function v12AggregateBomStates(posData) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const data = posData || v12ReadSheet("POSITION_STATE");
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
      case V12_CONFIG.SUPPLY_STATE.ORDERED: {
        // Позиция заказана и ещё не собрана: если ожидаемый приход позже
        // крайнего срока — BOM «опаздывает» (иначе статус WAITING_LATE недостижим).
        const exp = v12ToDate(r[P.EXPECTED_DATE - 1]);
        const dead = v12ToDate(r[P.DEADLINE - 1]);
        if (exp && dead && exp.getTime() > dead.getTime()) {
          b.late++;
        } else {
          b.onTime++;
        }
        break;
      }
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
function v12RefreshDashboard(posData, revDatesIn, excludedIn) {
  const D = V12_CONFIG.DASHBOARD_COLUMNS;
  const agg = v12AggregateBomStates(posData);
  const excluded = excludedIn || v12BuildExcludedMap();
  const bomIds = Object.keys(agg);
  const revDates = revDatesIn || v12BuildRevisionDateMap();
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
  const totalRows = Math.max(sheet.getMaxRows() - 1, rowCount || 0);
  if (totalRows <= 0) {
    return;
  }
  sheet.getRange(2, V12_CONFIG.DASHBOARD_COLUMNS.DONE, totalRows, 1).clearDataValidations();
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
  // Условное форматирование — дорогая операция уровня листа. Пересоздаём
  // правила только если число строк изменилось (иначе они уже актуальны).
  if (_v12ProjectionUiState.dashboardColorRows === lastRow) {
    return;
  }
  _v12ProjectionUiState.dashboardColorRows = lastRow;
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
