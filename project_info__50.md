# BOM CONTROL SYSTEM V12 — РЕАЛИЗОВАНО: исправление «Dashboard не обновляется после передачи»

> **Статус:** РЕАЛИЗОВАНО (основной фикс §4.1 из `project_info__49.md`). `node --check` — 22 файла, 0 ошибок; **10 из 10** наборов `ALL TESTS PASSED`.
> **Основание:** диагностика — `project_info__49.md`; редизайн дашборда — `project_info__46.md`/`__47.md`/`__48.md`.

---

## 1. Причина (напоминание)

`v12MarkReceivedByProduction` (и `v12ReturnFromArchive`) писали только **сырые** поля `POSITION_STATE` (`RECEIVED_BY_PRODUCTION`, `LIFECYCLE_STATE`) через `v12UpdatePosition`, который пишет **лишь переданные столбцы** — и **не пересчитывали производные** (`PRODUCTION_STATE`, `DEFICIT_QTY`). Проекции на сырых полях (ОТБОРКА/Сводка/СНАБЖЕНИЕ) это не замечали, а **Dashboard** считает по производным — и потому «застывал».

---

## 2. Что изменено — `v12_handoff.js`

### `v12MarkReceivedByProduction`
После пометки строки (`RECEIVED_BY_PRODUCTION = true`, `RECEIVED_BY_PRODUCTION_QTY = required`, `LIFECYCLE_STATE = ARCHIVED`) добавлен пересчёт и запись производных:

```js
v12ApplyComputedToRow(row);
const computedCtx = ctx || { positionWrites: [] };
v12PushComputedWrites(computedCtx, pos.row, row);
if (!ctx) {
  batchWrite(v12GetSheetByKey("POSITION_STATE"), computedCtx.positionWrites);
}
```
→ `PRODUCTION_STATE` становится `RECEIVED`; при пакетном применении записи копятся в `ctx` и сбрасываются в конце `v12DrainPendingEdits`.

### `v12ReturnFromArchive`
Симметрично — после снятия «передано» (`RECEIVED_BY_PRODUCTION = false`, `LIFECYCLE_STATE = ACTIVE`) строка пересчитывается и производные пишутся сразу (`batchWrite`).

---

## 3. Тест

В `_local_tests/v12_dashboard_test.js` добавлен раздел **I** (реальная передача, RBAC в тесте замокан на ADMIN):
- **I1** до передачи `productionState = READY_FOR_HANDOFF`, **I2** «Собрано» = 0;
- вызов `v12MarkReceivedByProduction("BOM3:E1", PICKING, false)`;
- **I3** статус `handoff`; **I4** `POSITION_STATE.PRODUCTION_STATE = RECEIVED`; **I5** Dashboard «Собрано» = 1; **I6** статус начинается с «100%».

Все проходят. Регрессия `v12_delivery_test.js` (передача там замокана) — зелёная.

---

## 4. Резюме

Передача производству (и возврат из архива) теперь **пересчитывают производное состояние** `POSITION_STATE`. Dashboard, ОТБОРКА, Сводка и СНАБЖЕНИЕ обновляются согласованно; симптом «все позиции остаются как изначально попавшие» устранён.

*Реализация фикса. Диагностика — `project_info__49.md`.*
