/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_trigger.js
 *
 * Триггеры V12: onEdit + time-based (часовая синхронизация источника).
 *
 * V3 — модель «Применить». onEdit НИЧЕГО не пересчитывает: правки редактируемых
 * полей (чекбоксы ОТБОРКИ / WORKING BOM / Сводки и «Заказано» / «Ожидаемая» в
 * Сводке) он только ФИКСИРУЕТ в очереди PENDING_EDITS. Применение выполняет
 * пользователь кнопкой «✅ Применить изменения» (v12ApplyChanges).
 *
 * Автоприменения (инлайн-слив из onEdit) и минутного фонового триггера БОЛЬШЕ
 * НЕТ, поэтому фоновая пересборка проекций не конкурирует с набором текста в
 * ячейке — первопричина «сброса введённых значений» устранена.
 *
 * Медленный путь (в блокировке) остался только у правок, которые обязаны
 * срабатывать немедленно и к пересборке проекций по кнопке не относятся:
 * физический склад (MATERIAL_STATE) и фильтр проекта в ОТБОРКЕ (B1).
 *
 * Чекбокс «Выполнено» дашборда обрабатывается БЫСТРЫМ путём (очередь
 * PENDING_EDITS, поле DASHBOARD_DONE) — так же, как чекбоксы «Сводки дефицитов»,
 * и применяется кнопкой «ПРИМЕНИТЬ» (v12ApplyChanges → v12SetBomDone).
 * Остальные колонки дашборда остаются read-only.
 * =====================================================
 */

/**
 * Удалить проектные триггеры V12 (только наши: v12OnEdit, v12ScheduledUpdate).
 *
 * Раньше функция удаляла ВСЕ триггеры проекта, что уничтожало пользовательские
 * и сторонние триггеры. Теперь удаляются только обработчики V12.
 */
function removeV11Triggers() {
  const ours = { v12OnEdit: true, v12ScheduledUpdate: true, v12ScheduledQueueDrain: true };
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
  // Часовая синхронизация источника BOM (импорт новых BOM — не про правки).
  ScriptApp.newTrigger("v12ScheduledUpdate")
    .timeBased()
    .everyHours(1)
    .create();
  // V3 — модель «Применить»: периодического слива очереди БОЛЬШЕ НЕТ.
  // Применение намерений выполняет пользователь кнопкой «✅ Применить изменения»
  // (v12ApplyChanges). При переустановке старый минутный триггер
  // v12ScheduledQueueDrain удаляется (см. removeV11Triggers).
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
    // остальных листов — до любой работы.
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

    // === Быстрый путь: фиксация намерения (очередь PENDING_EDITS) =========
    // Без лока и без тяжёлой работы. Применение (V3) выполняет пользователь
    // кнопкой «✅ Применить изменения» (v12ApplyChanges).
    if (v12CaptureCheckboxEdit(e, name)) {
      return;   // намерение зафиксировано; применение — по кнопке
    }

    // === Медленный путь: правки, срабатывающие немедленно ================
    // POSITION_STATE — ручное редактирование запрещено (кроме Admin).
    if (name === S.POSITION_STATE) {
      v12HandlePositionStateEdit(e);
      return;
    }

    // ОТБОРКА: смена фильтра проекта в B1 пересобирает лист; остальные колонки
    // read-only (чекбокс передачи фиксирует очередь — см. быстрый путь).
    if (name === S.PICKING) {
      if (e.range.getRow() === 1 && e.range.getColumn() === V12_CONFIG.PICKING_COLUMNS.BOM_NAME) {
        v12WithEditLock(e, function () { v12RefreshPicking(); });
        return;
      }
      v12RevertEdit(e);
      return;
    }

    // WORKING BOM: всё read-only, кроме чекбокса передачи (он в очереди).
    if (name === S.WORKING_BOM) {
      v12RevertEdit(e);
      return;
    }

    // Сводка дефицитов: сюда дошли только правки, НЕ затрагивающие
    // редактируемых колонок (диапазон без «Заказано»/«Ожидаемой»/«Реальной
    // поставки»). Откатить диапазон нельзя (нет oldValue) — фиксируем в логе:
    // read-only колонки восстановятся при ближайшем «Применить изменения».
    if (name === S.DEFICIT_SUMMARY) {
      logSystem("v12OnEdit",
        "Правка read-only колонок сводки будет восстановлена при применении изменений", "WARNING");
      return;
    }

    // DASHBOARD — только чекбокс «Выполнено» одиночной ячейкой.
    if (name === S.DASHBOARD) {
      if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) {
        v12RevertEdit(e);
        return;
      }
      v12WithEditLock(e, function () { v12HandleDashboardEdit(e); });
      return;
    }

    // MATERIAL_STATE (физический склад) — одиночные правки под локом.
    if (name === S.MATERIAL_STATE) {
      if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) {
        return;
      }
      v12WithEditLock(e, function () { v12HandleMaterialStateEdit(e); });
      return;
    }
  } catch (error) {
    logSystem("v12OnEdit", error.message, error, "ERROR");
  }
}

/**
 * Выполнить немедленную (не через очередь) правку под общескриптовой
 * блокировкой.
 *
 * Если лок не удалось взять за 10 с (идёт «Применить изменения» или полная
 * синхронизация) — НИКАКИХ модальных окон: тихо логируем и откатываем правку,
 * чтобы не осталось «применённое-но-не-записанное» состояние.
 */
function v12WithEditLock(e, fn) {
  const lock = acquireScriptLock({ tryOnly: true, timeoutMs: 10000 });
  if (!lock) {
    logSystem("v12OnEdit",
      "Лок занят, правка отложена/откатана: " +
      (e.range.getA1Notation ? e.range.getA1Notation() : "?"), "WARNING");
    v12RevertEdit(e);
    return false;
  }
  try {
    fn();
    return true;
  } finally {
    lock.releaseLock();
    v12FlushAudit();
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
    // Пересчитываем контрольные RESERVED_QTY/FREE_QTY склада, чтобы они не
    // «расходились» до ближайшего полного синка (контроль ТЗ №30).
    v12RecalculateWarehouseConsistency();
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
 * Dashboard: медленный путь (read-only-guard). Чекбокс «Выполнено»
 * обрабатывается БЫСТРЫМ путём onEdit (v12CaptureCheckboxEdit → очередь
 * PENDING_EDITS, поле DASHBOARD_DONE) ровно как чекбоксы «Сводки дефицитов», а
 * применение выполняет кнопка «ПРИМЕНИТЬ» (v12ApplyChanges → v12SetBomDone).
 *
 * Сюда доходят только правки, НЕ затрагивающие колонку «Выполнено»: это
 * read-only колонки дашборда — они откатываются. Если по какой-то причине
 * сюда попало изменение самого чекбокса, синхронно его НЕ применяем (иначе
 * проекции пересобрались бы посреди слива очереди) — фиксируем в логе.
 */
function v12HandleDashboardEdit(e) {
  const D = V12_CONFIG.DASHBOARD_COLUMNS;
  if (e.range.getColumn() === D.DONE && e.range.getRow() > 1) {
    v12RevertEdit(e);
    logSystem("v12HandleDashboardEdit",
      "Чекбокс «Выполнено» применяется очередью — нажмите «ПРИМЕНИТЬ»", "WARNING");
    return;
  }
  v12RevertEdit(e);
  logSystem("v12OnEdit", "В дашборде разрешён только чекбокс «Выполнено»", "WARNING");
}

/**
 * Готов ли BOM к отметке «Выполнено»: все его позиции переданы производству
 * (BOM-статус «Скомплектован, готов к работе»). Считается из POSITION_STATE,
 * а не из текста ячейки «Статус».
 */
function v12IsBomReadyForDone(bomId) {
  const id = normalizeMaterialId(bomId);
  if (!id) {
    return false;
  }
  const agg = v12AggregateBomStates();
  const a = agg[id];
  return !!a && v12ComputeBomStatus(a) === V12_CONFIG.BOM_STATUS.READY;
}

/**
 * Откат запрещённой ручной правки.
 *
 * Для одиночной ячейки onEdit отдаёт `oldValue` — значение восстанавливается.
 * Для ДИАПАЗОНА `oldValue` отсутствует, и точный откат технически невозможен:
 * раньше функция в этом случае молча ничего не делала (баг C-4 отчёта №33),
 * из-за чего запрещённая правка диапазона оставалась применённой без следа.
 * Теперь такой случай явно фиксируется в системном логе (WARNING), чтобы он
 * не оставался «незамеченным».
 */
function v12RevertEdit(e) {
  try {
    if (!e || !e.range) {
      return;
    }
    if (e.oldValue !== undefined) {
      e.range.setValue(e.oldValue);
      return;
    }
    const numCells = (e.range.getNumRows ? e.range.getNumRows() : 1) *
      (e.range.getNumColumns ? e.range.getNumColumns() : 1);
    if (numCells > 1) {
      logSystem("v12RevertEdit",
        "Запрещённая правка диапазона " + (e.range.getA1Notation ? e.range.getA1Notation() : "?") +
        " на листе «" + (e.range.getSheet ? e.range.getSheet().getName() : "?") +
        "» не может быть откачена автоматически (нет oldValue)", "WARNING");
      return;
    }
    logSystem("v12RevertEdit", "Откат невозможен: нет oldValue для одиночной ячейки", "WARNING");
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
 * Установить/снять «Выполнено» для BOM (лист EXCLUDED_BOMS). Отмеченный BOM
 * убирается из активного дашборда (v12RefreshDashboard фильтрует excluded).
 *
 * skipRefresh=true — ПАКЕТНЫЙ режим (вызов из v12ApplyDashboardDoneIntent в
 * составе слива очереди): запись и аудит делаются, но дашборд НЕ пересобирается
 * здесь — проекции пересобираются ОДИН раз в конце v12DrainPendingEdits.
 *
 * Возвращает { status: "applied" | "already" | "blocked", reason? }.
 */
function v12SetBomDone(bomId, done, skipRefresh) {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.EXCLUDED_BOMS);
  if (!sheet) {
    return { status: "blocked", reason: "Лист EXCLUDED_BOMS не найден" };
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
  // Текущее состояние «Выполнено» (идемпотентность: повтор не пишет заново).
  const alreadyDone = foundRow !== -1 && v12IsChecked(data[foundRow - 1][B.DONE - 1]);
  if (alreadyDone === !!done) {
    return { status: "already" };
  }
  if (done) {
    if (foundRow === -1) {
      appendRow(sheet, [bomId, true, new Date()]);
    } else {
      sheet.getRange(foundRow, B.DONE).setValue(true);
      sheet.getRange(foundRow, B.DATE).setValue(new Date());
    }
  } else {
    sheet.getRange(foundRow, B.DONE).setValue(false);
  }
  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.MARK_DONE,
    bomId: bomId,
    field: "COMPLETED_FLAG",
    oldValue: !done,
    newValue: done
  });
  if (!skipRefresh) {
    v12RefreshDashboard();
    v12FlushAudit();
  }
  return { status: "applied" };
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
    // POSITION_STATE читается ОДИН раз, из него строятся оба индекса: по positionId
    // и по BOM (positionsByBom — получать позиции конкретного BOM за O(1)).
    // Новые позиции дописываются в positionIndex внутри v12PersistNewPositions.
    const posData = v12ReadSheet("POSITION_STATE");
    const positionIndex = v12BuildPositionIndex(posData);
    const positionsByBom = v12BuildPositionsByBomIndex(posData);
    const registryIndex = v12BuildBomRegistryIndex();
    let totalAdded = 0;
    let totalRemoved = 0;
    let totalChanged = 0;

    files.forEach(function (file) {
      const source = v12ReadSourceBOM(file);
      if (source) {
        const result = v12SyncBOM(source, positionIndex, registryIndex, positionsByBom);
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
