/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_handoff.js
 *
 * Единая идемпотентная операция производственной передачи (ТЗ №25–27, №96):
 *   v12MarkReceivedByProduction(positionId, sourceUI)
 * и возврат из архива (ТЗ №78–82):
 *   v12ReturnFromArchive(positionId, reason)
 *
 * К6: возврат уменьшает receivedByProductionQty и возвращает количество
 *     на склад; позиция снова становится активной.
 * =====================================================
 */

/**
 * Идемпотентная передача позиции производству.
 * sourceUI: из V12_CONFIG.SOURCE_UI (PICKING / WORKING_BOM).
 * Возвращает { status: "handoff" | "already" | "blocked", reason? }.
 */
function v12MarkReceivedByProduction(positionId, sourceUI, skipRefresh, ctx) {
  const lock = acquireScriptLock();
  try {
    const role = v12GetCurrentUserRole();
    const action = sourceUI === V12_CONFIG.SOURCE_UI.WORKING_BOM
      ? "WORKING_BOM_CHECKBOX"
      : "PICKING_CHECKBOX";
    v12RequireRole(role, action);

    // ctx позволяет при пакетной передаче переиспользовать общие индексы
    // POSITION_STATE/MATERIAL_STATE и накапливать складские дельты — так
    // применяется пачка намерений очереди (см. v12DrainPendingEdits).
    const index = (ctx && ctx.index) || v12BuildPositionIndex();
    const pos = v12GetPositionById(positionId, index);
    if (!pos) {
      return { status: "blocked", reason: "Позиция не найдена" };
    }

    const P = V12_CONFIG.POSITION_COLUMNS;
    const row = pos.values;
    const required = toNumber(row[P.REQUIRED_QTY - 1]);
    const available = toNumber(row[P.AVAILABLE_FOR_PRODUCTION - 1]);
    const received = row[P.RECEIVED_BY_PRODUCTION - 1] === true;
    const validation = row[P.VALIDATION_STATUS - 1];

    // Идемпотентность: если уже передано полностью — ничего не делаем
    if (received && toNumber(row[P.RECEIVED_BY_PRODUCTION_QTY - 1]) >= required) {
      return { status: "already", reason: "Позиция уже передана производству" };
    }

    // Валидация (ТЗ №24/№106): запрет частичной передачи без полной доступности
    if (validation !== V12_CONFIG.VALIDATION_STATUS.VALID) {
      return { status: "blocked", reason: "Позиция невалидна (заполните обязательные поля BOM)" };
    }
    if (available < required) {
      return {
        status: "blocked",
        reason: "Не хватает доступного количества: необходимо " + required + ", доступно " + available
      };
    }

    const operationId = generateEventId();
    const bomId = row[P.BOM_ID - 1];
    const materialKey = v12BuildMaterialKey({
      code: row[P.MATERIAL_CODE - 1],
      name: row[P.MATERIAL_NAME - 1],
      model: row[P.MODEL - 1],
      unit: row[P.UNIT - 1]
    });

    // Фиксация передачи
    v12UpdatePosition(positionId, {
      RECEIVED_BY_PRODUCTION: true,
      RECEIVED_BY_PRODUCTION_QTY: required,
      RECEIVED_BY_PRODUCTION_AT: new Date(),
      RECEIVED_BY_PRODUCTION_USER: v12CurrentActor()
    }, index);

    // Архивация позиции
    v12ArchivePosition(positionId, sourceUI, index);
    // Синхронизируем in-memory индекс (при пакетной обработке защищает от
    // повторной передачи той же позиции в одном диапазоне).
    row[P.RECEIVED_BY_PRODUCTION - 1] = true;
    row[P.RECEIVED_BY_PRODUCTION_QTY - 1] = required;
    row[P.LIFECYCLE_STATE - 1] = V12_CONFIG.LIFECYCLE_STATE.ARCHIVED;

    // Снять резерв с физического склада (передача = резерв перешёл в производство).
    // При пакетной обработке (ctx) дельты накапливаются и применяются ОДИН раз в
    // конце — иначе на каждую строку читается/пишется MATERIAL_STATE.
    if (ctx) {
      ctx.warehouseDelta[materialKey] = (ctx.warehouseDelta[materialKey] || 0) - required;
    } else {
      v12AdjustWarehouseQty(materialKey, -required);
    }

    // Аудит
    v12Audit({
      operationId: operationId,
      action: V12_CONFIG.AUDIT_ACTIONS.HANDOFF,
      bomId: bomId,
      positionId: positionId,
      field: "RECEIVED_BY_PRODUCTION",
      oldValue: false,
      newValue: true,
      reason: "Передано производству из " + sourceUI
    });
    v12LogHistory(positionId, "PRODUCTION_HANDOFF", "", required, "Передано из " + sourceUI);
    v12LogEvent(V12_CONFIG.AUDIT_ACTIONS.HANDOFF, positionId, bomId, { sourceUI: sourceUI, qty: required });

    // При массовой передаче (диапазон) пересчёт проекций делается один раз
    // вызывающей стороной — здесь пропускаем, чтобы не пересобирать лист на
    // каждую строку и не терять ещё не обработанные отметки.
    if (!skipRefresh) {
      v12RefreshProjections();
    }
    return { status: "handoff" };
  } catch (error) {
    v12Audit({
      action: V12_CONFIG.AUDIT_ACTIONS.HANDOFF,
      positionId: positionId,
      field: "ERROR",
      oldValue: "",
      newValue: "",
      reason: error.message
    });
    logSystem("v12MarkReceivedByProduction", error.message, error, "ERROR");
    return { status: "blocked", reason: error.message };
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * Архивация позиции: запись в ARCHIVE + lifecycle = ARCHIVED.
 */
function v12ArchivePosition(positionId, sourceUI, index) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const pos = v12GetPositionById(positionId, index);
  if (!pos) {
    return;
  }
  const row = pos.values;
  const A = V12_CONFIG.ARCHIVE_COLUMNS;
  const archive = v12GetSheetByKey("ARCHIVE");
  const history = v12GetPositionHistory(positionId);

  appendRow(archive, [
    new Date(),
    positionId,
    row[P.BOM_NAME - 1],
    row[P.BOM_ROW - 1],
    row[P.MATERIAL_CODE - 1],
    row[P.MATERIAL_NAME - 1],
    row[P.MODEL - 1],
    row[P.UNIT - 1],
    row[P.RECEIVED_BY_PRODUCTION_QTY - 1],
    row[P.RECEIVED_BY_PRODUCTION_AT - 1],
    row[P.RECEIVED_BY_PRODUCTION_USER - 1],
    sourceUI || "",
    JSON.stringify(history)
  ]);

  v12UpdatePosition(positionId, {
    LIFECYCLE_STATE: V12_CONFIG.LIFECYCLE_STATE.ARCHIVED
  }, index);
}

/**
 * Возврат из архива (ТЗ №78–82). reason обязателен.
 * Возвращает { status: "returned" | "blocked", reason? }.
 */
function v12ReturnFromArchive(positionId, reason) {
  const lock = acquireScriptLock();
  try {
    const role = v12GetCurrentUserRole();
    v12RequireRole(role, "PICKING_CHECKBOX");
    if (!reason || !String(reason).trim()) {
      return { status: "blocked", reason: "Не указана причина возврата" };
    }

    const index = v12BuildPositionIndex();
    const pos = v12GetPositionById(positionId, index);
    if (!pos) {
      return { status: "blocked", reason: "Позиция не найдена" };
    }

    const P = V12_CONFIG.POSITION_COLUMNS;
    const row = pos.values;
    const returnedQty = toNumber(row[P.RECEIVED_BY_PRODUCTION_QTY - 1]);
    const materialKey = v12BuildMaterialKey({
      code: row[P.MATERIAL_CODE - 1],
      name: row[P.MATERIAL_NAME - 1],
      model: row[P.MODEL - 1],
      unit: row[P.UNIT - 1]
    });
    const bomId = row[P.BOM_ID - 1];

    // К6: возврат количества на склад + сброс флага
    v12UpdatePosition(positionId, {
      RECEIVED_BY_PRODUCTION: false,
      RECEIVED_BY_PRODUCTION_QTY: 0,
      RECEIVED_BY_PRODUCTION_AT: "",
      RECEIVED_BY_PRODUCTION_USER: "",
      LIFECYCLE_STATE: V12_CONFIG.LIFECYCLE_STATE.ACTIVE
    }, index);

    if (returnedQty > 0) {
      v12AdjustWarehouseQty(materialKey, returnedQty);
    }

    v12Audit({
      action: V12_CONFIG.AUDIT_ACTIONS.RETURN_FROM_ARCHIVE,
      bomId: bomId,
      positionId: positionId,
      field: "RECEIVED_BY_PRODUCTION",
      oldValue: true,
      newValue: false,
      reason: reason
    });
    v12LogHistory(positionId, "RETURN_FROM_ARCHIVE", returnedQty, 0, reason);

    v12RefreshProjections();
    return { status: "returned" };
  } catch (error) {
    logSystem("v12ReturnFromArchive", error.message, error, "ERROR");
    return { status: "blocked", reason: error.message };
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * Скорректировать складской остаток по materialKey (увеличить/уменьшить).
 */
function v12AdjustWarehouseQty(materialKey, delta, materialIndex) {
  const index = materialIndex || v12BuildMaterialIndex();
  const M = V12_CONFIG.MATERIAL_COLUMNS;
  const m = index.get(materialKey);
  if (!m) {
    const sheet = v12GetSheetByKey("MATERIAL_STATE");
    const row = new Array(V12_CONFIG.COLUMN_COUNT.MATERIAL_STATE).fill("");
    row[M.MATERIAL_KEY - 1] = materialKey;
    row[M.WAREHOUSE_QTY - 1] = Math.max(0, toNumber(delta));
    row[M.MATERIAL_CODE - 1] = materialKey;
    row[M.UPDATED_AT - 1] = new Date();
    appendRow(sheet, row);
    return;
  }
  const current = toNumber(m.values[M.WAREHOUSE_QTY - 1]);
  const next = Math.max(0, current + toNumber(delta));
  v12Audit({
    action: V12_CONFIG.AUDIT_ACTIONS.WAREHOUSE_QTY_CHANGED,
    field: "WAREHOUSE_QTY",
    oldValue: current,
    newValue: next,
    data: { materialKey: materialKey, delta: delta }
  });
  const sheet = v12GetSheetByKey("MATERIAL_STATE");
  batchWrite(sheet, [
    { row: m.row, col: M.WAREHOUSE_QTY, value: next },
    { row: m.row, col: M.UPDATED_AT, value: new Date() }
  ]);
}

/**
 * Применить накопленные складские дельты (пакетная передача) — по одному
 * вызову v12AdjustWarehouseQty на materialKey (ключам уникальны, поэтому общий
 * materialIndex безопасен).
 */
function v12ApplyWarehouseDeltas(deltas, materialIndex) {
  if (!deltas) {
    return;
  }
  Object.keys(deltas).forEach(function (mk) {
    const d = deltas[mk];
    if (d) {
      v12AdjustWarehouseQty(mk, d, materialIndex);
    }
  });
}

/**
 * История позиции (для архива) — из MATERIAL_HISTORY.
 */
function v12GetPositionHistory(positionId) {
  const sheet = getSheetByName(V12_CONFIG.SHEETS.MATERIAL_HISTORY);
  if (!sheet) {
    return [];
  }
  const data = readSheetValues(sheet);
  const H = V12_CONFIG.HISTORY_COLUMNS;
  const result = [];
  const id = normalizeMaterialId(positionId);
  for (let i = 1; i < data.length; i++) {
    if (normalizeMaterialId(data[i][H.POSITION_ID - 1]) === id) {
      result.push({
        date: data[i][H.DATE - 1],
        event: data[i][H.EVENT - 1],
        old: data[i][H.OLD_VALUE - 1],
        new: data[i][H.NEW_VALUE - 1],
        user: data[i][H.USER - 1],
        comment: data[i][H.COMMENT - 1]
      });
    }
  }
  return result;
}
