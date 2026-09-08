# BOM Control System V11 — Аудит производительности и план оптимизации

## Summary

Приложение — Google Apps Script (V8) для учёта BOM (Bill of Materials): импорт BOM-файлов из Google Drive, ведение состояния материалов, расчёт дефицитов, статусов, сводки, дашборда и архивирования. Работает целиком через SpreadsheetApp (листы MATERIAL_STATE, DEFICIT_SUMMARY, BOM_STATE, DASHBOARD, ARCHIVE, EVENT_LOG, SYSTEM_LOG, MATERIAL_HISTORY, BOM_REVISION).

Основная проблема — **медленные обновления** (5–10 секунд). Аудит показывает, что узкие места созданы систематическим дублированием чтения/записи листов, ничем не ограниченным `SpreadsheetApp.flush()` и `Utilities.sleep(500)` в горячих циклах, а также N+1 чтениями внутри циклов. Оценка: типичное «Обновить систему» делает **порядка десятков-сотен вызовов API SpreadsheetApp**, из которых минимум 4 секунды — чистые `sleep`.

---

## Architecture

**Паттерн:** процедурный, слоистый по файлам (engine-модули + сервисы). Данные между «памятью» и листами курсируют через обёртки `sheet_service.js`. Есть событийная шина (`event_engine.js`), но она лишь пишет в EVENT_LOG и вызывает обработчики.

**Потоки данных:**

- **Импорт:** `import_engine.parseBOMFile` → `importBOM` → `createBOMVersion` + `addMaterialFromBOM` (по каждой строке) → `refreshAfterChange`.
- **Полное обновление:** `controller.runFullUpdate` → цепочка: `saveDeficitChanges` → `recalculateMaterials` → `archiveReceivedMaterials` → `recalculateMaterials` → `updateDeficitSummary` → `recalculateBOMState` → `applyStatusColors` → `updateDashboard`, причём после **каждого** шага вызывается `syncV11()` (`flush` + `sleep(500)`).
- **Пересчёт статусов:** `status_engine.recalculateMaterials` — один проход по MATERIAL_STATE, собирает массив записей `{row, col, value}`, передаёт в `batchWrite`.
- **Сводка:** `deficit_engine.updateDeficitSummary` → читает MATERIAL_STATE, строит `result`, `clearBody` + `writeValues`, затем `createDeliveryCheckboxes`.
- **Цвета:** `color_engine.applyStatusColors` → читает 3 листа целиком и делает `setBackgrounds`.
- **Дашборд:** `dashboard_engine.updateDashboard` → читает BOM_STATE, пишет в DASHBOARD, пересоздаёт условное форматирование и фильтр.

**Старт выполнения:** пользовательское меню (`onOpen`) → `runFullUpdate` / `runBOMImport` / `updateDashboard` / `archiveReceivedMaterials`. Плановые триггеры: `v11ScheduledUpdate` (каждый час) и `v11OnEdit` (onEdit).

---

## Directory Structure

```
bom-control-system/
├── config.js            — V11_CONFIG: листы, колонки, заголовки, статусы, цвета, события, лимиты
├── sheet_service.js     — обёртки SpreadsheetApp: чтение/запись, clearBody, batchWrite, appendRow
├── material_service.js  — buildMaterialIndex, getMaterialById, updateMaterialState, findMaterialInBOM
├── status_engine.js     — computeMaterialStatus, recalculateMaterials, recalculateMaterialStatus/Deficit
├── deficit_engine.js    — updateDeficitSummary, saveDeficitChanges, чекбоксы «Получено»/«Реальная поставка»
├── bom_state_engine.js  — recalculateBOMState (агрегаты по BOM, статусы Gотов/красные/жёлтые)
├── color_engine.js      — applyStatusColors, getStatusColor, colorMaterialStateRows/Deficit/BOMMState
├── dashboard_engine.js  — updateDashboard, applyDashboardColors, setupDashboardFilter
├── archive_engine.js    — archiveMaterial, archiveReceivedMaterials, addMaterialHistory, appendHistoryRows
├── import_engine.js     — parseBOMFile, importBOM, syncAllBOM, compareMaterialChange
├── bom_engine.js        — addMaterialFromBOM, removeMaterialFromBOM, generateMaterialId, validateBOMMaterial
├── event_engine.js      — createEvent/processEvent, addSystemEvent, ID-функции событий
├── material_actions.js  — confirmRealDelivery, confirmMaterialReceived, updateDeadlineDate, updateMaterialOrder
├── trigger_engine.js    — v11OnEdit, v11ScheduledUpdate, refreshAfterChange, isV11Busy
├── controller.js        — onOpen, runFullUpdate, runBOMImport, syncV11, installV11
├── lock.js              — acquireScriptLock (реентрантный)
├── logger.js            — logSystem (пишет в SYSTEM_LOG)
├── utils.js             — toNumber, normalizeMaterialId, getCurrentUser
└── *.json               — clasp/appsscript
```

---

## Hot Paths / Bottlenecks (по убыванию приоритета)

### 1. КРИТИЧЕСКИЙ: `syncV11()` — чистые 500 мс сна на каждый вызов (controller.js)
```javascript
function syncV11() {
  SpreadsheetApp.flush();
  Utilities.sleep(500);
}
```
`runFullUpdate` вызывает `syncV11()` **8 раз** подряд (после каждого шага). Т.е. **4 секунды** — просто паузы, не работа. Добавим `flush` после каждого шага — лишние принудительные синхронизации.

**Оценка:** ~4 сек из 5–10 сек — это sleep. Один из самых дорогих глюков.

---

### 2. КРИТИЧЕСКИЙ: `batchWrite` — по одной ячейке через `setValue` (sheet_service.js)
```javascript
function batchWrite(sheet, changes) {
  if (!changes || changes.length === 0) return;
  changes.forEach((c) => {
    sheet.getRange(c.row, c.col).setValue(c.value);  // 1 API-вызов на ячейку!
  });
}
```
После исправления ошибки «setValues is not a function» мы оставили самый медленный вариант: **каждая ячейка = отдельный вызов SpreadsheetApp**. В `recalculateMaterials` на 1000 материалов это 4 записи на строку = **4000 вызовов setValue**. Google Apps Script имеет квоту, и каждый вызов — это сетевой запрос к серверу.

**Правильно:** группировать по строке, писать `setValues` диапазоном (1 вызов на строку) или использовать `setValues` по RLE-группе. В идеале — собрать все изменения в один 2D-массив на весь лист и записать один раз.

---

### 3. ОЧЕНЬ ВЫСОКИЙ: N+1 чтение листа `getMaterialById`/`buildMaterialIndex` в циклах (material_service.js, deficit_engine.js, archive_engine.js, material_actions.js)

`getMaterialById(materialId)` без `index` вызывает `buildMaterialIndex()`, который читает **весь** MATERIAL_STATE. В местах с циклом по элементам это квадратичная деградация:

- **`saveDeficitChanges`** (deficit_engine.js): цикл по строкам сводки → на каждую изменённую строку `getMaterialById(materialId)` (полный редист) + `updateMaterialState` (снова полный редист) + `flushSheets()` внутри цикла.
- **`archiveReceivedMaterials`** (archive_engine.js): цикл по полученным → `archiveMaterial(m.id)` → `getMaterialById` (редист), `getMaterialHistory` (редист MATERIAL_HISTORY), `updateMaterialState` (редист), `appendRow` и `createEvent` (по вызову на каждый).

**Оценка:** при 100–500 строках — десятки-сотни лишних полных чтений листов.

---

### 4. ОЧЕНЬ ВЫСОКИЙ: `flushSheets()` внутри цикла (deficit_engine.js — saveDeficitChanges, archive_engine.js)
```javascript
// deficit_engine.js
updateMaterialState(materialId, {...});
flushSheets();   // <-- в цикле!
addMaterialHistory({...});
```
`SpreadsheetApp.flush()` принудительно синхронизирует все ожидающие изменения с сервером. Внутри цикла это уничтожает пользу батчирования. Аналогично в `archiveMaterial` (archive_engine.js) вызывается `flushSheets()`.

---

### 5. ВЫСОКИЙ: `recalculateMaterials` вызывается ДВАЖДЫ в `runFullUpdate`
```javascript
recalculateMaterials();
syncV11();
archiveReceivedMaterials();
syncV11();
recalculateMaterials();  // <-- дубль
syncV11();
```
Второй полный пересчёт после архивации — избыточен, если архивация не меняет значения, влияющие на статус.

---

### 6. ВЫСОКИЙ: `clearBody` + `writeValues` + `createDeliveryCheckboxes` в `updateDeficitSummary` — очистка и повторная запись всего тела сводки, плюс пересоздание data-validations

`updateDeficitSummary` переписывает весь лист целиком (clearBody + writeValues) даже если изменилась одна строка. Плюс `createDeliveryCheckboxes` пересоздаёт валидации для всего диапазона. При частых небольших изменениях — это дорого.

---

### 7. ВЫСОКИЙ: `applyStatusColors` — 3 полных чтения + 3 `setBackgrounds`, каждый с 2D-массивом размера N×M
```javascript
function colorMaterialStateRows() {
  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);
  const data = range.getValues();  // весь лист в память
  const colors = data.map((row) => {
    ...
    return new Array(lastColumn).fill(color);
  });
  range.setBackgrounds(colors);
}
```
Для MATERIAL_STATE это массив `rows × 21` и `setBackgrounds` с одним вызовом. Это не столь плохо, но выполняется на каждом обновлении. Можно оптимизировать, обновляя только колонку STATUS/цвет, но это второстепенно.

---

### 8. СРЕДНИЙ: `createEvent` / `addSystemEvent` / `addMaterialHistory` — `appendRow` по одной строке
Каждая запись в EVENT_LOG/MATERIAL_HISTORY — отдельный `appendRow`. В `recalculateMaterials` события собраны в массивы и пишутся батчем (`appendEventRows`/`appendHistoryRows`) — хорошо. Но в `addMaterialFromBOM`, `confirmRealDelivery`, `updateDeadlineDate` и т.д. — по одному `appendRow` на материал. При импорте 100 позиций — 100 вызовов `appendRow` только на историю.

---

### 9. СРЕДНИЙ: `logSystem` — `appendRow` в SYSTEM_LOG при каждом вызове
`logSystem` вызывается очень часто (в начале/конце каждой функции, при ошибках). Каждый вызов — `sheet.appendRow`. Не критично само по себе, но в `runFullUpdate` + `recalculateMaterials` + `updateDeficitSummary` их десятки.

---

### 10. НИЗКИЙ/СРЕДНИЙ: `updateDashboard` пересоздаёт условное форматирование и фильтр при каждом вызове
`applyDashboardColors()` пересоздаёт все ConditionalFormatRules, `setupDashboardFilter()` удаляет и пересоздаёт фильтр. Это дорого и ломает пользовательские настройки фильтра.

---

## Причины замедления в «сборке»: что именно делает runFullUpdate

Примерный подсчёт затрат при M=1000 материалов, B=50 BOM, N=50 строк в сводке:

1. `syncV11()` ×8 → 4 сек sleep.
2. `recalculateMaterials()` ×2 → каждый: 1 чтение + `batchWrite` с 4×M=4000 вызовов setValue.
3. `saveDeficitChanges()` → 1 чтение сводки + на каждое изменение (может быть до N) — 2 чтения MATERIAL_STATE + flush + appendRow.
4. `archiveReceivedMaterials()` → 1 чтение + на каждый архив `archiveMaterial`: 2 чтения MATERIAL_STATE + 1 чтение MATERIAL_HISTORY + 2 appendRow + flush.
5. `updateDeficitSummary()` → 1 чтение MATERIAL_STATE + clearBody + writeValues + пересоздание чекбоксов.
6. `applyStatusColors()` → 3 чтения + 3 setBackgrounds.
7. `updateDashboard()` → 1 чтение BOM_STATE + writeValues + пересоздание правил и фильтра.

Итог: **тысячи** вызовов SpreadsheetApp. Основной вклад — `syncV11` (4 сек) и `batchWrite` по ячейкам.

---

## Data Flow (куда идёт деградация)

1. `runFullUpdate` → `syncV11()` (пауза 500мс ×8).
2. `recalculateMaterials` → 1 чтение → N×4 записей по ячейкам → `logSystem`.
3. `saveDeficitChanges` → чтение сводки → на каждое изменение `getMaterialById` (полное чтение) + `updateMaterialState` (полное чтение) + `flush` + `appendRow`.
4. `archiveReceivedMaterials` → чтение MATERIAL_STATE → на каждый материал `archiveMaterial` (2 чтения + appendRow×2 + flush).
5. `updateDeficitSummary` → чтение → clearBody → writeValues → пересоздание чекбоксов.
6. `applyStatusColors` → 3 чтения + 3 setBackgrounds.
7. `updateDashboard` → чтение → write → 4 conditional rules → фильтр.

---

## Key Abstractions (главные узлы оптимизации)

### `batchWrite(sheet, changes)`
- **Файл:** sheet_service.js
- **Ответственность:** запись набора `{row, col, value}`.
- **Проблема:** пишет каждую ячейку через `setValue` — O(N) вызовов API.
- **Оптимизация:** группировать по строке, записывать `Range.setValues` для каждой строки (или батч-диапазоном).

### `getMaterialById(materialId, index)`
- **Файл:** material_service.js
- **Ответственность:** поиск материала по ID, используя либо переданный индекс, либо полное чтение.
- **Проблема:** при вызове без `index` — полное чтение листа. В циклах — N+1.
- **Оптимизация:** всегда прокидывать индекс (созданный один раз) в местах, где идёт перебор.

### `recalculateMaterials()`
- **Файл:** status_engine.js
- **Ответственность:** полный пересчёт статусов/дефицитов всех материалов.
- **Проблема:** вызывается в runFullUpdate дважды; `batchWrite` по ячейкам.
- **Оптимизация:** один проход, батч-запись диапазоном; убрать дубль вызова.

### `syncV11()`
- **Файл:** controller.js
- **Ответственность:** принудительный flush + sleep.
- **Проблема:** 8 вызовов в runFullUpdate = 4 секунды сна.
- **Оптимизация:** убрать sleep или вызывать flush только там, где реально нужно (перед чтением в том же скрипте это не требуется).

### `saveDeficitChanges()`
- **Файл:** deficit_engine.js
- **Ответственность:** перенос ручных правок из сводки в MATERIAL_STATE.
- **Проблема:** цикл с N+1 чтениями + flush в цикле.
- **Оптимизация:** читать индекс один раз, накапливать изменения, писать батчем в конце.

### `archiveReceivedMaterials()` / `archiveMaterial()`
- **Файл:** archive_engine.js
- **Ответственность:** архивация полученных материалов.
- **Проблема:** на каждый материал — серия полных чтений и записи.
- **Оптимизация:** собирать данные по всем элементам в один проход, батчить.

---

## Non-Obvious Behaviors / Design Decisions

- **`batchWrite` изначально использовал несуществующий `RangeList.setValues`** — это была скрытая ошибка, которая ломала обновление. Мы перешли на поячеечную запись `setValue`, что исправляет ошибку, но радикально замедляет всё. Правильное решение — батчинг по строкам.
- **`syncV11` с `sleep(500)`** — задумывалось как «дать Sheets обновиться», но в Apps Script это не помогает и только крадёт время; `SpreadsheetApp.flush()` уже синхронизирует.
- **Повторные полные чтения** — `buildMaterialIndex()` активно используется везде, создавая соблазн вызывать его без индекса; в циклах это фатально для производительности.
- **`applyStatusColors` перерисовывает весь лист** целиком, хотя реально меняется только колонка статуса — но это дешевле, чем устранение N+1 для крупных объёмов.
- **`createDeliveryCheckboxes`** ранее использовал `getLastRow()` для определения числа строк — после удаления строк это создавало «осиротевшие» чекбоксы. Исправлено передачей фактического `rowCount`.

---

## Suggested Reading Order (для инженера, изучающего производительность)

1. `controller.js` — как устроен `runFullUpdate` и `syncV11` (главные паузы).
2. `sheet_service.js` — `batchWrite` и `clearRange` (где накапливается множество вызовов).
3. `status_engine.js` — `recalculateMaterials` (полный проход с поячеечной записью).
4. `deficit_engine.js` — `saveDeficitChanges` и `updateDeficitSummary` (N+1 чтения + flush в цикле).
5. `archive_engine.js` — `archiveReceivedMaterials`/`archiveMaterial` (серия отдельных вызовов).
6. `color_engine.js` — `applyStatusColors` (3 полных чтения + 3 setBackgrounds).

---

## План оптимизации (приоритезированный)

> ⚠️ Это план для реализации в **Act Mode**. Здесь (Explore Mode) изменения не вносятся.

### Этап 1 — Устранить 4 секунды сна (самый большой выигрыш)
- `controller.js`: удалить `Utilities.sleep(500)` из `syncV11()`, заменить на голый `SpreadsheetApp.flush()` (или вовсе убрать вызовы, если не требуется чтение сразу после). Убрать лишние `syncV11()` из `runFullUpdate` — flush вызывать только там, где действительно нужен (перед чтением листа в том же скрипте flush не обязателен).

### Этап 2 — Оптимизировать `batchWrite` (главный источник API-вызовов)
- `sheet_service.js`: переписать `batchWrite` так, чтобы группировать изменения по строкам и для каждой строки писать `Range.setValues` на диапазон (или использовать `setValues` по блоку). Примерно:
```javascript
function batchWrite(sheet, changes) {
  if (!changes || !changes.length) return;
  const byRow = {};
  changes.forEach((c) => { 
    if (!byRow[c.row]) byRow[c.row] = {};
    byRow[c.row][c.col] = c.value;
  });
  Object.keys(byRow).forEach((row) => {
    const cols = Object.keys(byRow[row]).map(Number);
    const min = Math.min(...cols);
    const max = Math.max(...cols);
    const values = [];
    for (let col = min; col <= max; col++) {
      values.push(byRow[row][col] !== undefined ? byRow[row][col] : "");
    }
    sheet.getRange(Number(row), min, 1, values.length).setValues([values]);
  });
}
```
Такое решение сводит количество вызовов с N (ячейки) до числа строк с изменениями.

### Этап 3 — Убрать N+1 чтения в `saveDeficitChanges` и `archiveReceivedMaterials`
- `deficit_engine.js`: в `saveDeficitChanges` создать индекс `buildMaterialIndex()` один раз, прокинуть его в `getMaterialById(materialId, index)` и `updateMaterialState(materialId, changes, index)`. Убрать `flushSheets()` из цикла; накопить все изменения и записать одним `batchWrite`.
- `archive_engine.js`: в `archiveReceivedMaterials` собрать все материалы и в цикле передать один общий индекс; убрать `flushSheets()` из `archiveMaterial` или вызывать один раз после цикла.

### Этап 4 — Убрать дубль `recalculateMaterials` в `runFullUpdate`
- `controller.js`: оставить один вызов после архивации; пересчёт после `archiveReceivedMaterials` не требуется, т.к. `archiveMaterial` сам обновляет статус.

### Этап 5 — Минимизировать `clearBody`/`writeValues` для сводки
- `deficit_engine.js`: если изменений мало, можно обновлять только затронутые строки (запись значений по конкретным диапазонам), а не переписывать весь лист. Но для простоты и надёжности достаточно оставить, поскольку это одна пара операций.

### Этап 6 — Оптимизировать цвета/дашборд (опционально)
- `color_engine.js`: `applyStatusColors` можно сократить до обновления только колонки STATUS (или STATE) для MATERIAL_STATE, если это допустимо. Но 3 чтения + 3 setBackgrounds не столь критичны.

### Этап 7 — Батчировать `logSystem` и историю
- `logger.js` + `event_engine.js`: накопить строки логов внутри операции и записать одним `appendRow`/`setValues` в конце (например, в `recalculateMaterials` уже есть `appendHistoryRows`/`appendEventRows`). Для одиночных действий — не критично.

### Ожидаемые результаты
- Устранение `sleep`: −4 сек.
- Батчинг записи: при 1000 материалов с `batchWrite` по строкам — сотни вызовов вместо тысяч.
- Устранение N+1: −десятки-сотни полных чтений.
- Итог: обновление должно уложиться в **1–2 секунды** (при разумном размере данных) вместо 5–10.

---

## Module Reference (кратко)

| Файл | Роль | Ключевая оптимизация |
|------|------|----------------------|
| `controller.js` | Меню, `runFullUpdate`, `syncV11` | Убрать sleep(500), убрать дубль recalc |
| `sheet_service.js` | Чтение/запись, `batchWrite`, `clearRange` | Батчинг по строкам вместо ячеек |
| `status_engine.js` | `recalculateMaterials`, `computeMaterialStatus` | Батч-запись, убрать дубль вызова |
| `material_service.js` | `buildMaterialIndex`, `getMaterialById`, `updateMaterialState` | Прокидывать индекс в циклы |
| `deficit_engine.js` | `updateDeficitSummary`, `saveDeficitChanges` | N+1 → один индекс, убрать flush в цикле |
| `archive_engine.js` | `archiveReceivedMaterials`, `archiveMaterial` | Общий индекс, убрать flush в цикле |
| `color_engine.js` | `applyStatusColors` | (опц.) обновлять только колонку статуса |
| `dashboard_engine.js` | `updateDashboard`, filter, CF-rules | (опц.) не пересоздавать фильтр каждый раз |
| `event_engine.js` | `createEvent`, `addSystemEvent` | (опц.) батчировать записи |
| `logger.js` | `logSystem` | (опц.) батчировать лог |

---

## Сводка: главные «убийцы» скорости

1. **`syncV11` → `Utilities.sleep(500)` × 8 = 4 сек** — чистые паузы.
2. **`batchWrite` → `setValue` по каждой ячейке** — тысячи вызовов при полном пересчёте.
3. **N+1 чтения листа** (без индекса) в `saveDeficitChanges`, `archiveReceivedMaterials`, `recalculateMaterialStatus`.
4. **`flushSheets()` внутри циклов** — разрушает батчинг.
5. **Дублирование `recalculateMaterials`** в `runFullUpdate`.

Реализация этапов 1–4 даст основной прирост и уложит обновление в 1–2 секунды. Для внесения изменений переключитесь в **Act Mode**.
