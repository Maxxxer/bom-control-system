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
 * Удалить все проектные триггеры (в т.ч. оставшиеся от V11).
 */
function removeV11Triggers() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    ScriptApp.deleteTrigger(trigger);
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
    // В сводке дефицитов поддерживаем вставку/автозаполнение диапазона —
    // обрабатываем каждую ячейку. Прочие листы — только одиночные правки.
    const isSummaryRange = !isSingleCell && name === S.DEFICIT_SUMMARY;
    if (!isSingleCell && !isSummaryRange) {
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
  const checked = e.range.getValue();
  if (checked === true && status !== V12_CONFIG.BOM_STATUS.READY) {
    v12RevertEdit(e);
    logSystem("v12OnEdit", "«Выполнено» можно отметить только при «Готов к производству»: " + bomId, "WARNING");
    return;
  }
  v12SetBomDone(bomId, checked === true);
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
    const checked = newValue;
    try {
      v12SetRealDeliveryQty(positionId, checked === true ? v12GetDeficitRequiredQty(positionId) : 0);
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
 * DEFICIT_SUMMARY: обработка диапазона (вставка/автозаполнение) — каждая
 * ячейка в редактируемых колонках обрабатывается как отдельная правка.
 */
function v12HandleDeficitRangeEdit(e) {
  const D = V12_CONFIG.DEFICIT_COLUMNS;
  const sheet = e.range.getSheet();
  const firstRow = e.range.getRow();
  const firstCol = e.range.getColumn();
  const numRows = e.range.getNumRows();
  const numCols = e.range.getNumColumns();
  // Снимок значений из события (если доступен) — надёжнее живого чтения.
  const values = (e.values && e.values.length === numRows)
    ? e.values
    : e.range.getValues();

  for (let r = 0; r < numRows; r++) {
    const sheetRow = firstRow + r;
    const positionId = sheet.getRange(sheetRow, D.POSITION_ID).getValue();
    if (!positionId) {
      continue;
    }
    for (let c = 0; c < numCols; c++) {
      const column = firstCol + c;
      const value = values[r][c];
      if (column === D.ORDERED_QTY) {
        v12SetOrderedQty(positionId, value);
      } else if (column === D.EXPECTED_DATE) {
        v12SetExpectedDate(positionId, value);
      } else if (column === D.REAL_DELIVERY) {
        try {
          v12SetRealDeliveryQty(positionId, value === true ? v12GetDeficitRequiredQty(positionId) : 0);
        } catch (err) {
          // гейт поставки — пропускаем эту ячейку, остальные обрабатываем
        }
      }
    }
  }
}

/**
 * ОТБОРКА (PICKING): чекбокс передачи производству (кол. 13).
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
  if (checked === true) {
    const result = v12MarkReceivedByProduction(positionId, V12_CONFIG.SOURCE_UI.PICKING);
    if (result.status === "blocked") {
      v12RevertEdit(e);
      SpreadsheetApp.getUi().alert("Не удалось передать: " + result.reason);
    }
  }
}

/**
 * WORKING BOM: чекбокс передачи производству (кол. 13).
 */
function v12HandleWorkingBomEdit(e) {
  const W = V12_CONFIG.WORKING_BOM_COLUMNS;
  const sheet = e.range.getSheet();
  const column = e.range.getColumn();
  const row = e.range.getRow();
  if (column !== W.PRODUCTION_STATE) {
    // В WORKING BOM нет чекбокса передачи; обрабатываем только через производство
    // (поле отображается readonly). Допускаем только Admin.
    const role = v12GetCurrentUserRole();
    if (role !== V12_CONFIG.ROLES.ADMIN) {
      v12RevertEdit(e);
    }
    return;
  }
  const positionId = sheet.getRange(row, W.POSITION_ID).getValue();
  const checked = e.range.getValue();
  if (checked === true) {
    v12MarkReceivedByProduction(positionId, V12_CONFIG.SOURCE_UI.WORKING_BOM);
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
 * Флаг занятости (защита от рекурсии). V12 использует свою пару ключей.
 */
function v12IsBusy() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty("V12_RECALCULATING") === "true";
}

function v12SetBusy(flag) {
  PropertiesService.getScriptProperties().setProperty("V12_RECALCULATING", String(flag));
}

/**
 * Плановое обновление: полная синхронизация всех BOM + пересчёт + проекции.
 */
function v12ScheduledUpdate() {
  const lock = acquireScriptLock();
  try {
    v12SetBusy(true);
    v12RunFullSync();
  } catch (error) {
    logSystem("v12ScheduledUpdate", error.message, error, "ERROR");
  } finally {
    v12SetBusy(false);
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
    v12SetBusy(true);
    logSystem("v12RunFullSync", "Старт синхронизации V12", "INFO");

    const files = v12ListSourceBOMFiles();
    let totalAdded = 0;
    let totalRemoved = 0;
    let totalChanged = 0;

    files.forEach(function (file) {
      const source = v12ReadSourceBOM(file);
      if (source) {
        const result = v12SyncBOM(source);
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
    v12SetBusy(false);
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}
