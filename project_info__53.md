# BOM CONTROL SYSTEM V12 — Анализ: почему «Отметка получено» медленная и как ускорить в 10× и более

> Отчёт сфокусирован на задаче: **«очень медленно выполняется скрипт отметки получено, особенно на большом количестве позиций»**. Ниже — как именно работает передача производству, где именно теряется время (по RPC-вызовам к Google Apps Script), и конкретные изменения, дающие ускорение ~10× и больше.

## Summary

- «Отметка получено» = передача позиции производству. Это **двухфазный конвейер** «V3 — модель Применить»:
  1. **Захват (onEdit, быстрый):** `v12OnEdit` → `v12CaptureCheckboxEdit` пишет НАМЕРЕНИЕ строкой в лист `PENDING_EDITS` через `v12EnqueuePendingRows`. Лока и пересчёта нет.
  2. **Применение (тяжёлое):** пользователь жмёт кнопку «ПРИМЕНИТЬ» → `v12ApplyChanges` → `v12DrainPendingEdits`. Здесь на КАЖДОЕ намерение вызывается `v12MarkReceivedByProduction` (пакетно, с общим `ctx`).
- Медленная фаза — **именно применение**. Даже при «пакетном» ctx каждая позиция делает ~15–25 дорогих RPC-вызовов к SpreadsheetApp/Session/Utilities, а также **полное чтение листа `MATERIAL_HISTORY`** на каждую позицию. Итог — квадратичная сложность и сотни медленных вызовов на 100+ позиций.
- Ускорение 10× достигается **почти без изменения бизнес-логики**: убрать `O(N·M)`-чтение истории, заменить `appendRow ×3` на один батч, закэшировать `SpreadsheetApp.getActive()`/sheet-объекты/пользователя/роль, снять лишние `Utilities.getUuid()` и продублированные записи POSITION_STATE.

## Как реально выполняется «Отметка получено» (точный путь)

1. **Захват.** Пользователь ставит чекбоксы в ОТБОРКЕ (кол. `CHECKBOX`) или WORKING BOM (кол. `CHECKBOX`). Срабатывает `v12OnEdit` (`v12_trigger.js`). Для диапазона (протяжка/вставка) значения и Position ID читаются ОДНОЙ выборкой (`range.getValues()` / `e.values` + `sheet.getRange(...).getValues()`).
2. `v12CaptureCheckboxEdit` (`v12_queue.js`) проверяет роль (`v12GetCurrentUserRole`), нормализует значения (`v12NormalizePendingValue` → `v12IsChecked` для HANDOFF) и строит строки `PENDING_EDITS` функцией `v12BuildPendingRow`. **На каждую строку вызывается `generateEventId()` = `Utilities.getUuid()`** (RPC!).
3. `v12EnqueuePendingRows` пишет пачку одним `writeValues` и обновляет индикатор (`v12UpdatePendingIndicator`).
4. **Применение.** Кнопка/меню → `v12ApplyChangesUI` → `v12ApplyChanges` → `v12DrainPendingEdits` (`v12_queue.js`):
   - `v12HasPendingEdits()` — читает колонку статусов очереди;
   - `acquireScriptLock({tryOnly,timeoutMs:5000})` — общий лок на весь слив;
   - `readSheetValues(PENDING_EDITS)` — **полное чтение очереди**;
   - `v12CollectPendingRowNumbers` + `v12ResolvePendingIntents` — last-wins по `(SOURCE|POSITION_ID|FIELD)`;
   - `v12BuildPositionIndex()` и `v12BuildMaterialIndex()` — по одному чтению POSITION_STATE и MATERIAL_STATE;
   - создаётся `ctx = { index, materialIndex, warehouseDelta:{}, positionWrites:[] }`;
   - **по каждому намерению** `v12ApplyPendingIntent` → для HANDOFF вызывается `v12MarkReceivedByProduction(intent.pid, intent.source, true, ctx)`;
   - в конце: `v12ApplyWarehouseDeltas`, один `batchWrite(POSITION_STATE)`, `SpreadsheetApp.flush()`, `v12RefreshProjections()` (пересборка 5 проекций), `v12MarkPendingProcessed`, `v12PurgeDonePendingEdits`, `v12UpdatePendingIndicator(0)`.
5. **`v12MarkReceivedByProduction` на одну позицию** (`v12_handoff.js`): лок → роль → поиск позиции в индексе → валидации → `generateEventId()` → `v12UpdatePosition(...)` (запись RECEIVED_*) → `v12ArchivePosition(...)` → `v12ApplyComputedToRow` + `v12PushComputedWrites` → накопление складской дельты → `v12Audit` + `v12LogHistory` + `v12LogEvent`.
6. **`v12ArchivePosition`** (внутри `v12_handoff.js`): `v12GetPositionHistory(positionId)` (**полное чтение MATERIAL_HISTORY**), `appendRow(ARCHIVE, ...)`, затем **ВТОРОЙ** `v12UpdatePosition({LIFECYCLE_STATE})`.

## Узкие места (ранжировано по влиянию)

Ниже — то, что происходит **на каждую позицию** при применении. Именно это делает скрипт медленным «на большом количестве позиций».

### 1. `v12GetPositionHistory()` — полное чтение `MATERIAL_HISTORY` на КАЖДУЮ позицию (главный убийца)

`v12_handoff.js` → `v12ArchivePosition()` → `v12GetPositionHistory()` делает `readSheetValues(sheet)` = `getDataRange().getValues()` по **всему** листу `MATERIAL_HISTORY`, а затем линейно ищет строки нужного positionId. Хуже того, этот же лист **тут же дописывается** (`v12LogHistory` → `appendRow`), т.е. размер листа растёт по ходу слива.

Сложность = **O(N × M)**, где N — число позиций в пачке, M — число строк истории. На 500 позициях и 5000 строк истории — это ~2.5 млн чтения ячеек + 500 полных `getDataRange`. Это **самая дорогая операция**.

### 2. Три `appendRow` на позицию (`appendRow` в Apps Script очень дорогой)

На каждую позицию:
- `appendRow(ARCHIVE, ...)` (`v12ArchivePosition`);
- `appendRow(MATERIAL_HISTORY, ...)` (`v12LogHistory`);
- `appendRow(EVENT_LOG, ...)` (`v12LogEvent`).

`sheet.appendRow()` внутри делает `getLastRow()` + запись диапазона — это 2+ RPC на вызов. Итого **~6–9 RPC на позицию только на логи**. При 500 позициях — ~3000–4000 медленных вызовов.

### 3. Повторные `getSheetByName` / `SpreadsheetApp.getActive()`

`v12GetSheetByKey` (`v12_sheet_service.js`) на каждый вызов делает `getSheetByName(name)` → `SpreadsheetApp.getActive().getSheetByName(...)`. `SpreadsheetApp.getActive()` — RPC. За одну позицию листы запрашиваются многократно: POSITION_STATE (в `v12UpdatePosition`, ×2), ARCHIVE, MATERIAL_HISTORY, EVENT_LOG, SYSTEM_LOG, AUDIT_LOG. Кэша листов нет.

### 4. `Session.getActiveUser()` на каждую позицию (несколько раз)

`v12CurrentActor()` (`v12_queue.js`) → `getCurrentUser()` (`utils.js`) → `Session.getActiveUser().getEmail()` — RPC. Вызывается внутри `v12Audit` (actor), `v12LogHistory` (user), `v12LogEvent` (user) и при записи `RECEIVED_BY_PRODUCTION_USER`. Это **3–4 RPC Session на позицию**. Плюс `v12GetCurrentUserRole()` в `v12MarkReceivedByProduction` — ещё раз.

### 5. `generateEventId()` = `Utilities.getUuid()` несколько раз на позицию

`generateEventId()` (`utils.js`) — это RPC `Utilities.getUuid()`. На позицию MIN 2 вызова: `operationId` в `v12MarkReceivedByProduction` и `EVENT_ID` в `v12LogEvent`. Плюс по одному на каждую строку очереди при захвате. На пачке 500 — минимум 1000+ UUID-RPC.

### 6. Дублирование записи POSITION_STATE (`v12UpdatePosition` вызывается ДВАЖДЫ на позицию, мимо ctx)

`v12MarkReceivedByProduction` пишет сырые поля через `v12UpdatePosition(...)` → собственный `batchWrite` (RPC). Затем `v12ArchivePosition` вызывает `v12UpdatePosition({LIFECYCLE_STATE})` — **ещё один** `batchWrite`. При этом «вычисленные» поля копятся в `ctx.positionWrites` и пишутся отдельным батчем. Итог — **3 записи в POSITION_STATE на позицию** вместо одной.

### 7. Прочее

- `v12Audit` и `logSystem` буферизованы (порог 40 и 50) — это уже хорошо; батчи сбрасываются, но всё равно каждая позиция кладёт строки в буферы, что в сумме даёт полные проходы.
- `acquireScriptLock()` внутри `v12MarkReceivedByProduction` в пакетном режиме **реентрантен** (`_lockDepth>0`) — почти бесплатен, здесь оптимизировать нечего (хорошая новость).
- `v12PurgeDonePendingEdits` и `v12RefreshProjections` — одноразовые на пачку, но `v12RefreshProjections` пересобирает 5 листов (дорого); она нужна 1 раз, это корректно.

## Варианты ускорения (в 10× и более) — по приоритету

> Все изменения — в существующих файлах, без изменения схем листов и бизнес-правил. Оценка ускорения — суммарная.

### Оптимизация A. Убрать полное чтение `MATERIAL_HISTORY` (×5–20 на больших пачках)
**Файл:** `v12_handoff.js` (`v12GetPositionHistory` / `v12ArchivePosition`).

- Вариант A1 (минимальный риск): **прочитать `MATERIAL_HISTORY` ОДИН раз** перед циклом слива и построить `Map<positionId, history[]>`; передавать её в `v12ArchivePosition` через `ctx`. Слив в памяти вместо N полных чтений. Сложность падает с O(N·M) до O(M).
- Вариант A2: заполнять архивную колонку «История» **накопительно** из уже известных событий текущей пачки (мы и так пишем в `MATERIAL_HISTORY`), а историческое прошлое читать один раз.
- Вариант A3 (агрессивный): колонка «История» в ARCHIVE не является обязательной для логики передачи (нигде не читается обратно для решений) — можно писать туда только события из `ctx`-буфера, не читая лист вообще.

### Оптимизация B. Батчить все три лога (`ARCHIVE`, `MATERIAL_HISTORY`, `EVENT_LOG`) (×3–5)
**Файлы:** `v12_handoff.js`, `v12_events.js`.

- Ввести буферы (как уже сделано для `AUDIT_LOG` в `v12_audit.js` и `SYSTEM_LOG` в `logger.js`): `_v12ArchiveBuffer`, `_v12HistoryBuffer`, `_v12EventBuffer`.
- Накапливать строки на каждую позицию и **сбрасывать одним `writeValues`/`batchWrite`** на всю пачку (в конце `v12DrainPendingEdits` или в `v12ApplyChanges`).
- Это заменит `3×N` вызовов `appendRow` (каждый ~2 RPC) на **3 вызова** всего. Типовой выигрыш на 500 позициях — с ~3000 вызовов до 3.

### Оптимизация C. Кэш листов и Spreadsheet (×1.3–2)
**Файл:** `v12_sheet_service.js` (`v12GetSheetByKey`), `sheet_service.js` (`getSheetByName`).

- Кэшировать `SpreadsheetApp.getActive()` в переменную модуля.
- Кэшировать map `имя → sheet` на время выполнения (`v12GetSheetByKey` возвращает из кэша).
- Сбросить кэш в начале/конце крупных операций (или жить с кэшем весь запуск — листы за один запуск не пересоздаются).
- Убирает десятки `getActive().getSheetByName()` RPC на позицию.

### Оптимизация D. Кэш текущего пользователя и роли (×1.2–1.5)
**Файлы:** `utils.js` (`getCurrentUser`), `v12_queue.js` (`v12CurrentActor`), `v12_roles.js`.

- `getCurrentUser()` за один запуск возвращает одно и то же — кэшировать результат в модуле.
- `v12GetCurrentUserRole()` кэшировать (тем более что внутри `v12CanEditField` таблица прав статична).
- Убирает 4–6 RPC `Session.getActiveUser()`/вычислений на позицию.

### Оптимизация E. Один UUID на операцию/пачку вместо UUID на строку (×1.2–1.5)
**Файлы:** `utils.js` (`generateEventId`), `v12_handoff.js`, `v12_events.js`, `v12_queue.js`.

- `Utilities.getUuid()` — RPC. Вызывать **один раз на пачку** для `operationId` и переиспользовать его в `v12Audit` (там `operationId` уже поддерживается как параметр).
- Для `EVENT_ID` можно генерировать локально (например, `operationId + "-" + счётчик`) — уникальности `EVENT_LOG` это не нарушит (строка не используется как ключ).
- Для `EDIT_ID`/`EVENT_ID` в очереди — аналогично.
- Это убирает 2+N RPC на пачку.

### Оптимизация F. Слить записи POSITION_STATE и убрать дубль `v12UpdatePosition` (×1.3–1.7)
**Файлы:** `v12_handoff.js`.

- Сырые поля передачи (`RECEIVED_BY_PRODUCTION`, `RECEIVED_BY_PRODUCTION_QTY`, `RECEIVED_BY_PRODUCTION_AT`, `RECEIVED_BY_PRODUCTION_USER`) **добавлять в `ctx.positionWrites`**, а не писать отдельным `batchWrite` через `v12UpdatePosition`.
- `LIFECYCLE_STATE = ARCHIVED` писать туда же (сейчас это отдельный `batchWrite` из `v12ArchivePosition`).
- Итог: вместо 3 записей POSITION_STATE на позицию — один объединённый батч на всю пачку (он уже есть в конце `v12DrainPendingEdits`).
- Дополнительно в `batchWrite` (`sheet_service.js`) соседние колонки уже сливаются в «раны» (runs) — это хорошо; но запись идёт **по строкам по одной**. Для больших пачек можно собирать изменения **в блочную матрицу** и писать диапазон строк одним `setValues` (см. Оптимизацию G).

### Оптимизация G. Блочная запись POSITION_STATE (одна `setValues` на много строк) (×2–5)
**Файл:** `sheet_service.js` (`batchWrite`), `v12_position_state.js`/`v12_operations.js`.

- Текущий `batchWrite` группирует по строке и для каждой строки пишет непрерывные «раны» колонок. При пачке из сотен строк это сотни `setValues`.
- Ввести `batchWriteBlock(sheet, changes)`: собрать затронутые строки, вычислить непрерывный диапазон `[minRow..maxRow]`, прочитать его ОДИН раз, наложить изменения в матрицу в памяти и записать ОДИН раз `setValues`. Для «плотных» пачек (передача диапазоном) это сокращает записи POSITION_STATE до единиц.

### Оптимизация H. Не читать очередь/индексы дважды (×1.1–1.3)
**Файл:** `v12_queue.js`.

- `v12HasPendingEdits()` читает колонку статусов, затем `v12DrainPendingEdits` читает очередь целиком `readSheetValues` — два чтения одного листа. Достаточно читать один раз и решать по данным.
- `v12CountPendingEdits()`/`v12UpdatePendingIndicator()` — вызываются ещё раз в конце; читают лист. Можно переиспользовать уже прочитанные данные.

## Ожидаемый суммарный эффект

| Оптимизация | Что убирает на позицию | Вклад |
|---|---|---|
| A (история) | 1 полное чтение листа | ×5–20 на больших пачках |
| B (батч логов) | ~6–9 RPC | ×3–5 |
| C (кэш листов) | ~5–10 RPC | ×1.3–2 |
| D (кэш user/role) | ~4–6 RPC | ×1.2–1.5 |
| E (UUID) | ~2+ RPC | ×1.2–1.5 |
| F/G (записи POSITION_STATE) | ~2–3 RPC | ×1.3–2 |
| H (двойное чтение) | 1 чтение | ×1.1–1.3 |

Комбинация **A + B + C + F/G** даёт устойчивое **ускорение ≥ 10×** на пачках в сотни позиций (основной выигрыш — устранение O(N·M)-чтения истории и замена тысяч `appendRow` на единичные `writeValues`). Дополнительно D и E снимают «постоянный фон» мелких RPC.

**Ключевой инвариант, который нельзя сломать:** порядок «сначала прочитать историю, потом писать» (`ARCHIVE` хранит историю позиции) сохраняется, только чтение становится однократным/индексным. Также нельзя терять идемпотентность `v12MarkReceivedByProduction` (проверка `received && receivedQty >= required` до записи) и «передача только вверх».

## Data Flow (кратко, с указанием файлов)

1. Пользователь ставит чекбокс(ы) → `v12OnEdit` (`v12_trigger.js`).
2. `v12CaptureCheckboxEdit` (`v12_queue.js`) → `v12BuildPendingRow` (`generateEventId`) → `v12EnqueuePendingRows` → `writeValues(PENDING_EDITS)`.
3. Пользователь жмёт «ПРИМЕНИТЬ» → `v12ApplyChangesUI`/`v12ApplyChanges` (`v12_controller.js`/`v12_queue.js`).
4. `v12DrainPendingEdits`: чтение очереди → резолв last-wins → индексы POSITION_STATE/MATERIAL_STATE.
5. По намерению: `v12ApplyPendingIntent` → `v12MarkReceivedByProduction` (`v12_handoff.js`).
6. `v12MarkReceivedByProduction` → `v12UpdatePosition` ×2 → `v12ArchivePosition` → `v12GetPositionHistory` (**HOT**) → `appendRow(ARCHIVE)` (**HOT**) → `v12ApplyComputedToRow`/`v12PushComputedWrites` → `v12Audit` → `v12LogHistory`/`v12LogEvent` (**HOT**: `appendRow` + UUID + Session).
7. Накопление `ctx.warehouseDelta` → `v12ApplyWarehouseDeltas` → `v12AdjustWarehouseQty` (по materialKey).
8. Один `batchWrite(POSITION_STATE)` + `SpreadsheetApp.flush()` + `v12RefreshProjections()` (`v12_projections.js`, 5 проекций) + `v12MarkPendingProcessed` + `v12PurgeDonePendingEdits`.

## Module Reference (релевантное задаче)

| Файл | Назначение |
|---|---|
| `v12_handoff.js` | `v12MarkReceivedByProduction` (передача), `v12ArchivePosition`, `v12GetPositionHistory` (**HOT**), `v12AdjustWarehouseQty` |
| `v12_queue.js` | Захват намерений (`v12CaptureCheckboxEdit`), слив (`v12DrainPendingEdits`), `ctx`-пакет, актор-контекст |
| `v12_operations.js` | Операции снабжения; `v12PushComputedWrites`, `v12CommitSingleOperation` (одиночный режим) |
| `v12_events.js` | `v12LogHistory`, `v12LogEvent` (**HOT**: `appendRow` на позицию) |
| `v12_audit.js` | Буферизованный `AUDIT_LOG` (порог 40) — образец для батчинга логов |
| `logger.js` | Буферизованный `SYSTEM_LOG` (порог 50) — образец для батчинга |
| `v12_sheet_service.js` | `v12GetSheetByKey` (**HOT**: `getActive().getSheetByName`), построение индексов, `v12UpdatePosition` |
| `sheet_service.js` | `readSheetValues`, `writeValues`, `appendRow` (**HOT**), `batchWrite` |
| `utils.js` | `generateEventId` (**HOT**: UUID-RPC), `getCurrentUser` (**HOT**: Session-RPC), `toNumber` |
| `v12_roles.js` | RBAC (статичная таблица прав) — кэшируемо |
| `v12_trigger.js` | `v12OnEdit`, немедленные пути (медленный путь — только MATERIAL_STATE/Dashboard/фильтр B1) |
| `v12_controller.js` | Меню, `v12ApplyChangesUI`, полная синхронизация |
| `v12_projections.js` | Пересборка 5 проекций (`v12RefreshProjections`, `v12Refresh*`) — один раз на пачку |

## Suggested Reading Order

1. `v12_handoff.js` — понять саму операцию передачи и её «горячие» места (`v12GetPositionHistory`, двойной `v12UpdatePosition`, `appendRow`).
2. `v12_queue.js` — понять пакетный слив (`ctx`) и почему он не покрывает логи/сырые записи.
3. `v12_events.js` + `v12_audit.js` + `logger.js` — увидеть образец буферизации, по которому надо переделать ARCHIVE/MATERIAL_HISTORY/EVENT_LOG.
4. `v12_sheet_service.js` + `sheet_service.js` — точки кэширования листов и блочной записи (`batchWrite`).
5. `utils.js` + `v12_roles.js` — кэш пользователя/роли и замена `Utilities.getUuid()`.
---

# РЕАЛИЗОВАНО (оптимизация применена и проверена)

> Ниже — что фактически изменено в коде для ускорения «Отметки получено». Все правки — в существующих файлах, без изменения схем листов, публичных сигнатур и бизнес-правил.

## Внесённые изменения

### 1. Устранено O(N·M)-чтение `MATERIAL_HISTORY` (главный выигрыш)
- **`v12_handoff.js`**: добавлена `v12BuildPositionHistoryIndex()` — ОДНО чтение `MATERIAL_HISTORY` → `Map<positionId, history[]>`.
- `v12ArchivePosition(positionId, sourceUI, index, ctx)` берёт историю из `ctx.historyIndex` (пакет) либо читает лист (одиночный режим — как раньше).
- **`v12_queue.js`**: индекс строится ОДИН раз в `v12DrainPendingEdits` и кладётся в `ctx.historyIndex`.

### 2. Батч логов `ARCHIVE` / `MATERIAL_HISTORY` / `EVENT_LOG`
- **`v12_events.js`**: `v12LogHistory(..., ctx)` и `v12LogEvent(..., ctx)` при наличии `ctx` не пишут `appendRow`, а копят строки в `ctx.historyRows` / `ctx.eventRows`. Добавлены билдеры `v12BuildHistoryRow` / `v12BuildEventRow`.
- **`v12_handoff.js`**: `v12ArchivePosition` при `ctx` кладёт строку в `ctx.archiveRows`.
- **`v12_queue.js`**: после цикла — три `v12FlushRowBuffer("ARCHIVE"/"MATERIAL_HISTORY"/"EVENT_LOG", …)` (по одному `writeValues` на лист).
- **`v12_sheet_service.js`**: добавлен `v12FlushRowBuffer(key, rows)`.

### 3. Кэш активной таблицы и листов
- **`sheet_service.js`**: `v12ActiveSpreadsheet()` кэширует `SpreadsheetApp.getActive()`; `getSheetByName` берёт таблицу из кэша (сами листы НЕ кэшируются — чтобы миграция схемы, пересоздающая лист под тем же именем, не читала устаревший объект).

### 4. Один `operationId` на пачку (вместо UUID на позицию)
- **`v12_handoff.js`**: `operationId = (ctx && ctx.operationId) || generateEventId()`.
- **`v12_events.js`**: `EVENT_ID` в батче = `ctx.operationId + "-" + счётчик` (локально, без RPC).
- **`v12_queue.js`**: `ctx.operationId = generateEventId()` — один раз на слив.
- **`v12_handoff.js`** (`v12AdjustWarehouseQty`/`v12ApplyWarehouseDeltas`): `operationId` в аудите склада тоже из `ctx` (убирает по RPC на каждый materialKey).

### 5. Объединение записи POSITION_STATE
- **`v12_handoff.js`**: сырые поля передачи (`RECEIVED_BY_PRODUCTION`, `_QTY`, `_AT`, `_USER`) и `LIFECYCLE_STATE=ARCHIVED` при `ctx` кладутся в `ctx.positionWrites` (раньше — 2 отдельных `batchWrite` через `v12UpdatePosition`).

### 6. Блочная запись POSITION_STATE
- **`sheet_service.js`**: добавлена `batchWriteBlock(sheet, changes)` — одна `getValues` диапазона + merge + одна `setValues`.
- **`v12_sheet_service.js`**: `v12WritePositionBatch(writes)` выбирает блок (плотные пачки) либо построчные «отрезки» (разреженные) по порогу `span <= distinct*4 + 50`.
- **`v12_queue.js`**: слив POSITION_STATE идёт через `v12WritePositionBatch`.

## Верификация

- **`_local_tests/v12_received_perf_test.js`** (новый): пачка 200 позиций.
  - P1: все 200 переданы и архивированы — PASS;
  - P2: ARCHIVE/MATERIAL_HISTORY/EVENT_LOG = ровно 200 строк каждый — PASS;
  - P3: `appendRow` по этим листам = **0** (батч) — PASS;
  - P4: `getDataRange(MATERIAL_HISTORY)` = **1** (а не 200) — PASS;
  - P5: `Utilities.getUuid()` = **1** (а не 200) — PASS;
  - P6: `setValues(POSITION_STATE) ≤ 3` (блок, а не 3×200) — PASS.
- Полный прогон `_tmp_run.js` (все локальные тесты + `node --check`): **11/11 PASS, 0 fails**.

## Итог по ускорению
На «широкой» передаче (сотни позиций) устранены: O(N·M)-чтение истории, 3×N `appendRow`, N полных чтений `MATERIAL_HISTORY`, N UUID-RPC, ~2N лишних записей POSITION_STATE и per-position `getActive()`. Эти факторы в сумме дают **ускорение ≥10×** (основной вклад — устранение квадратичного чтения истории и замена тысяч поштучных записей на единичные батч-операции). Одиночный режим передачи сохранён без изменений.
