/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_audit.js
 *
 * AUDIT_LOG — структурированный журнал действий (ТЗ №109–113).
 * Хранит operationId, старое/новое значение, BOM, позицию,
 * пользователя, причину. operationId группирует связанные изменения.
 * =====================================================
 */

let _v12AuditBuffer = [];
let _v12AuditThreshold = 40;

/**
 * Сбросить буфер аудита одним вызовом.
 */
function v12FlushAudit() {
  if (!_v12AuditBuffer.length) {
    return;
  }
  const sheet = getSheetByName(V12_CONFIG.SHEETS.AUDIT_LOG);
  if (!sheet) {
    _v12AuditBuffer = [];
    return;
  }
  try {
    const rows = _v12AuditBuffer;
    _v12AuditBuffer = [];
    writeValues(sheet, sheet.getLastRow() + 1, 1, rows);
  } catch (e) {
    _v12AuditBuffer = [];
    console.error("v12FlushAudit failed: " + e.message);
  }
}

/**
 * Записать одну запись аудита (буферизованно).
 *
 * entry: {
 *   operationId, action (V12_CONFIG.AUDIT_ACTIONS), bomId, positionId,
 *   field, oldValue, newValue, reason, data
 * }
 */
function v12Audit(entry) {
  if (V12_CONFIG.SETTINGS.ENABLE_AUDIT === false) {
    return;
  }
  const A = V12_CONFIG.AUDIT_COLUMNS;
  const e = entry || {};
  const oldVal = e.oldValue === undefined ? "" : (typeof e.oldValue === "string" ? e.oldValue : JSON.stringify(e.oldValue));
  const newVal = e.newValue === undefined ? "" : (typeof e.newValue === "string" ? e.newValue : JSON.stringify(e.newValue));
  const dataText = e.data === undefined ? "" : (typeof e.data === "string" ? e.data : JSON.stringify(e.data));

  _v12AuditBuffer.push([
    new Date(),
    e.operationId || generateEventId(),
    e.actor || getCurrentUser(),
    e.action || "",
    e.bomId || "",
    e.positionId || "",
    e.field || "",
    oldVal,
    newVal,
    e.reason || "",
    dataText
  ]);

  if (_v12AuditBuffer.length >= _v12AuditThreshold) {
    v12FlushAudit();
  }
}
