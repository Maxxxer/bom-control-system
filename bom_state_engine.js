/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: bom_state_engine.js
 *
 * Пересчёт состояния BOM.
 * По ТЗ:
 *   «Не обработан»          — ни один элемент не заказан.
 *   «Частично отобран»      — часть позиций без заказа / заказ < дефицита / нет сроков.
 *   «Ожидание поставки (в срок)» — все заказаны достаточно, все даты ≤ крайних.
 *   «Ожидание поставки (опаздывает)» — все заказаны, но есть дата > крайнего срока.
 *   «Готов к производству»  — все позиции получены производством.
 * =====================================================
 */

// Кэш агрегатов по BOM, используется дашбордом в том же вызове.
let _bomStateCache = {};

/**
 * Получить кэш агрегатов по BOM (для дашборда).
 */
function getBOMStateCache() {
  return _bomStateCache;
}

/**
 * Пересчёт состояния BOM. Возвращает массив строк для BOM_STATE.
 */
function recalculateBOMState() {
  const lock = acquireScriptLock();
  try {
    const materialSheet = getSheetByKey("MATERIAL_STATE");
    const bomSheet = getSheetByKey("BOM_STATE");
    const data = readSheetValues(materialSheet);
    const C = V11_CONFIG.MATERIAL_COLUMNS;

    if (data.length <= 1) {
      _bomStateCache = {};
      return [];
    }

    const bomMap = {};

    // Дата создания BOM — из BOM_REVISION (самая ранняя дата по BOM)
    const bomCreatedMap = {};
    const revSheet = getSheetByKey("BOM_REVISION");
    const revData = readSheetValues(revSheet);
    const BC = V11_CONFIG.BOM_REVISION_COLUMNS;
    for (let ri = 1; ri < revData.length; ri++) {
      const rBom = normalizeMaterialId(revData[ri][BC.BOM - 1]);
      const rDate = revData[ri][BC.DATE - 1];
      if (rBom && rDate) {
        if (!bomCreatedMap[rBom] || new Date(rDate) < new Date(bomCreatedMap[rBom])) {
          bomCreatedMap[rBom] = rDate;
        }
      }
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const bom = normalizeMaterialId(row[C.BOM - 1]);
      if (!bom) {
        continue;
      }

      const state = row[C.STATE - 1];
      if (state === V11_CONFIG.MATERIAL_STATE.REMOVED) {
        continue;
      }

      if (!bomMap[bom]) {
        bomMap[bom] = {
          version: row[C.BOM_VERSION - 1] || "V1",
          total: 0,
          received: 0,
          stock: 0,
          errors: 0,
          notOrdered: 0,
          partial: 0,
          noExpectedDate: 0,
          late: 0,
          onTime: 0,
          created: bomCreatedMap[bom] || row[C.UPDATED - 1] || "",
          maxExpected: null,
          maxDeadline: null,
          missing: []
        };
      }

      const item = bomMap[bom];
      item.total++;

      const required = toNumber(row[C.REQUIRED - 1]);
      const reserved = toNumber(row[C.RESERVED - 1]);
      const ordered = toNumber(row[C.ORDERED - 1]);
      const realDelivery = row[C.REAL_DELIVERY - 1] === true;
      const received = row[C.RECEIVED - 1] === true;
      const expected = row[C.EXPECTED_DATE - 1];
      const deadline = row[C.DEADLINE_DATE - 1];
      const deficit = Math.max(required - reserved, 0);

      // Валидация обязательных полей BOM
      const missRow = !String(row[C.BOM_ROW - 1] || "").trim();
      const missCode = !String(row[C.MATERIAL_CODE - 1] || "").trim();
      const missUnit = !String(row[C.UNIT - 1] || "").trim();
      const missQty = required <= 0;
      const missDeadline = deadline === "" || deadline === null || deadline === undefined;
      const hasError = missRow || missCode || missUnit || missQty || missDeadline;

      if (expected) {
        const d = new Date(expected);
        if (!item.maxExpected || isNaN(new Date(item.maxExpected)) || d > new Date(item.maxExpected)) {
          item.maxExpected = expected;
        }
      }
      if (deadline) {
        const d = new Date(deadline);
        if (!item.maxDeadline || isNaN(new Date(item.maxDeadline)) || d > new Date(item.maxDeadline)) {
          item.maxDeadline = deadline;
        }
      }

      if (received) {
        item.received++;
        continue;
      }
      if (hasError) {
        item.errors++;
        item.missing.push({
          code: row[C.MATERIAL_CODE - 1],
          name: row[C.MATERIAL_NAME - 1],
          required: required,
          reserved: reserved,
          deficit: deficit,
          ordered: ordered,
          reason: "Ошибка данных"
        });
        continue;
      }
      if (realDelivery) {
        item.stock++;
        continue;
      }
      if (ordered <= 0) {
        item.notOrdered++;
        item.missing.push({
          code: row[C.MATERIAL_CODE - 1],
          name: row[C.MATERIAL_NAME - 1],
          required: required,
          reserved: reserved,
          deficit: deficit,
          ordered: ordered,
          reason: "Не заказано"
        });
        continue;
      }
      if (ordered < deficit) {
        item.partial++;
        item.missing.push({
          code: row[C.MATERIAL_CODE - 1],
          name: row[C.MATERIAL_NAME - 1],
          required: required,
          reserved: reserved,
          deficit: deficit,
          ordered: ordered,
          reason: "Заказано меньше потребности"
        });
        continue;
      }
      if (!expected) {
        item.noExpectedDate++;
        item.missing.push({
          code: row[C.MATERIAL_CODE - 1],
          name: row[C.MATERIAL_NAME - 1],
          required: required,
          reserved: reserved,
          deficit: deficit,
          ordered: ordered,
          reason: "Не указана дата поставки"
        });
        continue;
      }
      if (expected && deadline && new Date(expected) > new Date(deadline)) {
        item.late++;
      } else {
        item.onTime++;
      }
    }

    const output = [];
    const cache = {};

    Object.keys(bomMap).forEach((bom) => {
      const item = bomMap[bom];

      const allReceived = item.received === item.total && item.total > 0;
      const fullyOrdered = item.onTime + item.stock + item.late; // позиции с достаточным заказом

      let status;
      if (allReceived) {
        status = V11_CONFIG.BOM_STATUS.READY;
      } else if (item.errors > 0) {
        status = V11_CONFIG.BOM_STATUS.ERROR;
      } else if (item.notOrdered === item.total) {
        status = V11_CONFIG.BOM_STATUS.NOT_PROCESSED;
      } else if (item.partial > 0 || item.noExpectedDate > 0 || item.notOrdered > 0) {
        status = V11_CONFIG.BOM_STATUS.PARTIAL_SELECTED;
      } else if (item.late > 0) {
        status = V11_CONFIG.BOM_STATUS.WAITING_LATE;
      } else if (fullyOrdered > 0) {
        status = V11_CONFIG.BOM_STATUS.WAITING_ON_TIME;
      } else {
        status = V11_CONFIG.BOM_STATUS.PARTIAL_SELECTED;
      }

      const notSatisfied = item.notOrdered + item.partial + item.noExpectedDate + item.errors;

      const missingText = item.missing
        .map(function (m) {
          return (m.code || m.name) + ": требуется " + m.deficit + ", заказано " + m.ordered +
            (m.reason ? " (" + m.reason + ")" : "");
        })
        .join("; ");

      cache[bom] = {
        status: status,
        created: item.created || "",
        total: item.total,
        deficit: notSatisfied,
        notOrdered: item.notOrdered,
        lastDelivery: item.maxExpected || "",
        deadline: item.maxDeadline || "",
        ready: item.received,
        missingItems: missingText
      };

      output.push([
        bom,
        item.version,
        item.created || "",
        item.total,
        notSatisfied,
        item.notOrdered,
        item.maxExpected || "",
        item.maxDeadline || "",
        status,
        item.received,
        new Date()
      ]);
    });

    _bomStateCache = cache;

    clearBody(bomSheet);

    if (output.length > 0) {
      writeValues(bomSheet, 2, 1, output);
    }

    logSystem("recalculateBOMState", "Обработано BOM: " + output.length, "INFO");
    return output;
  } catch (error) {
    logSystem("recalculateBOMState", error.message, error, "ERROR");
    _bomStateCache = {};
    return [];
  } finally {
    lock.releaseLock();
  }
}
