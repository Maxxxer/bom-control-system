# BOM CONTROL SYSTEM V11 — Анализ производительности (Explore Mode)

## Резюме

Это проект **Google Apps Script** (V8, `appsscript.json`), представляющий собой Single-Page-контролер BOM (Bill of Materials): импорт BOM из Google Drive, расчёт статусов/дефицитов, сводка дефицитов, дашборд, архивация, экспорт обратно в BOM-файлы. Выполнение построено как последовательность «движков» (`status_engine`, `deficit_engine`, `bom_state_engine`, `dashboard_engine`, `color_engine`, `archive_engine`, `import_engine`, `export_engine`), вызываемых из `runFullUpdate()` / `v11ScheduledUpdate()` / `refreshAfterChange()`.

Заявленная нагрузка: **до 200 BOM-файлов × до 200 позиций ≈ 40 000 строк MATERIAL_STATE**, сводка дефицитов **до 1000 строк**. При таком объёме текущая архитектура не укладывается в лимиты GAS (6 мин на простой триггер, 30 мин суточно; десятки тысяч вызовов SpreadsheetApp в сутки).

---

## Архитектура

- **Паттерн**: цепочка последовательных «движков» + событийная шина. Один Master-поток `runFullUpdate()` вызывает движки друг за другом; точечные действия (чекбоксы, изменение заказа/дат) идут через `createEvent()` → `processEvent()` → `*_actions`.
- **Техстек**: Google Apps Script (V8), SpreadsheetApp / DriveApp / LockService / PropertiesService / ScriptApp. Только один лист-источник — `MATERIAL_STATE` (21 колонка).
- **Входная точка**: `runFullUpdate()` (меню) / `v11ScheduledUpdate()` (таймер каждый час) / `refreshAfterChange()` (после каждого onEdit или импорта). Все три вызывают практически одинаковую полную цепочку пересчётов.
- **Центральные данные**: `MATERIAL_STATE` — единственный источник истины; `DEFICIT_SUMMARY`, `BOM_STATE`, `DASHBOARD` — производные представления, полностью пересобираемые при каждом обновлении.

## Структура каталогов (значимое)

```
bom-control-system/            (корень .clasp, rootDir = "")
├── appsscript.json            — конфиг GAS (V8, веб-апп, скопы)
├── config.js                  — V11_CONFIG: листы, колонки, статусы, цвета, лимиты
├── controller.js              — меню, runFullUpdate, installV11
├── sheet_service.js           — обёртки над SpreadsheetApp (readSheetValues, batchWrite…)
├── material_service.js        — buildMaterialIndex, getMaterialById, updateMaterialState
├── status_engine.js           — computeMaterialStatus, recalculateMaterials
├── deficit_engine.js          — updateDeficitSummary, saveDeficitChanges, чекбоксы
├── bom_state_engine.js        — recalculateBOMState (агрегаты по BOM)
├── dashboard_engine.js        — updateDashboard, applyDashboardColors, setupDashboardFilter
├── color_engine.js            — applyStatusColors, getStatusColor
├── archive_engine.js          — archiveReceivedMaterials, getMaterialHistory
├── import_engine.js           — getAllBOMFiles, syncAllBOM, importBOM
├── export_engine.js           — exportBOMFile (обратная запись в BOM-файлы)
├── event_engine.js            — createEvent, processEvent, appendEventRows
├── trigger_engine.js          — v11OnEdit, v11ScheduledUpdate, refreshAfterChange
├── bom_engine.js              — addMaterialFromBOM, createBOMVersion
├── exclusions_registry.js     — isBOMDone, setBOMDone, getExcludedBOMList
├── material_actions.js        — confirmRealDelivery, confirmMaterialReceived…
└── logger.js / lock.js / utils.js / roles.js
```

---

## Ключевые абстракции

### `V11_CONFIG` (config.js)
- **Файл**: `config.js`
- **Ответственность**: единый источник правды — имена листов, индексы колонок (1-based), статусы, цвета, лимиты (`LIMITS.MAX_MATERIALS: 10000`), настройки (`CACHE_SECONDS: 300`).
- **Жизненный цикл**: глобальная константа, доступна во всех движках.

### `buildMaterialIndex()` (material_service.js)
- **Файл**: `material_service.js`
- **Ответственность**: читает `MATERIAL_STATE` один раз и строит `Map<normalizedId, {row, values}>`.
- **Проблема**: вызывается **очень часто**, иногда без передачи готового индекса — в таком случае при **каждом** вызове заново читает весь лист (см. «Узкие места»).

### `getMaterialById()/findMaterialInBOM()` (material_service.js)
- **Файл**: `material_service.js`
- **Проблема**: если второй аргумент (`index`) не передан, внутри вызывают `buildMaterialIndex()` → полная перечитка `MATERIAL_STATE` на каждый вызов.

### `computeMaterialStatus()` (status_engine.js)
- Ответственность: чистый расчёт из строки — возвращает `{status, state, deficit, oldStatus, oldState, hasError}`. Статус определяется по правилу: получил → склад → заказ 0 → заказ < дефицита → нет даты → опоздание. Сам по себе быстрый, но вызывается по всей 40k-таблице.

### `recalculateMaterials()` (status_engine.js)
- **Ответственность**: один проход по `MATERIAL_STATE`, эталон: пишет 4 колонки (DEFICIT/STATUS/STATE/UPDATED) и накапливает `historyRows`/`eventRows`.
- **Проблема**: форматирование `new Date()` для UPDATED на **каждую** строку + накопление истории/событий, которые потом пишутся отдельными вызовами.

### `updateDeficitSummary()` (deficit_engine.js)
- **Ответственность**: читает `MATERIAL_STATE`, фильтрует полученные/архивные, строит до 1000 строк и перезаписывает тело `DEFICIT_SUMMARY` целиком (`clearBody` + `writeValues`), затем пересоздаёт чекбоксы.
- **Проблема**: `createDeliveryCheckboxes(maxRows)` очищает и заново ставит dataValidation на **все** строки до `lastRow` (а не только на `rowCount`), даже пустые.

### `recalculateBOMState()` (bom_state_engine.js)
- **Ответственность**: агрегирует по BOM (до 200 BOM) и переписывает `BOM_STATE`. Сохраняет кэш `_bomStateCache` в модульную переменную.
- **Проблемы**: кэш живёт только в рамках одного исполнения скрипта (в GAS каждое меню/триггер — новый контекст), поэтому `updateDashboard`, вызванный отдельно, заново пересчитывает BOM. Также `missingText` собирается строкой через `map().join()`.

### `updateDashboard()` (dashboard_engine.js)
- **Ответственность**: копирует `BOM_STATE` в `DASHBOARD`, добавляет чекбокс «Выполнено», hover-ноты, условия форматирования, фильтр, `autoResizeColumns`.
- **Проблемы**: `isBOMDone(bom)` вызывается **для каждой** BOM и каждый раз читает весь лист `EXCLUDED_BOMS`; `setNote()` — по одной на строку; `autoResizeColumns()` — очень медленная операция.

### `archiveReceivedMaterials()` / `archiveMaterial()` (archive_engine.js)
- **Ответственность**: перемещает полученные позиции в `ARCHIVE`.
- **Проблема**: для каждого архивируемого материала вызывается `getMaterialHistory(materialId)` — полная перечитка **всей** `MATERIAL_HISTORY` (до 50k строк) с фильтрацией, затем `appendRow` в архив и `createEvent`.

### `exportBOMFile()` (export_engine.js)
- **Ответственность**: обратная запись центра `MATERIAL_STATE` в исходные BOM-файлы Drive.
- **Проблема**: запись **по ячейке** через `sheet.getRange(row, col).setValue(...)` — до 6 вызовов на строку. При 200 файлах × 200 строк это **до 240 000 вызовов** только за один экспорт.

### `logSystem()` (logger.js)
- **Ответственность**: пишет в `SYSTEM_LOG`.
- **Проблема**: каждая запись — отдельный `sheet.appendRow(...)`. При множественных вызовах (`syncAllBOM` на 200 файлов, `refreshAfterChange` и т.д.) это сотни лишних API-вызовов.

---

## Поток данных (полное обновление `runFullUpdate`)

1. `saveDeficitChanges()` — читает `DEFICIT_SUMMARY`, строит индекс `MATERIAL_STATE`, по каждому изменённому `updateMaterialState()` + `addMaterialHistory()`.
2. `recalculateMaterials()` — читает `MATERIAL_STATE`, пишет 4 колонки, копит историю/события, пишет их `appendHistoryRows/appendEventRows`.
3. `archiveReceivedMaterials()` — снова читает `MATERIAL_STATE`, архивирует.
4. `updateDeficitSummary()` — **третий раз** читает `MATERIAL_STATE`, читает старую сводку, перезаписывает её, чистит чекбоксы.
5. `recalculateBOMState()` — **четвёртый раз** читает `MATERIAL_STATE` + `BOM_REVISION`, пишет `BOM_STATE`.
6. `applyStatusColors()` — читает `MATERIAL_STATE` (5-й), `DEFICIT_SUMMARY`, `BOM_STATE` и красит фоны.
7. `updateDashboard()` — читает `BOM_STATE`, на каждый BOM `isBOMDone()` (много чтений `EXCLUDED_BOMS`), ставит ноты, `autoResizeColumns`, фильтр.

**Вывод**: в одном полном обновлении `MATERIAL_STATE` читается ~5 раз, `DEFICIT_SUMMARY` ~3-4 раза, `BOM_STATE` ~3 раза. При 40k строк каждый read — это огромная передача данных, но главное — **число вызовов** SpreadsheetApp.

---

## Узкие места (ранжировано по влиянию на заявленный масштаб)

### КРИТИЧНО 1: Многократная перечитка `MATERIAL_STATE` через `buildMaterialIndex()`
- `findMaterialInBOM(bom, row)` в `import_engine.js` вызывается **без** индекса → внутри `buildMaterialIndex()`, **полная перечитка** листа на каждый материал.
- `addMaterialFromBOM()` → `getMaterialById(id)` без индекса → полная перечитка.
- `compareMaterialChange()` → `updateMaterialState()` и `recalculateMaterialDeficit()` — каждый без индекса → ещё по 1-2 перечитки на материал.
- **Итог**: на одном BOM-файле (200 позиций) до ~400-1000 полных чтений 40k-строк; на 200 файлах — десятки/сотни тысяч чтений. Это полностью ломает лимиты: O(n²) по числу материалов.

### КРИТИЧНО 2: `exportBOMFile()` — запись по ячейкам
- До 6 `setValue()` на строку. 200 файлов × 200 строк = до 240 000 вызовов. Ежедневная квота SpreadsheetApp — 20 000 вызовов, т.е. экспорт даже одного крупного батча превышает квоту.
- `exportBOMMaterialsToDrive()` вызывается в `v11ScheduledUpdate()` — то есть каждый час, что гарантированно исчерпает квоту.

### КРИТИЧНО 3: `refreshAfterChange()` — полная цепочка на каждый onEdit
- Любая правка (чекбокс, изменение заказа/дат) в `v11OnEdit` вызывает `refreshAfterChange()`, который запускает `saveDeficitChanges` → `recalculateMaterials` → `recalculateBOMState` → `updateDeficitSummary` → `updateDashboard` → `applyStatusColors`.
- То есть **одно** изменение одной ячейки приводит к 5-7 полным обходам таблицы. Это неприемлемо для 40k строк.

### ВЫСОКО 4: `archiveMaterial()` → `getMaterialHistory()` — полная перечитка истории
- На каждый архивируемый материал читается вся `MATERIAL_HISTORY` (лимит 50k строк). При массовой архивации 1000 материалов — 1000 полных чтений 50k строк.

### ВЫСОКО 5: `updateDashboard()` — per-BOM чтение `EXCLUDED_BOMS` + per-row `setNote`
- `isBOMDone(bom)` читает весь `EXCLUDED_BOMS` для **каждой** BOM (до 200 раз).
- `setNote()` — отдельный вызов на строку (до 200 вызовов).
- `autoResizeColumns()` — одна из самых медленных операций SpreadsheetApp; на 200×11 может занять десятки секунд.

### СРЕДНЕ 6: `logSystem()` — appendRow на каждый вызов
- В `syncAllBOM`/`refreshAfterChange` десятки-сотни вызовов → сотни лишних API-вызовов и непроизводительный рост `SYSTEM_LOG`.

### СРЕДНЕ 7: `createDeliveryCheckboxes()` чистит валидации на все строки
- `clearDataValidations` и `setDataValidation` ставятся на `maxRows = max(lastRow-1, rowCount)` — т.е. на пустые строки тоже. Не критично при 1000, но лишние вызовы.

### СРЕДНЕ 8: Повторные чтения в цветовом движке
- `colorMaterialStateRows/colorDeficitSummaryRows/colorBOMStateRows` — каждый читает свой лист заново, хотя данные уже читались другими движками. `setBackgrounds` на 40k×21 — один вызов, но передача 840k цветов.

---

## Неочевидные поведения и проектные решения

- **`MATERIAL_STATE` читается по 5 раз в одном `runFullUpdate`** — это следствие «чистых» движков, каждый из которых самодостаточен (читает свой лист сам). Для производительности нужен общий «контекст/кэш» данных, передаваемый между движками.
- **`_bomStateCache` — модульная переменная**. В GAS каждый запуск меню/триггера — новый контекст, поэтому кэш не переживает вызовов. `updateDashboard()` отдельно вызывает `recalculateBOMState()` заново. Это «скрытый» источник двойного пересчёта.
- **`importBOM()` — самая тяжёлая функция**: для каждого материала делает поиск через индекс, который не передаётся. Формально «работает», но на 40k материалов превращается в катастрофу.
- **`exportBOMFile()` возвращает количество строк**, но пишет по ячейке. Это явно «прототипный» код без учёта квот — предположительно создавался на малых объёмах.
- **`batchWrite()`** уже группирует записи по строкам в непрерывные диапазоны — хороший паттерн, но он не используется в горячих путях (`exportBOMFile`, `isBOMDone/setBOMDone`).
- **`recalculateMaterials`** пишет UPDATED для **всех** строк, даже тех, где ничего не изменилось — это приводит к «миганию» дат и к ненужной записи 40k ячеек.
- **`saveDeficitChanges` + `updateDeficitSummary`** — двойная запись: сначала сохраняются ручные изменения в центр, затем сводка перерисовывается, риск потери ручного ввода при ошибке между шагами.
- **`isBOMDone`/`setBOMDone`/`getExcludedBOMList`** не кэшируются — каждый вызов читает `EXCLUDED_BOMS` целиком.

---

## Рекомендации по оптимизации (для реализации в Act Mode)

1. **Единый индекс/контекст на операцию**: создать объект-контекст `{ materialIndex, bomCache, deficitOld, ... }`, который строится **один раз** на входе `runFullUpdate`/`syncAllBOM` и передаётся/используется всеми движками. Убрать все вызовы `buildMaterialIndex()` внутри циклов.
2. **Переписать `importBOM`**: строить индекс один раз на весь `syncAllBOM`, использовать `getMaterialById(id, index)` / `findMaterialInBOM(bom, row, index)` с переданным индексом. Накопить записи в память и писать батчами, а не через N вызовов.
3. **Батчевый экспорт**: вместо 6 `setValue()` на строку — собрать колонки и писать `setValues` по одной операции на файл (или на колонку). Или вообще объединять в один `getRange(...).setValues()` по всему файлу.
4. **Точечное обновление в onEdit**: вместо `refreshAfterChange()` (полная цепочка) — выполнять точечный «recalc материала + перерисовка сводки/BOM/дашборда» только для затронутого BOM, либо дебаунсить (отложить полный пересчёт).
5. **Кэшировать `EXCLUDED_BOMS`** — читать один раз и передавать как объект `{bom: done}`.
6. **Батчевая история/события**: в `saveDeficitChanges` и `archiveReceivedMaterials` копить строки и писать одним `writeValues`, вместо N `appendRow`.
7. **Убрать лишние полные пересчёты**: читать `MATERIAL_STATE` один раз в `runFullUpdate`, передавать в `recalculateMaterials`/`updateDeficitSummary`/`recalculateBOMState`/`archiveReceivedMaterials` через параметр.
8. **Убрать/упростить `autoResizeColumns`, `setNote` per-row**; `setNote` — собирать только для строк с `missingItems` и делать реже.
9. **`logSystem`** — буферизовать в память и писать батчем в конце операции, либо отключать DEBUG/INFO на время массовых операций.
10. **`recalculateMaterials`** — не писать значение в колонке `UPDATED` для всех подряд, а только для строк, где реально изменились расчётные поля.

---

## Модульный справочник (значимые файлы)

| Файл | Назначение |
|------|-----------|
| `config.js` | Все константы: листы, колонки, статусы, цвета, лимиты, настройки |
| `controller.js` | `runFullUpdate`, `installV11`, меню |
| `sheet_service.js` | `readSheetValues`, `writeValues`, `batchWrite`, `clearBody`, `flushSheets` |
| `material_service.js` | `buildMaterialIndex`, `getMaterialById`, `updateMaterialState`, `findMaterialInBOM` |
| `status_engine.js` | `computeMaterialStatus`, `recalculateMaterials`, `recalculateMaterialStatus` |
| `deficit_engine.js` | `updateDeficitSummary`, `saveDeficitChanges`, `createDeliveryCheckboxes` |
| `bom_state_engine.js` | `recalculateBOMState`, `getBOMStateCache` |
| `dashboard_engine.js` | `updateDashboard`, `applyDashboardColors`, `setupDashboardFilter` |
| `color_engine.js` | `applyStatusColors`, `getStatusColor` |
| `archive_engine.js` | `archiveReceivedMaterials`, `archiveMaterial`, `getMaterialHistory` |
| `import_engine.js` | `syncAllBOM`, `parseBOMFile`, `importBOM`, `compareMaterialChange` |
| `export_engine.js` | `exportBOMFile` (поячеечная запись — главный тормоз экспорта) |
| `event_engine.js` | `createEvent`, `processEvent`, `appendEventRows` |
| `trigger_engine.js` | `v11OnEdit`, `v11ScheduledUpdate`, `refreshAfterChange` |
| `bom_engine.js` | `addMaterialFromBOM`, `createBOMVersion` |
| `exclusion_registry.js` | `isBOMDone`, `setBOMDone`, `getExcludedBOMList` |
| `material_actions.js` | действия с материалом (поставка, получение, даты, заказ) |
| `logger.js` / `lock.js` / `utils.js` / `roles.js` | лог, блокировка, утилиты, роли |

---

## Рекомендуемый порядок чтения для оптимизации

1. `import_engine.js` + `bom_engine.js` — самый горячий путь (переиндексация на каждый материал).
2. `material_service.js` — как работают индекс и CRUD, куда добавить кэш.
3. `trigger_engine.js` — где вызывается `refreshAfterChange` (полный пересчёт на каждый onEdit).
4. `export_engine.js` — главный источник превышения квот из-за поячеечной записи.
5. `dashboard_engine.js` / `archive_engine.js` — per-BOM чтение `EXCLUDED_BOMS`, per-material чтение истории.
6. `status_engine.js` / `deficit_engine.js` / `bom_state_engine.js` — где дублируются чтения/LICENSE `MATERIAL_STATE`.

---
