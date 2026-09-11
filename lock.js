/**
 * =====================================================
 * BOM CONTROL SYSTEM
 *
 * FILE: lock.js
 *
 * Единый механизм блокировок (ScriptLock) — общий сервис.
 * =====================================================
 */

let _lockDepth = 0;
let _heldLock = null;

/**
 * Реентрантный ScriptLock: повторный вызов внутри той же
 * операции не блокируется, а только увеличивает счётчик.
 *
 * options (опц.):
 *   { tryOnly: true, timeoutMs: N } — НЕ ждать бесконечно: попытаться взять
 *   лок и, если не удалось, вернуть null (вызывающий сам решает, что делать).
 *   Используется в onEdit, чтобы не «зависнуть» на 30 с во время часового
 *   полного синка и не потерять правку молча.
 *
 * Без options поведение прежнее: waitLock с V12_CONFIG.SETTINGS.LOCK_TIMEOUT
 * (бросает исключение при тайм-ауте).
 */
function acquireScriptLock(options) {
  if (_lockDepth > 0) {
    _lockDepth++;
    return { releaseLock: function () { _lockDepth--; } };
  }

  const opts = options || {};
  const timeoutMs = (opts.timeoutMs === undefined || opts.timeoutMs === null)
    ? V12_CONFIG.SETTINGS.LOCK_TIMEOUT
    : opts.timeoutMs;
  const lock = LockService.getScriptLock();

  if (opts.tryOnly) {
    if (!lock.tryLock(timeoutMs)) {
      return null;
    }
  } else {
    lock.waitLock(timeoutMs);
  }

  _heldLock = lock;
  _lockDepth = 1;

  return {
    releaseLock: function () {
      if (_lockDepth === 1) {
        _lockDepth = 0;
        if (_heldLock) {
          _heldLock.releaseLock();
          _heldLock = null;
        }
      } else {
        _lockDepth--;
      }
    }
  };
}
