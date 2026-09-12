# BOM CONTROL SYSTEM V12 — БАГ: Dashboard не обновляется после передачи производству

> ⚠️ **Я в Explore Mode** — режим исследования, изменения НЕ вносятся. Ниже — точная причина дефекта и карта правок для **Act Mode**. Все находки перенесутся туда как контекст.
> **Связано:** редизайн дашборда — `project_info__46.md`/`__47.md`/`__48.md`.

---

## 0. Симптом (дословно)

> «После отметки в отборке о получении материала и применении изменений **не обновляется дашборд, все позиции остаются как изначально попавшие**.»

То есть: чекбокс «Отметка получено» в ОТБОРКЕ → «ПРИМЕНИТЬ» → позиция уходит из ОТБОРКИ, но в Dashboard «Собрано» не растёт, процент не меняется, а позиция **остаётся в «Недостающие материалы»**.

---

## 1. Причина (одна строка)

**Передача производству (`v12MarkReceivedByProduction`) НЕ пересчитывает производные столбцы POSITION_STATE** — `productionState`, `deficitQty` и т.д. остаются старыми. А Dashboard — **единственная проекция, которая агрегирует по производным столбцам** (`PRODUCTION_STATE`, `DEFICIT_QTY`). Поэтому он и «застывает».

---

## 2. Сквозной разбор

### 2.1. Как применяется передача (V3)

```
ОТБОРКА, чекбокс «Отметка получено»
  └─ v12CaptureCheckboxEdit → PENDING_EDITS (SOURCE=PICKING, FIELD=HANDOFF)
  └─ кнопка «ПРИМЕНИТЬ» → v12ApplyChanges → v12DrainPendingEdits
        └─ v12ApplyPendingIntent(field=HANDOFF)
             └─ v12MarkReceivedByProduction(pid, source, skipRefresh=true, ctx)   [v12_handoff.js]
```

### 2.2. Что делает `v12MarkReceivedByProduction`

```js
v12UpdatePosition(positionId, {
  RECEIVED_BY_PRODUCTION: true,
  RECEIVED_BY_PRODUCTION_QTY: required,
  RECEIVED_BY_PRODUCTION_AT: new Date(),
  RECEIVED_BY_PRODUCTION_USER: v12CurrentActor()
}, index);
v12ArchivePosition(positionId, sourceUI, index);   // v12UpdatePosition(... LIFECYCLE_STATE: ARCHIVED)
...
row[P.RECEIVED_BY_PRODUCTION - 1] = true;
row[P.RECEIVED_BY_PRODUCTION_QTY - 1] = required;
row[P.LIFECYCLE_STATE - 1] = V12_CONFIG.LIFECYCLE_STATE.ARCHIVED;
```

**Ключевое:** `v12UpdatePosition` (`v12_sheet_service.js`) пишет **только переданные столбцы** + `UPDATED_AT`:

```js
function v12UpdatePosition(positionId, changes, index) {
  ...
  Object.keys(changes || {}).forEach((key) => {
    const col = P[key];
    if (col) { writes.push({ row: pos.row, col: col, value: changes[key] }); }
  });
  if (P.UPDATED_AT) { writes.push({ row: pos.row, col: P.UPDATED_AT, value: new Date() }); }
  if (writes.length) { batchWrite(sheet, writes); }
}
```

**Никакого `v12ApplyComputedToRow` здесь нет.** Значит `PRODUCTION_STATE` (кол. 23) и `DEFICIT_QTY` (кол. 24) в листе **остаются прежними** (`NOT_AVAILABLE`, дефицит > 0).

### 2.3. Почему «застывает» именно Dashboard

Проекции фильтруют строки по **сырым** колонкам, а Dashboard агрегирует по **производным**:

| Проекция | Фильтр строк | Итог после передачи |
|---|---|---|
| ОТБОРКА (`v12RefreshPicking`) | `v12IsChecked(RECEIVED_BY_PRODUCTION)` — **сырой** флаг (записан) | позиция уходит ✔ |
| Сводка дефицитов (`v12IsDeficitRowActive`) | `v12IsChecked(RECEIVED_BY_PRODUCTION)` — **сырой** | позиция уходит ✔ |
| СНАБЖЕНИЕ (`v12IsSupplyRowActive`) | `LIFECYCLE_STATE = ARCHIVED` — **сырое** (записано) | позиция уходит ✔ |
| **Dashboard (`v12AggregateBomStates`)** | — | см. ниже ✘ |

`v12AggregateBomStates`:

```js
if (production === V12_CONFIG.PRODUCTION_STATE.RECEIVED) { b.collected++; continue; }
...
if (toNumber(r[P.DEFICIT_QTY - 1]) > 0) { b.missing.push(...); }
```

`production` берётся из **производного** столбца `PRODUCTION_STATE` (кол. 23), а `deficit` — из `DEFICIT_QTY` (кол. 24). Оба **не обновлены** передачей →
- `collected` не растёт → процент сборки не меняется;
- `production !== RECEIVED` → строка идёт дальше по `switch`, и `deficit > 0` → **позиция остаётся в «Недостающие материалы»**.

**Вывод:** Dashboard — «зеркало» производного состояния; раз производное состояние после передачи не пересчитано, дашборд не двигается.

---

## 3. Важно: это не регрессия от редизайна

Логика `v12AggregateBomStates` (`production === RECEIVED → collected++`) и раньше читала `PRODUCTION_STATE` так же. Дефект **был и до редизайна**, но стал заметен, потому что новый Dashboard явно показывает процент и список недостач. Симптома два у одного корня:

- **передача** (`v12MarkReceivedByProduction`) — не пересчитывает производные;
- **возврат из архива** (`v12ReturnFromArchive`) — тоже (`v12UpdatePosition({RECEIVED_BY_PRODUCTION:false, LIFECYCLE_STATE:ACTIVE, ...})` без пересчёта).

Для симметрии сравните: операции снабжения (`v12SetOrderedQty`, `v12SetExpectedDate`, `v12SetRealDeliveryQty` в `v12_operations.js`) **пересчитывают** — вызывают `v12ApplyComputedToRow` и пишут производные через `v12PushComputedWrites(ctx, ...)`. У передачи этого шага нет.

---

## 4. Карта правок (для Act Mode)

### 4.1. Основной фикс — `v12_handoff.js`

**`v12MarkReceivedByProduction`:** сразу после блока, где in-memory строка помечается `RECEIVED_BY_PRODUCTION = true`, `RECEIVED_BY_PRODUCTION_QTY = required`, `LIFECYCLE_STATE = ARCHIVED`, добавить пересчёт производных и их запись:

```js
// Пересчитать производные столбцы (productionState/deficit/…) — без этого
// проекции, читающие производное состояние (Dashboard «Собрано»/«Недостающие»),
// не увидят передачу.
v12ApplyComputedToRow(row);
const computedCtx = ctx || { positionWrites: [] };
v12PushComputedWrites(computedCtx, pos.row, row);
if (!ctx) {
  batchWrite(v12GetSheetByKey("POSITION_STATE"), computedCtx.positionWrites);
}
```

`v12ApplyComputedToRow` выставит `PRODUCTION_STATE = RECEIVED` (в `v12_calculate.js`: `if (received) productionState = PS.RECEIVED`), `SUPPLY_STATE`, `DEFICIT_QTY`, `AVAILABLE_FOR_PRODUCTION`, `FLAGS`, `UPDATED_AT`. `v12PushComputedWrites` (из `v12_operations.js`) пишет ровно эти столбцы.

**`v12ReturnFromArchive`:** аналогично после `v12UpdatePosition({RECEIVED_BY_PRODUCTION:false, ..., LIFECYCLE_STATE:ACTIVE})` — пересчитать `row` и записать производные (тут ctx нет, писать сразу через `batchWrite`).

> **Тонкость с ctx.** `v12UpdatePosition` внутри передачи пишет сырые столбцы **немедленно**, а производные при `ctx` копятся в `ctx.positionWrites` и сбрасываются в конце `v12DrainPendingEdits` (`batchWrite`). Это безопасно, но обратите внимание: если кто-то будет отлаживать — сырые и производные столбцы пишутся разными батчами.

> **Почему `deficit` не мешает.** После передачи `DEFICIT_QTY` останется > 0 (передача не меняет `reserved`), но агрегатор проверяет `production === RECEIVED` **раньше** пуша в `missing` — поэтому позиция уйдёт из «Недостающие материалы» и попадёт в `collected`. Пересчёта `productionState` достаточно.

### 4.2. Альтернатива (если не трогать handoff) — `v12_projections.js`

Сделать Dashboard независимым от производного столбца: в `v12AggregateBomStates` считать «собрано» по **сырому** флагу `v12IsChecked(r[P.RECEIVED_BY_PRODUCTION - 1])`, а `missing` строить только для **не** переданных. Плюс: дашборд устойчив к отставшему производному состоянию. Минус: POSITION_STATE останется **внутренне противоречивой** (`productionState` ≠ `received`), а это может всплыть в других местах (например, `v12ProductionStatusDisplay`/`v12PickingRowColor`). **Рекомендуется основной фикс (§4.1)** — он устраняет первопричину, а не симптом.

### 4.3. Тест

Добавить проверку в `_local_tests/v12_dashboard_test.js` или новый кейс: позиция с `required=10, reserved=0`, дефицит → попадает в `missing`; после имитации передачи (`RECEIVED_BY_PRODUCTION=true` + пересчёт) — Dashboard: `collected=1`, процент 100%, `missing` пуст. Образец сквозного теста передачи — `_local_tests/v12_delivery_test.js` (S1/S9).

---

## 5. Где смотреть в коде

| Файл | Что важно |
|---|---|
| `v12_handoff.js` | `v12MarkReceivedByProduction`, `v12ReturnFromArchive` — **добавить пересчёт производных** |
| `v12_operations.js` | `v12PushComputedWrites`, `v12ApplyComputedToRow` — образец «правильной» записи производных |
| `v12_position_state.js` | `v12ApplyComputedToRow` — что именно пересчитывается |
| `v12_calculate.js` | `received → productionState = RECEIVED` |
| `v12_sheet_service.js` | `v12UpdatePosition` — пишет только переданные столбцы (корень) |
| `v12_projections.js` | `v12AggregateBomStates` — читает `PRODUCTION_STATE`/`DEFICIT_QTY` |
| `v12_queue.js` | `v12ApplyPendingIntent` (HANDOFF → handoff), сброс `ctx.positionWrites` |

---

## 6. Резюме

Передача производству пишет **сырые** поля (`RECEIVED_BY_PRODUCTION`, `LIFECYCLE_STATE`), но **не пересчитывает производные** (`PRODUCTION_STATE`, `DEFICIT_QTY`). ОТБОРКА/Сводка/СНАБЖЕНИЕ фильтруют по сырым полям — поэтому «сходят с листов» корректно; **Dashboard считает по производным** — поэтому не обновляется. Фикс: в `v12MarkReceivedByProduction` (и симметрично в `v12ReturnFromArchive`) вызвать `v12ApplyComputedToRow(row)` и записать производные столбцы (`v12PushComputedWrites` при `ctx`, иначе `batchWrite`).

> **Это правка кода — выполняется в Act Mode.** Переключите режим (селектор внизу чата); находки уже в контексте.

*Диагностика дефекта «Dashboard не обновляется после передачи». Редизайн дашборда — `project_info__48.md`.*
