/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_trigger.js
 *
 * Триггеры V12: onEdit + time-based. Замена V11-триггеров.
 * Обрабатывает:
 *   DEFICIT_SUMMARY — заказ/дата/реальная поставка/получено;
 *   ОТБОРКА/PICKING — чекбокс передачи производству;
 *   DASHBOARD — чекбокс «Выполнено».
 * =====================================================
 */

/**
 * Удалить проектные триггеры V12 (только наши: v12OnEdit, v12ScheduledUpdate).
 *
 * Раньше функция удаляла ВСЕ триггеры проекта, что уничтожало пользовательские
 * и сторонние триггеры. Теперь удаляются только обработчики V12.
 */
function removeV11Triggers() {
  const ours = { v12OnEdit: true, v12ScheduledUpdate: true };
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (ours[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/**
 * Установить триггеры V12 (удалив старые).
 */
function v12InstallTriggers() {
  removeV11Triggers();
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger("v12OnEdit")
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  ScriptApp.newTrigger("v12ScheduledUpdate")
    .timeBased()
    .everyHours(1)
    .create();
}

/**
 * Главный onEdit V12.
 */
function v12OnEdit(e) {
  try {
    if (!e || !e.range) {
      return;
    }
    const sheet = e.range.getSheet();
    if (!sheet) {
      return;
    }
    const name = sheet.getName();
    const S = V12_CONFIG.SHEETS;

    // Обрабатываем только листы с разрешёнными правками. Ранний выход для
    // остальных листов — до захвата блокировки, чтобы её не занимать зря.
    const isActionable =
      name === S.POSITION_STATE ||
      name === S.MATERIAL_STATE ||
      name === S.DASHBOARD ||
      name === S.DEFICIT_SUMMARY ||
      name === S.PICKING ||
      name === S.WORKING_BOM;
    if (!isActionable) {
      return;
    }

    const isSingleCell = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
    // В «Сводке дефицитов» и «Отборке» поддерживаем вставку/автозаполнение
    // диапазона — обрабатываем каждую ячейку. Прочие листы — только одиночные правки.
    const isSummaryRange = !isSingleCell && name === S.DEFICIT_SUMMARY;
    const isPickingRange = !isSingleCell && name === S.PICKING;
    if (!isSingleCell && !isSummaryRange && !isPickingRange) {
      return;
    }

    // Сериализация правок: одна правка обрабатывается целиком до начала
    // следующей, чтобы чтение-изменение-запись POSITION_STATE и пересчёт
    // проекций не накладывались при быстром вводе (иначе значения затираются).
    // ВАЖНО: правка не отбрасывается по флагу занятости — при плановом
    // обновлении она дождётся освобождения блокировки и будет обработана.
    const lock = acquireScriptLock();
    try {
      // DEFICIT_SUMMARY — вставка/заполнение диапазона (несколько ячеек)
      if (isSummaryRange) {
        v12HandleDeficitRangeEdit(e);
        return;
      }

      // ОТБОРКА — вставка/заполнение диапазона чекбоксов передачи
      if (isPickingRange) {
        v12HandlePickingRangeEdit(e);
        return;
      }

      // POSITION_STATE и MATERIAL_STATE (физ. склад) — ручное редактирование частично запрещено
      if (name === S.POSITION_STATE) {
        v12HandlePositionStateEdit(e);
        return;
      }
      if (name === S.MATERIAL_STATE) {
        v12HandleMaterialStateEdit(e);
        return;
      }

      // DASHBOARD — только чекбокс «Выполнено», только при «Готов к производству»
      if (name === S.DASHBOARD) {
        v12HandleDashboardEdit(e);
        return;
      }

      // DEFICIT_SUMMARY
      if (name === S.DEFICIT_SUMMARY) {
        v12HandleDeficitEdit(e);
        return;
      }

      // ОТБОРКА
      if (name === S.PICKING) {
        // Смена фильтра проекта в ячейке B1 (строка 1, колонка BOM) — разрешённая
        // правка: пересобираем лист под выбранный проект.
        if (e.range.getRow() === 1 && e.range.getColumn() === V12_CONFIG.PICKING_COLUMNS.BOM_NAME) {
          v12RefreshPicking();
          return;
        }
        v12HandlePickingEdit(e);
        return;
      }

      // WORKING BOM — только чекбокс передачи
      if (name === S.WORKING_BOM) {
        v12HandleWorkingBomEdit(e);
        return;
      }
    } finally {
      lock.releaseLock();
      v12FlushAudit();
    }
  } catch (error) {
    logSystem("v12OnEdit", error.message, error, "ERROR");
  }
}

/**
 * Обработка правки в POSITION_STATE (ручное — запрещено, кроме Admin).
 */
function v12HandlePositionStateEdit(e) {
  const role = v12GetCurrentUserRole();
  if (role !== V12_CONFIG.ROLES.ADMIN) {
    v12RevertEdit(e);
    logSystem("v12OnEdit", "Ручное редактирование POSITION_STATE запрещено для: " + getCurrentUser(), "WARNING");
  }
}

/**
 * Обработка правки в MATERIAL_STATE (физический склад) — только WAREHOUSE/ADMIN правят WAREHOUSE_QTY.
 */
function v12HandleMaterialStateEdit(e) {
  const column = e.range.getColumn();
  const row = e.range.getRow();
  const role = v12GetCurrentUserRole();
  if (column === V12_CONFIG.MATERIAL_COLUMNS.WAREHOUSE_QTY) {
    if (!v12CanEditField(role, "WAREHOUSE_QTY")) {
      v12RevertEdit(e);
      logSystem("v12OnEdit", "Нет права на изменение WAREHOUSE_QTY для: " + getCurrentUser(), "WARNING");
      return;
    }
    const sheet = e.range.getSheet();
    const materialKey = sheet.getRange(row, V12_CONFIG.MATERIAL_COLUMNS.MATERIAL_KEY).getValue();
    const newQty = toNumber(e.range.getValue());
    v12Audit({
      action: V12_CONFIG.AUDIT_ACTIONS.WAREHOUSE_QTY_CHANGED,
      field: "WAREHOUSE_QTY",
      oldValue: e.oldValue,
      newValue: newQty,
      data: { materialKey: materialKey }
    });
    v12RefreshProjections();
    v12FlushAudit();
    return;
  }
  // Остальные колонки — только Admin
  if (role !== V12_CONFIG.ROLES.ADMIN) {
    v12RevertEdit(e);
  }
}

/**
 * Dashboard: только чекбокс «Выполнено», и только при «Готов к производству».
 */
function v12HandleDashboardEdit(e) {
  const D = V12_CONFIG.DASHBOARD_COLUMNS;
  const sheet = e.range.getSheet();
  const row = e.range.getRow();
  if (e.range.getColumn() !== D.DONE || e.range.getRow() <= 1) {
    v12RevertEdit(e);
    logSystem("v12OnEdit", "В дашборде разрешён только чекбокс «Выполнено»", "WARNING");
    return;
  }
  const bomId = sheet.getRange(row, D.BOM_ID).getValue();
  const status = sheet.getRange(row, D.STATUS).getValue();
  const bomChecked = v12IsChecked(e.range.getValue());
  if (bomChecked && status !== V12_CONFIG.BOM_STATUS.READY) {
    v12RevertEdit(e);
    logSystem("v12OnEdit", "«Выполнено» можно отметить только при «Готов к производству»: " + bomId, "WARNING");
    return;
  }
  v12SetBomDone(bomId, bomChecked);
}

/**
 * Потребность (REQUIRED_QTY) позиции из POSITION_STATE — для «Реальной поставки»/«Получено».
 * Колонки «Требуется» в Сводке больше нет, поэтому берём из центрального состояния.
 */
function v12GetDeficitRequiredQty(positionId, index) {
  const pos = v12GetPositionById(positionId, index);
  const P = V12_CONFIG.POSITION_COLUMNS;
  return pos ? toNumber(pos.values[P.REQUIRED_QTY - 1]) : 0;
}

/**
 * DEFICIT_SUMMARY: заказ (ORDERED_QTY кол. 9), дата (EXPECTED кол. 10),
 * реальная поставка (REAL_DELIVERY кол. 12). «Получено» убрано — отмечают кладовщики в ОТБОРКЕ.
 */
function v12HandleDeficitEdit(e) {
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const sheet = e.range.getSheet();
  const column = e.range.getColumn();
  const row = e.range.getRow();
  const positionId = sheet.getRange(row, D.POSITION_ID).getValue();
  if (!positionId) {
    return;
  }
  // Значение берём из события (снимок на момент правки), а не из e.range.getValue():
  // при быстром вводе предыдущий пересчёт мог успеть откатить ячейку, и «живое»
  // чтение вернуло бы уже затёртое значение — тогда правка теряется.
  const newValue = (e.value !== undefined) ? e.value : e.range.getValue();
  if (column === D.ORDERED_QTY) {
    v12SetOrderedQty(positionId, newValue);
  } else if (column === D.EXPECTED_DATE) {
    v12SetExpectedDate(positionId, newValue);
  } else if (column === D.REAL_DELIVERY) {
    // Значение чекбокса из события onEdit приходит и как boolean (true/false),
    // и как строка ("TRUE"/"FALSE"). Нормализуем — иначе отметка не применяется,
    // поставка не убирается из сводки, а состояние чекбокса сбрасывается.
    const checked = v12IsChecked(newValue);
    try {
      v12SetRealDeliveryQty(positionId, checked ? v12GetDeficitRequiredQty(positionId) : 0);
    } catch (err) {
      v12RevertEdit(e);
      try { SpreadsheetApp.getUi().alert("Не удалось отметить поставку: " + err.message); } catch (e2) {}
    }
  } else {
    v12RevertEdit(e);
    logSystem("v12OnEdit", "В сводке доступны только Заказ/Ожидаемая/Реальная поставка", "WARNING");
  }
}

/**
 * DEFICIT_SUMMARY: обработка диапазона (вставка/автозаполнение).
 *
 * Вся группа ячеек обрабатывается за ОДИН проход: POSITION_STATE читается
 * один раз, изменения по всем строкам диапазона собираются и пишутся ОДНИМ
 * батчем, затем делается ОДИН пересчёт проекций. Так обрабатываются ВСЕ
 * строки (а не только первая) и выполнение не упирается в лимит времени.
 */
function v12HandleDeficitRangeEdit(e) {
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const P = V12_CONFIG.POSITION_COLUMNS;
  const sheet = e.range.getSheet();
  const firstRow = e.range.getRow();
  const firstCol = e.range.getColumn();
  const numRows = e.range.getNumRows();
  const numCols = e.range.getNumColumns();
  // Снимок значений из события (если доступен) — надёжнее живого чтения.
  const values = (e.values && e.values.length === numRows)
    ? e.values
    : e.range.getValues();

  const M = V12_CONFIG.MATERIAL_COLUMNS;
  const role = v12GetCurrentUserRole();
  const canOrdered = v12CanEditField(role, "ORDERED_QTY");
  const canExpected = v12CanEditField(role, "EXPECTED_DATE");
  const canDelivery = v12CanEditField(role, "REAL_DELIVERY");

  const index = v12BuildPositionIndex();
  const posSheet = v12GetSheetByKey("POSITION_STATE");
  const touched = {};   // positionId -> { row, vals, changed, oldOrdered, oldExpected, oldReal, desiredReal }
  const writes = [];
  const warehouseDelta = {};   // materialKey -> суммарная дельта склада

  for (let r = 0; r < numRows; r++) {
    const sheetRow = firstRow + r;
    const positionId = normalizeMaterialId(sheet.getRange(sheetRow, D.POSITION_ID).getValue());
    if (!positionId) {
      continue;
    }
    const pos = index.get(positionId);
    if (!pos) {
      continue;
    }
    let entry = touched[positionId];
    if (!entry) {
      entry = {
        row: pos.row,
        vals: pos.values.slice(),
        changed: false,
        oldOrdered: toNumber(pos.values[P.ORDERED_QTY - 1]),
        oldExpected: pos.values[P.EXPECTED_DATE - 1],
        oldReal: toNumber(pos.values[P.REAL_DELIVERY_QTY - 1]),
        desiredReal: undefined
      };
      touched[positionId] = entry;
    }
    for (let c = 0; c < numCols; c++) {
      const column = firstCol + c;
      const value = values[r][c];
      if (column === D.ORDERED_QTY && canOrdered) {
        const q = Math.max(0, toNumber(value));
        if (q !== toNumber(entry.vals[P.ORDERED_QTY - 1])) {
          entry.vals[P.ORDERED_QTY - 1] = q;
          entry.changed = true;
        }
      } else if (column === D.EXPECTED_DATE && canExpected) {
        const d = v12ToDate(value);
        if (v12DateValue(d) !== v12DateValue(entry.vals[P.EXPECTED_DATE - 1])) {
          entry.vals[P.EXPECTED_DATE - 1] = d ? d : "";
          entry.changed = true;
        }
      } else if (column === D.REAL_DELIVERY && canDelivery) {
        // Чекбокс «Реальная поставка»: отмечаем/снимаем полную поставку.
        // Значение может прийти boolean или строкой ("TRUE"/"FALSE") — нормализуем.
        const required = toNumber(entry.vals[P.REQUIRED_QTY - 1]);
        entry.desiredReal = (v12IsChecked(value) && required > 0) ? required : 0;
      }
    }
  }

  Object.keys(touched).forEach(function (pid) {
    const entry = touched[pid];
    const rowVals = entry.vals;
    // Реальная поставка (чекбокс) — применить до расчёта количеств.
    let deltaReal = 0;
    if (entry.desiredReal !== undefined && entry.desiredReal !== entry.oldReal) {
      rowVals[P.REAL_DELIVERY_QTY - 1] = entry.desiredReal;
      // Дата фактической поставки: первая положительная отметка, сброс при 0.
      rowVals[P.REAL_DELIVERY_DATE - 1] = entry.desiredReal > 0
        ? (rowVals[P.REAL_DELIVERY_DATE - 1] || new Date())
        : "";
      deltaReal = entry.desiredReal - entry.oldReal;
      entry.changed = true;
    }
    if (!entry.changed) {
      return;
    }
    v12ApplyComputedToRow(rowVals);
    writes.push({ row: entry.row, col: P.ORDERED_QTY, value: rowVals[P.ORDERED_QTY - 1] });
    writes.push({ row: entry.row, col: P.EXPECTED_DATE, value: rowVals[P.EXPECTED_DATE - 1] });
    writes.push({ row: entry.row, col: P.SUPPLY_STATE, value: rowVals[P.SUPPLY_STATE - 1] });
    writes.push({ row: entry.row, col: P.PRODUCTION_STATE, value: rowVals[P.PRODUCTION_STATE - 1] });
    writes.push({ row: entry.row, col: P.DEFICIT_QTY, value: rowVals[P.DEFICIT_QTY - 1] });
    writes.push({ row: entry.row, col: P.UNCOVERED_NEED, value: rowVals[P.UNCOVERED_NEED - 1] });
    writes.push({ row: entry.row, col: P.OVER_ORDERED_QTY, value: rowVals[P.OVER_ORDERED_QTY - 1] });
    writes.push({ row: entry.row, col: P.SHORT_DELIVERY_QTY, value: rowVals[P.SHORT_DELIVERY_QTY - 1] });
    writes.push({ row: entry.row, col: P.AVAILABLE_FOR_PRODUCTION, value: rowVals[P.AVAILABLE_FOR_PRODUCTION - 1] });
    writes.push({ row: entry.row, col: P.FLAGS, value: rowVals[P.FLAGS - 1] });
    writes.push({ row: entry.row, col: P.REAL_DELIVERY_QTY, value: rowVals[P.REAL_DELIVERY_QTY - 1] });
    writes.push({ row: entry.row, col: P.REAL_DELIVERY_DATE, value: rowVals[P.REAL_DELIVERY_DATE - 1] });
    writes.push({ row: entry.row, col: P.UPDATED_AT, value: new Date() });

    if (deltaReal !== 0) {
      const matKey = v12BuildMaterialKey({
        code: rowVals[P.MATERIAL_CODE - 1],
        name: rowVals[P.MATERIAL_NAME - 1],
        model: rowVals[P.MODEL - 1],
        unit: rowVals[P.UNIT - 1]
      });
      warehouseDelta[matKey] = (warehouseDelta[matKey] || 0) + deltaReal;
    }

    const changedOrdered = (toNumber(rowVals[P.ORDERED_QTY - 1]) !== entry.oldOrdered);
    const changedExpected = (v12DateValue(rowVals[P.EXPECTED_DATE - 1]) !== v12DateValue(entry.oldExpected));
    if (changedOrdered) {
      v12Audit({
        action: V12_CONFIG.AUDIT_ACTIONS.ORDERED_CHANGED,
        bomId: rowVals[P.BOM_ID - 1],
        positionId: pid,
        field: "ORDERED_QTY",
        oldValue: entry.oldOrdered,
        newValue: toNumber(rowVals[P.ORDERED_QTY - 1])
      });
    }
    if (changedExpected) {
      v12Audit({
        action: V12_CONFIG.AUDIT_ACTIONS.EXPECTED_DATE_CHANGED,
        bomId: rowVals[P.BOM_ID - 1],
        positionId: pid,
        field: "EXPECTED_DATE",
        oldValue: entry.oldExpected,
        newValue: rowVals[P.EXPECTED_DATE - 1]
      });
    }
    if (entry.desiredReal !== undefined && entry.desiredReal !== entry.oldReal) {
      v12Audit({
        action: V12_CONFIG.AUDIT_ACTIONS.REAL_DELIVERY_CHANGED,
        bomId: rowVals[P.BOM_ID - 1],
        positionId: pid,
        field: "REAL_DELIVERY_QTY",
        oldValue: entry.oldReal,
        newValue: entry.desiredReal
      });
    }
  });

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
        const row = new Array(V12_CONFIG.COLUMN_COUNT.MATERIAL_STATE).fill("");
        row[M.MATERIAL_KEY - 1] = mk;
        row[M.MATERIAL_CODE - 1] = mk;
        row[M.WAREHOUSE_QTY - 1] = Math.max(0, delta);
        row[M.UPDATED_AT - 1] = new Date();
        appendRow(materialSheet, row);
      }
    });
    if (mWrites.length) {
      batchWrite(materialSheet, mWrites);
    }
  }

  // Один пересчёт на всю группу — обновляет статус по всем затронутым строкам
  // и синхронизирует ВСЕ проекции (в т.ч. ОТБОРКА/WORKING BOM, где отражаются
  // переданные количества и складской остаток), как и одиночная операция.
  v12RefreshProjections();
  v12FlushAudit();
}

/**
 * ОТБОРКА (PICKING): чекбокс передачи производству (кол. 12).
 */
function v12HandlePickingEdit(e) {
  const K = V12_CONFIG.PICKING_COLUMNS;
  const sheet = e.range.getSheet();
  const column = e.range.getColumn();
  const row = e.range.getRow();
  if (column !== K.CHECKBOX) {
    v12RevertEdit(e);
    return;
  }
  const positionId = sheet.getRange(row, K.POSITION_ID).getValue();
  const checked = e.range.getValue();
  if (v12IsChecked(checked)) {
    const result = v12MarkReceivedByProduction(positionId, V12_CONFIG.SOURCE_UI.PICKING);
    if (result.status === "blocked") {
      v12RevertEdit(e);
      SpreadsheetApp.getUi().alert("Не удалось передать: " + result.reason);
    }
  }
}

/**
 * ОТБОРКА (PICKING): обработка диапазона чекбоксов передачи (вставка/автозаполнение).
 *
 * Обрабатываются ВСЕ отмеченные строки диапазона; передача выполняется для
 * каждой (проекции пересчитываются один раз в конце — см. skipRefresh).
 * Если строка не может быть передана ("blocked") — её отметка снимается.
 */
function v12HandlePickingRangeEdit(e) {
  const K = V12_CONFIG.PICKING_COLUMNS;
  const sheet = e.range.getSheet();
  const firstRow = e.range.getRow();
  const firstCol = e.range.getColumn();
  const numRows = e.range.getNumRows();
  const numCols = e.range.getNumColumns();
  const values = (e.values && e.values.length === numRows) ? e.values : e.range.getValues();
  let anyHandoff = false;

  for (let r = 0; r < numRows; r++) {
    if (firstRow + r === 1) {
      continue;   // строка заголовка (в т.ч. ячейка фильтра B1) не обрабатывается
    }
    for (let c = 0; c < numCols; c++) {
      if (firstCol + c !== K.CHECKBOX) {
        continue;
      }
      if (!v12IsChecked(values[r][c])) {
        continue;
      }
      const positionId = normalizeMaterialId(sheet.getRange(firstRow + r, K.POSITION_ID).getValue());
      if (!positionId) {
        continue;
      }
      // Пересчёт проекций — один раз после обработки всей группы.
      const result = v12MarkReceivedByProduction(positionId, V12_CONFIG.SOURCE_UI.PICKING, true);
      if (result && result.status === "blocked") {
        // передать не удалось — снимаем отметку в этой строке
        sheet.getRange(firstRow + r, K.CHECKBOX).setValue(false);
      }
      anyHandoff = true;
    }
  }

  if (anyHandoff) {
    v12RefreshProjections();
  }
}

/**
 * WORKING BOM: чекбокс передачи производству (кол. 14).
 */
function v12HandleWorkingBomEdit(e) {
  const W = V12_CONFIG.WORKING_BOM_COLUMNS;
  const sheet = e.range.getSheet();
  const column = e.range.getColumn();
  const row = e.range.getRow();
  // В WORKING BOM разрешён только чекбокс передачи (кол. 14). Остальные
  // колонки read-only для всех, кроме Admin.
  if (column !== W.CHECKBOX || row <= 1) {
    const role = v12GetCurrentUserRole();
    if (column !== W.CHECKBOX && role !== V12_CONFIG.ROLES.ADMIN) {
      v12RevertEdit(e);
    }
    return;
  }
  const positionId = sheet.getRange(row, W.POSITION_ID).getValue();
  const checked = v12IsChecked(e.range.getValue());
  if (checked) {
    const result = v12MarkReceivedByProduction(positionId, V12_CONFIG.SOURCE_UI.WORKING_BOM);
    if (result && result.status === "blocked") {
      v12RevertEdit(e);
      try { SpreadsheetApp.getUi().alert("Не удалось передать: " + result.reason); } catch (e2) {}
    }
  }
}

/**
 * Откат запрещённой ручной правки.
 */
function v12RevertEdit(e) {
  try {
    if (e && e.range && e.oldValue !== undefined) {
      e.range.setValue(e.oldValue);
    }
  } catch (err) {
    logSystem("v12RevertEdit", err.message, err, "ERROR");
  }
}

/**
 * Плановое обновление: полная синхронизация всех BOM + пересчёт + проекции.
 */
function v12ScheduledUpdate() {
  const lock = acquireScriptLock();
  try {
    v12RunFullSync();
  } catch (error) {
    logSystem("v12ScheduledUpdate", error.message, error, "ERROR");
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * Установить «Выполнено» для BOM (в EXCLUDED_BOMS).
 */
function v12SetBomDone(bomId, done) {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.EXCLUDED_BOMS);
  if (!sheet) {
    return;
  }
  const data = readSheetValues(sheet);
  const B = V12_CONFIG.EXCLUDED_BOMS_COLUMNS;
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (v12Norm(data[i][B.BOM_ID - 1]) === v12Norm(bomId)) {
      foundRow = i + 1;
      break;
    }
  }
  if (done) {
    if (foundRow === -1) {
      appendRow(sheet, [bomId, true, new Date()]);
    } else {
      sheet.getRange(foundRow, B.DONE).setValue(true);
      sheet.getRange(foundRow, B.DATE).setValue(new Date());
    }
  } else {
    if (foundRow !== -1) {
      sheet.getRange(foundRow, B.DONE).setValue(false);
    }
  }
  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.MARK_DONE,
    bomId: bomId,
    field: "COMPLETED_FLAG",
    oldValue: !done,
    newValue: done
  });
  v12RefreshDashboard();
  v12FlushAudit();
}

/**
 * Запуск полной синхронизации (меню).
 */
function v12RunFullSync() {
  const lock = acquireScriptLock();
  try {
    logSystem("v12RunFullSync", "Старт синхронизации V12", "INFO");

    const files = v12ListSourceBOMFiles();
    // Индексы строятся ОДИН раз на весь прогон (а не на каждый BOM) — это снимает
    // тысячи полных чтений POSITION_STATE/BOM_REGISTRY при массовой синхронизации.
    // Новые позиции дописываются в этот же индекс внутри v12PersistNewPositions.
    const positionIndex = v12BuildPositionIndex();
    const registryIndex = v12BuildBomRegistryIndex();
    let totalAdded = 0;
    let totalRemoved = 0;
    let totalChanged = 0;

    files.forEach(function (file) {
      const source = v12ReadSourceBOM(file);
      if (source) {
        const result = v12SyncBOM(source, positionIndex, registryIndex);
        totalAdded += result.added;
        totalRemoved += result.removed;
        if (result.changed) {
          totalChanged++;
        }
      }
    });

    v12RecalculateWarehouseConsistency();
    v12RefreshAllProjections();

    logSystem("v12RunFullSync", "Синхронизировано BOM: " + files.length +
      ", добавлено: " + totalAdded + ", удалено: " + totalRemoved + ", изменено: " + totalChanged, "INFO");
  } catch (error) {
    logSystem("v12RunFullSync", error.message, error, "ERROR");
    throw error;
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}
