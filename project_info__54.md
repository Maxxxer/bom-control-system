# BOM CONTROL SYSTEM V12 — почему «Отметка получено» медленная и как ускорить в 10× и более

> Отчёт сохранён в `project_info__53.md`. Сфокусирован на задаче: **«очень медленно выполняется скрипт отметки получено, особенно на большом количестве позиций»**.

## Summary

- «Отметка получено» = передача позиции производству. Это **двухфазный конвейер** («V3 — модель Применить»):
  1. **Захват (onEdit, быстрый):** `v12OnEdit` → `v12CaptureCheckboxEdit` пишет НАМЕРЕНИЕ строкой в `PENDING_EDITS` (`v12EnqueuePendingRows`). Лока и пересчёта нет.
  2. **Применение (тяжёлое):** кнопка «ПРИМЕНИТЬ» → `v12ApplyChanges` → `v12DrainPendingEdits`. Здесь на КАЖДОЕ намерение вызывается `v12MarkReceivedByProduction`.
- Медленная фаза — **именно применение**. Даже с «пакетным» `ctx` каждая позиция делает ~15–25 дорогих RPC к SpreadsheetApp/Session/Utilities, плюс **полное чтение `MATERIAL_HISTORY` на каждую позицию** → квадратичная сложность.
- Ускорение ≥10× достигается почти без изменения бизнес-логики.

## Как реально выполняется «Отметка получено»

1. Пользователь ставит чекбоксы в ОТБОРКЕ (кол. `CHECKBOX`) / WORKING BOM → `v12OnEdit` (`v12_trigger.js`).
2. `v12CaptureCheckboxEdit` (`v12_queue.js`): проверка роли, нормализация значений, построение строк `PENDING_EDITS`. **На каждую строку — `generateEventId()` = `Utilities.getUuid()` (RPC!).**
3. `v12EnqueuePendingRows` — запись пачки одним `writeValues`.
4. **Применение:** `v12DrainPendingEdits` (`v12_queue.js`): лок → `readSheetValues(PENDING_EDITS)` → `v12ResolvePendingIntents` (last-wins) → индексы POSITION_STATE/MATERIAL_STATE → `ctx = { index, materialIndex, warehouseDelta, positionWrites }` → цикл по намерениям → `v12MarkReceivedByProduction(pid, source, true, ctx)`.
5. **`v12MarkReceivedByProduction`** (`v12_handoff.js`): поиск позиции → валидации → `generateEventId()` → `v12UpdatePosition` (RECEIVED_*) → `v12ArchivePosition` → `v12ApplyComputedToRow`/`v12PushComputedWrites` → `v12Audit`/`v12LogHistory`/`v12LogEvent`.
6. **`v12ArchivePosition`**: `v12GetPositionHistory(positionId)` (**полное чтение MATERIAL_HISTORY**), `appendRow(ARCHIVE)`, затем **ВТОРОЙ** `v12UpdatePosition({LIFECYCLE_STATE})`.

## Узкие места (по влиянию) — на каждую позицию

1. **`v12GetPositionHistory()` — полное чтение `MATERIAL_HISTORY` на КАЖДУЮ позицию (главный убийца).** `readSheetValues` = `getDataRange().getValues()` по всему листу + линейный поиск. Лист при этом ещё и дописывается в том же цикле. Сложность **O(N·M)**: на 500 позициях × 5000 строк истории — ~2.5 млн чтений + 500 полных `getDataRange`.
2. **Три `appendRow` на позицию** (`ARCHIVE`, `MATERIAL_HISTORY`, `EVENT_LOG`). `appendRow` внутри = `getLastRow()` + запись = 2+ RPC. Итого ~6–9 RPC/позиция только на логи; на 500 позициях ~3000–4000 вызовов.
3. **Повторные `getSheetByName` / `SpreadsheetApp.getActive()`** — `v12GetSheetByKey` каждый раз делает `getActive().getSheetByName(...)` (RPC). Кэша листов нет.
4. **`Session.getActiveUser()` несколько раз на позицию** — через `v12CurrentActor()`/`getCurrentUser()` в `v12Audit`, `v12LogHistory`, `v12LogEvent`, записи `RECEIVED_BY_PRODUCTION_USER`. Это 3–4 RPC/позиция + ещё в `v12GetCurrentUserRole()`.
5. **`generateEventId()` = `Utilities.getUuid()` 2+ раза на позицию** (`operationId`, `EVENT_ID`), плюс на каждую строку очереди при захвате.
6. **`v12UpdatePosition` вызывается ДВАЖДЫ на позицию мимо ctx** (+ вычисленные поля отдельным батчем) → 3 записи в POSITION_STATE вместо одной.
7. **Хорошая новость:** `acquireScriptLock()` внутри передачи **реентрантен** (в пакете почти бесплатен), а `v12Audit`/`logSystem` уже буферизованы (порог 40/50).

## Варианты ускорения (в 10× и более) — по приоритету

**A. Убрать полное чтение `MATERIAL_HISTORY` (×5–20).** `v12_handoff.js`. Прочитать лист ОДИН раз перед циклом слива → `Map<positionId, history[]>` в `ctx`; либо наполнять «Историю» из буфера текущей пачки; либо не читать лист вовсе (колонка «История» нигде не участвует в решениях). Сложность O(N·M) → O(M).

**B. Батчить все три лога ARCHIVE/MATERIAL_HISTORY/EVENT_LOG (×3–5).** `v12_handoff.js`, `v12_events.js`. Ввести буферы по образцу `AUDIT_LOG`/`SYSTEM_LOG` и сбрасывать одним `writeValues` на пачку: `3×N` `appendRow` → 3 вызова.

**C. Кэш листов и Spreadsheet (×1.3–2).** `v12_sheet_service.js` (`v12GetSheetByKey`), `sheet_service.js`. Кэшировать `getActive()` и map `имя → sheet` на время запуска.

**D. Кэш пользователя и роли (×1.2–1.5).** `utils.js` (`getCurrentUser`), `v12_queue.js` (`v12CurrentActor`), `v12_roles.js`. Убирает 4–6 RPC `Session`/позицию.

**E. Один UUID на пачку вместо UUID на строку (×1.2–1.5).** `operationId` генерировать один раз и переиспользовать в `v12Audit` (там параметр уже поддержан); `EVENT_ID`/`EDIT_ID` делать локально (`operationId + "-" + счётчик`).

**F. Слить записи POSITION_STATE, убрать дубль `v12UpdatePosition` (×1.3–1.7).** `v12_handoff.js`. Сырые поля передачи и `LIFECYCLE_STATE=ARCHIVED` класть в `ctx.positionWrites` вместо отдельных `batchWrite`.

**G. Блочная запись POSITION_STATE одной `setValues` (×2–5).** `sheet_service.js` (`batchWrite`). Текущий батч пишет по строкам (сотни `setValues`); ввести `batchWriteBlock`: один чтения-минимум и одна запись диапазона.

**H. Не читать очередь дважды (×1.1–1.3).** `v12_queue.js`: `v12HasPendingEdits()` + `readSheetValues` в сливе + `v12CountPendingEdits()` — переиспользовать одно чтение.

## Ожидаемый эффект

| Оптимизация | Убирает | Вклад |
|---|---|---|
| A (история) | 1 полное чтение листа | ×5–20 |
| B (батч логов) | ~6–9 RPC | ×3–5 |
| C (кэш листов) | ~5–10 RPC | ×1.3–2 |
| D (кэш user/role) | ~4–6 RPC | ×1.2–1.5 |
| E (UUID) | ~2+ RPC | ×1.2–1.5 |
| F/G (POSITION_STATE) | ~2–3 RPC | ×1.3–2 |
| H (двойное чтение) | 1 чтение | ×1.1–1.3 |

Комбинация **A + B + C + F/G** даёт устойчивое **≥10×** на пачках в сотни позиций. D и E снимают фоновые мелкие RPC.

**Нельзя сломать инварианты:** идемпотентность `v12MarkReceivedByProduction` (`received && receivedQty >= required` до записи), «передача только вверх», а также то, что ARCHIVE хранит историю позиции (порядок «читать историю → писать» сохраняется, но чтение становится однократным).

## Data Flow (с указанием файлов)

`v12OnEdit` → `v12CaptureCheckboxEdit` → `PENDING_EDITS` → **ПРИМЕНИТЬ** → `v12ApplyChanges`/`v12DrainPendingEdits` → `v12ApplyPendingIntent` → `v12MarkReceivedByProduction` → `v12UpdatePosition ×2` + `v12ArchivePosition`(**HOT**: `v12GetPositionHistory`, `appendRow`) → `v12Audit`/`v12LogHistory`/`v12LogEvent`(**HOT**) → `ctx.warehouseDelta` → `v12ApplyWarehouseDeltas` → один `batchWrite(POSITION_STATE)` + `v12RefreshProjections()` + `v12MarkPendingProcessed`.

## Module Reference

| Файл | Назначение |
|---|---|
| `v12_handoff.js` | `v12MarkReceivedByProduction`, `v12ArchivePosition`, `v12GetPositionHistory` (**HOT**) |
| `v12_queue.js` | Захват намерений, `v12DrainPendingEdits`, `ctx`-пакет |
| `v12_operations.js` | Операции снабжения, `v12PushComputedWrites`, `v12CommitSingleOperation` |
| `v12_events.js` | `v12LogHistory`, `v12LogEvent` (**HOT**: `appendRow`) |
| `v12_audit.js` / `logger.js` | Буферизованные логи — образец для батчинга |
| `v12_sheet_service.js` | `v12GetSheetByKey` (**HOT**), индексы, `v12UpdatePosition` |
| `sheet_service.js` | `readSheetValues`, `writeValues`, `appendRow` (**HOT**), `batchWrite` |
| `utils.js` | `generateEventId` (**HOT**), `getCurrentUser` (**HOT**) |
| `v12_roles.js` | RBAC (статично, кэшируемо) |
| `v12_trigger.js` | `v12OnEdit` |
| `v12_controller.js` | Меню, `v12ApplyChangesUI` |
| `v12_projections.js` | Пересборка 5 проекций (1 раз на пачку) |

## Suggested Reading Order

1. `v12_handoff.js` — сама передача и её «горячие» места.
2. `v12_queue.js` — пакетный слив и почему он не покрывает логи/сырые записи.
3. `v12_events.js` + `v12_audit.js` + `logger.js` — образец буферизации.
4. `v12_sheet_service.js` + `sheet_service.js` — точки кэша и блочной записи.
5. `utils.js` + `v12_roles.js` — кэш пользователя/роли, замена UUID-RPC.

---

⚙️ Я в **Explore Mode** — только анализ и документация, правки не вношу. Чтобы реализовать оптимизации A–H, переключитесь в **Act Mode** (переключатель внизу чата) — находки сохранятся как контекст.