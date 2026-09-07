/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: lock.js
 *
 * Единый механизм блокировок (ScriptLock).
 * =====================================================
 */

let _lockDepth = 0;
let _heldLock = null;

/**
 * Реентрантный ScriptLock: повторный вызов внутри той же
 * операции не блокируется, а только увеличивает счётчик.
 */
function acquireScriptLock() {
  if (_lockDepth > 0) {
    _lockDepth++;
    return { releaseLock: function () { _lockDepth--; } };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(V11_CONFIG.SETTINGS.LOCK_TIMEOUT);
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
