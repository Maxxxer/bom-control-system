/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: bom_state_engine.js
 *
 * Пересчёт состояния BOM.
 * «Готов» = все позиции BOM получены производством.
 * =====================================================
 */

function recalculateBOMState() {
  const lock = acquireScriptLock();
  try {
    const materialSheet = getSheetByKey("MATERIAL_STATE");
    const bomSheet = getSheetByKey("BOM_STATE");
    const data = readSheetValues(materialSheet);
    const C = V11_CONFIG.MATERIAL_COLUMNS;

    if (data.length <= 1) {
      return [];
    }

    const bomMap = {};

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
          ready: 0,
          notOrdered: 0,
          partial: 0,
          late: 0,
          waiting: 0,
          stock: 0,
          received: 0,
          created: row[C.UPDATED - 1] || "",
          maxExpected: null,
          maxDeadline: null
        };
      }

      const item = bomMap[bom];
      item.total++;

      const required = toNumber(row[C.REQUIRED - 1]);
      const ordered = toNumber(row[C.ORDERED - 1]);
      const realDelivery = row[C.REAL_DELIVERY - 1] === true;
      const received = row[C.RECEIVED - 1] === true;
      const expected = row[C.EXPECTED_DATE - 1];
      const deadline = row[C.DEADLINE_DATE - 1];

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
      if (realDelivery) {
        item.stock++;
        continue;
      }
      if (required > 0 && ordered === 0) {
        item.notOrdered++;
        continue;
      }
      if (ordered > 0 && ordered < required) {
        item.partial++;
        continue;
      }
      if (ordered >= required && required > 0) {
        if (expected && deadline && new Date(expected) > new Date(deadline)) {
          item.late++;
        } else {
          item.waiting++;
        }
      }
    }

    const output = [];

    Object.keys(bomMap).forEach((bom) => {
      const item = bomMap[bom];

      // «Готов» = все позиции получены производством
      const allReceived = item.received === item.total && item.total > 0;

      let status;
      if (allReceived) {
        status = V11_CONFIG.BOM_STATUS.GREEN;
      } else if (item.notOrdered > 0) {
        status = V11_CONFIG.BOM_STATUS.RED;
      } else if (item.partial > 0) {
        status = V11_CONFIG.BOM_STATUS.PARTIAL;
      } else if (item.late > 0) {
        status = V11_CONFIG.BOM_STATUS.ORANGE;
      } else if (item.waiting > 0) {
        status = V11_CONFIG.BOM_STATUS.YELLOW;
      } else {
        // Позиции на складе, но не все получены производством — не «Готов»
        status = V11_CONFIG.BOM_STATUS.YELLOW;
      }

      // Готовность = число полученных позиций
      const readyCount = item.received;

      output.push([
        bom,
        item.version,
        item.created || "",
        item.total,
        item.notOrdered + item.partial,
        item.notOrdered,
        item.maxExpected || "",
        item.maxDeadline || "",
        status,
        readyCount,
        new Date()
      ]);
    });

    clearBody(bomSheet);

    if (output.length > 0) {
      writeValues(bomSheet, 2, 1, output);
    }

    logSystem("recalculateBOMState", "Обработано BOM: " + output.length, "INFO");
    return output;
  } catch (error) {
    logSystem("recalculateBOMState", error.message, error, "ERROR");
    return [];
  } finally {
    lock.releaseLock();
  }
}
