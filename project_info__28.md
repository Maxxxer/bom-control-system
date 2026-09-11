# BOM CONTROL SYSTEM V12 — Полный аудит: производительность, мёртвый код, конфликты логики

> Документ составлен по результатам чтения **всех** исходных файлов проекта `c:\Users\Максим\BOM_CONTROL_SYSTEM` (актуальное состояние кода, а не только `task_progress.md`).
> Предыдущая серия `project_info__1…27` описывала промежуточные состояния схемы ОТБОРКИ (13 колонок с «Ожидаемая поставка»). **Текущий код отличается:** ОТБОРКА сейчас — 12 колонок, кол. 11 = «Дата поставки» (отображение `REAL_DELIVERY_DATE`), чекбокс на кол. 12. Это подтверждают `_local_tests/v12_picking_schema_test.js` и `V12_CONFIG.HEADERS.PICKING`.

---

## 1. Что это за система

Google Apps Script (`.js`, runtime V8, `appsscript.json`) + Google Sheets. Система управляет потребностью в комплектующих (BOM) для производственных проектов: читает **исходные BOM только на чтение** из папки Google Drive, строит центральное операционное состояние и набор «проекций» (представлений) для снабжения, склада, производства и руководителя.

Пользователи: снабженец (заказ/дата/поставка), кладовщик/производство (отборка и передача), экономист (обновление BOM), администратор, наблюдатель.

Масштаб по конфигу: до 100 000 позиций, до 2 000 BOM (`V12_CONFIG.LIMITS`). На таком объёме текущая реализация проекций работать **не будет** (см. раздел 6).

## 2. Архитектура

Поток данных (заложен в `v12_config.js`, комментарий-манифест):

```
ORIGINAL BOM (Drive, read-only)
  -> BOM_REGISTRY          (реестр: bomId, ревизия, hash, dirty)
    -> POSITION_STATE      (31 колонка — центральное состояние позиции)
      -> MATERIAL_STATE    (физический склад)
      -> DEFICIT_SUMMARY / ОТБОРКА / WORKING BOM / СНАБЖЕНИЕ / Dashboard  (проекции)
```

Разделение «источник ≠ состояние ≠ представление»:
- **SOURCE** — файлы BOM на Drive, никогда не перезаписываются (`v12_source.js`).
- **STATE** — `POSITION_STATE` (истина по позиции) + `MATERIAL_STATE` (физический склад).
- **VIEW** — 5 листов-проекций, полностью пересобираемых из `POSITION_STATE`.
- **Журналы** — `AUDIT_LOG`, `SYSTEM_LOG` (+ заявленные, но мёртвые `EVENT_LOG`, `MATERIAL_HISTORY`, `BOM_REVISION`).

Технологический стек: чистый JavaScript без сборщика, без типов, `clasp` для выгрузки. Никаких внешних библиотек. Вся логика — глобальные функции (нет модулей/классов; единственные «структуры» — литералы конфигов).

Точки входа:
- `onOpen()` → `v12OnOpen()` — меню (простой триггер GAS).
- `v12OnEdit(e)` — устанавливаемый installable-триггер (`v12InstallTriggers`).
- `v12ScheduledUpdate()` — почасовой time-based триггер.

## 3. Структура каталогов

```
BOM_CONTROL_SYSTEM/
├─ appsscript.json          — манифест (V8, scopes, webapp)
├─ .clasp.json              — конфигурация clasp (rootDir = "")
├─ .claspignore             — исключения выгрузки (в т.ч. _local_tests/)
│
├─ v12_config.js            — ЕДИНЫЙ конфиг: листы, колонки, статусы, роли, цвета, события
├─ v12_source.js            — чтение исходных BOM из Drive + BOM_REGISTRY (upsert/hash)
├─ v12_sheet_service.js     — доступ к листам V12, индексы, миграции схем, точечные записи
├─ v12_position_state.js    — построение/применение строки POSITION_STATE
├─ v12_calculate.js         — ЧИСТЫЙ расчётный движок (8 количеств, состояния, флаги)
├─ v12_change_engine.js     — detectBOMChanges → ChangeSet → applySourceRevision, синхронизация
├─ v12_material_state.js    — MATERIAL_STATE, агрегация резервов, контроль reserved ≤ warehouse
├─ v12_operations.js        — операционные действия снабжения (заказ/дата/реальная поставка)
├─ v12_projections.js       — 5 проекций (DEFICIT_SUMMARY/ОТБОРКА/WORKING BOM/СНАБЖЕНИЕ/Dashboard)
├─ v12_handoff.js           — передача производству (идемпотентная) + возврат из архива
├─ v12_roles.js             — RBAC (email → роль), проверка прав
├─ v12_audit.js             — буферизованный AUDIT_LOG
├─ v12_trigger.js           — onEdit-роутер, обработчики листов, установка триггеров, full sync
├─ v12_controller.js        — меню, установка, диагностика, консистентность, self-тест
│
├─ sheet_service.js         — generic-обёртки SpreadsheetApp (getSheet/read/write/batchWrite)
├─ utils.js                 — generic-утилиты (toNumber, даты, UUID, пользователь)
├─ logger.js                — буферизованный SYSTEM_LOG
├─ lock.js                  — реентрантный ScriptLock
│
└─ _local_tests/            — Node-скрипты (vm) для локального прогона; НЕ выгружаются
   ├─ v12_delivery_test.js       — цепочка «Реальная поставка» (9 сценариев)
   └─ v12_picking_schema_test.js — схема/миграция/окраска ОТБОРКИ
```

## 4. Ключевые абстракции

### `V12_CONFIG` (`v12_config.js`)
- **Ответственность**: единственный источник правды по листам, номерам колонок, заголовкам, статусам, цветам, ролям, порогам.
- **Почему так**: изменения схемы делаются в одном месте; весь код обращается к колонкам **только** через именованные ключи (`P.ORDERED_QTY`), жёстких числовых индексов в рабочем коде почти нет.
- **Замечание**: содержит заметный объём неиспользуемых ветвей (см. раздел 5).

### Позиция (`POSITION_STATE`, 31 колонка)
- Ядро системы. `positionId` = `<bomId>:<materialKey>` (при дублях — суффикс `#2`, `#3`) — генерируется в `v12GeneratePositionId` (`v12_utils.js`).
- `materialKey` (`v12BuildMaterialKey`, решение К5): `code`, иначе `name|model|unit`.
- Строка строится `v12BuildPositionRow` и пересчитывается `v12ApplyComputedToRow` (`v12_position_state.js`).

### `v12CalculatePositionState` (`v12_calculate.js`)
- **Чистая функция без I/O** — главное достоинство архитектуры. Вход: количества/даты; выход: `deficitQty`, `uncoveredNeed`, `overOrderedQty`, `shortDeliveryQty`, `availableForProduction`, `readyForHandoff`, `supplyState`, `productionState`, `flags`, `valid`.
- **Ключевые формулы**: `deficit = max(0, required − reserved)`; `uncovered = max(0, deficit − ordered)`; `availableForProduction = reserved + realDelivery` (решение **К1**).
- **Проблема**: вход `warehouseQty` присваивается в `const warehouse = ...` и **далее не используется** (мёртвый вход, баг B3).

### `v12OnEdit` (`v12_trigger.js`)
- Роутер правок: по имени листа и колонке вызывает специализированный обработчик; поддерживает диапазонные правки в DEFICIT_SUMMARY и ОТБОРКЕ; оборачивает всё в `acquireScriptLock()`.
- **Проблема**: каждый отдельный edit ведёт к **полной** пересборке **всех** проекций (см. раздел 6).

### Проекции (`v12_projections.js`)
- `v12RefreshAllProjections` / `v12RefreshProjections` вызывают 5 пересборщиков: DEFICIT_SUMMARY, ОТБОРКА, WORKING BOM, СНАБЖЕНИЕ, Dashboard.
- Есть точечное обновление одной строки сводки — `v12RefreshDeficitSummaryRow` (образец правильного подхода, но применяется только к DEFICIT_SUMMARY).
- Механизмы «harvest» (`v12HarvestDeficitInput`, `v12HarvestPickingInput`) — страховка от потери массовых отметок, если `onEdit` не сработал по каждой ячейке.

### `v12MarkReceivedByProduction` (`v12_handoff.js`)
- Идемпотентная передача позиции производству: проверка роли, валидности, доступности; запись `RECEIVED_BY_PRODUCTION*`; архивация (`v12ArchivePosition` → `ARCHIVE` + `lifecycle=ARCHIVED`); списание со склада (`v12AdjustWarehouseQty(-required)`); аудит. Возврат — `v12ReturnFromArchive`.

### Сервисный слой (`sheet_service.js`)
- Все обращения к диапазонам идут через `readSheetValues`, `writeValues`, `clearBody`, `appendRow`, `ensureSheet`, `batchWrite`.
- `batchWrite` группирует изменения по строкам и пишет **непрерывные отрезки** колонок через `setValues` — снижает число вызовов SpreadsheetApp.

### Буферизация журналов (`logger.js`, `v12_audit.js`)
- `logSystem`/`v12Audit` копят строки в памяти и сбрасывают пачкой при достижении порога (50 / 40) или по `flush`.
- `acquireScriptLock` (`lock.js`) — реентрантный: вложенные вызовы не блокируются, счётчик глубины.

## 5. Мёртвый код, dead config и незавершённые функции

### 5.1 Функции, которые нигде не вызываются (безопасно удалить)

| Файл | Функция | Комментарий |
|------|---------|-------------|
| `utils.js` | `getCurrentUserSafe()` | обёртка без вызовов |
| `utils.js` | `toDate()` + `isValidDate()` | `isValidDate` нужен только `toDate`; V12 использует `v12ToDate`/`v12DateValue`; обе свободны |
| `utils.js` | `normalizeDateValue()` | не вызывается (используется `v12DateValue`) |
| `utils.js` | `emptyArray()` | не вызывается |
| `logger.js` | `safeSystemLog()` | дублирует `logSystem`, не вызывается |
| `v12_utils.js` | `v12BuildPositionStableKey()` | не вызывается (id строится через `v12GeneratePositionId`) |
| `v12_sheet_service.js` | `v12AppendRows()` | не вызывается (используется `writeValues`) |
| `v12_position_state.js` | `v12IsActivePosition()` | не вызывается |
| `v12_calculate.js` | `v12IsReadyForHandoff()` | не вызывается (готовность — флаг `readyForHandoff`) |
| `v12_calculate.js` | `v12IsReservationPhysicalInconsistent()` | не вызывается |
| `v12_material_state.js` | `v12BuildWarehouseMap()` | не вызывается (используется `v12BuildMaterialIndex`) |
| `v12_projections.js` | `v12SupplyStatusDisplay()` | не вызывается (статус снабжения нигде не рендерится) |
| `v12_roles.js` | `v12RoleLabel()` | не вызывается |
| `v12_trigger.js` | `v12IsBusy()` | читает флаг `V12_RECALCULATING`, но им никто не пользуется (`v12SetBusy` пишет в пустоту) |

### 5.2 Мёртвая конфигурация (`v12_config.js`)
- `SETTINGS.LOG_BUFFER_THRESHOLD` — не используется (порог зашит в `logger.js`).
- `SETTINGS.ENABLE_HISTORY`, `ENABLE_AUTO_WORKING_BOM`, `AUTO_RESIZE_DASHBOARD`, `AUTO_RESIZE_MAX_ROWS` — не используются.
- `LIMITS` (`MAX_POSITIONS`, `MAX_BOMS`) — не используются нигде.
- `SUPPLY_COLOR`, `PRODUCTION_COLOR` — не используются (окраска идёт через `v12PickingRowColor` и `COLORS`).
- `SYSTEM.SCHEMA_VERSION`, `SYSTEM.ENVIRONMENT` — не используются.
- `EVENTS.*` — реально применяются только `POSITION_ADDED`, `POSITION_DELETED`, `QUANTITY_CHANGED`, `RESERVE_CHANGED`, `MATERIAL_CHANGED`, `DEADLINE_CHANGED`. Остальные не пишутся ни в один лист (см. 5.3).
- `FLAGS.*` — применяются только `OVER_ORDERED`, `SHORT_DELIVERY`, `CHANGED`. Остальные в колонку `FLAGS` не попадают.
- `LIFECYCLE_STATE.RETURNED` — не используется (только `ACTIVE`, `ARCHIVED`, `REMOVED`).

### 5.3 Мёртвые / неработающие листы и подсистемы (важно)
- **`EVENT_LOG`** — лист создаётся, но **никогда не пишется** (нет функции-писателя). Вся ветка событий `EVENTS` холостая.
- **`MATERIAL_HISTORY`** — лист создаётся и **читается** (`v12GetPositionHistory` при архивации), но **никогда не пишется**. Поэтому `Archive.HISTORY` всегда `[]` — истории нет.
- **`BOM_REVISION`** — лист создаётся и **читается** (`v12BuildRevisionDateMap` для «Дата создания» в Dashboard и «Дата поставки» в ОТБОРКЕ), но **никогда не пишется**. Значит:
  - колонка «Дата создания» в Dashboard всегда пуста;
  - ветка `v12PickingDeliveryDate` «зарезервировано ≥ требуется → дата создания BOM» **не срабатывает никогда**.
  `v12UpsertSourceBOM` увеличивает `SOURCE_REVISION` в `BOM_REGISTRY`, но запись в `BOM_REVISION` не создаёт. Нужно либо добавить запись ревизии в `v12UpsertSourceBOM`, либо отказаться от листа и хранить «дату создания» в `BOM_REGISTRY`.
---

## 6. Производительность — главные узкие места (с конкретными правками)

На текущих объёмах (десятки–сотни позиций) система успевает, но архитектурно она **тяжело масштабируется** и на заявленных лимитах (`LIMITS.MAX_POSITIONS = 100000`) не запустится.

### P1. Одна правка → полная пересборка всех 5 проекций
**Где**: `v12_trigger.js` (`v12HandleDeficitEdit`, `v12HandleDeficitRangeEdit`, `v12HandlePickingEdit`, `v12HandleWorkingBomEdit`), `v12_operations.js` (`v12SetRealDeliveryQty`), `v12_handoff.js` (`v12MarkReceivedByProduction`, `v12ReturnFromArchive`) — все вызывают `v12RefreshProjections()`.
**Что происходит**: `v12RefreshProjections` = 5 полных пересборок. Каждая делает `v12ClearBody(...)` + `v12WriteRows(...)` по **всем** строкам + переустанавливает чекбоксы на весь столбец + перекрашивает весь диапазон фона.

**Ускорение**: пересобирать только затронутые проекции:
- `ORDERED_QTY`, `EXPECTED_DATE` → DEFICIT (строка) + СНАБЖЕНИЕ + Dashboard;
- `REAL_DELIVERY_QTY` → DEFICIT (удаление строки) + ОТБОРКА + WORKING BOM + СНАБЖЕНИЕ + Dashboard;
- передача производству → ОТБОРКА + WORKING BOM + Dashboard.
Ещё лучше — группировать операции (debounce) и пересобирать агрегаты (СНАБЖЕНИЕ, Dashboard) реже, чем построчные.

### P2. `POSITION_STATE` читается из листа 5–6 раз за один `onEdit`
**Где**: `v12RefreshDeficitSummary`, `v12RefreshPicking`, `v12RefreshWorkingBOM`, `v12RefreshSupply`, `v12AggregateBomStates` (для Dashboard) — каждая вызывает `v12ReadSheet("POSITION_STATE")` → `getDataRange().getValues()`. Плюс `v12HarvestDeficitInput` строит `v12BuildPositionIndex()` — ещё одно полное чтение.

**Ускорение**: читать `POSITION_STATE` **один раз за execution** и прокидывать матрицу параметром во все пересборщики. Почти все функции уже умеют принимать `data`/`index`, но им ничего не передают. Достаточно добавить параметр и один раз прочитать лист в начале `v12RefreshProjections`.

### P3. `v12GetWarehouseQtyForPositionRow` вызывается **на каждую позицию** и каждый раз строит полный индекс MATERIAL_STATE — и результат выбрасывается
**Где**: `v12HandleDeficitRangeEdit`, `v12HarvestDeficitInput`, `v12SetOrderedQty`:
```js
v12ApplyComputedToRow(rowVals, v12GetWarehouseQtyForPositionRow(rowVals, index))
```
`v12GetWarehouseQtyForPositionRow(row, index)` **игнорирует** `index` и вызывает `v12GetWarehouseQty(materialKey)` **без индекса**, а та — `v12BuildMaterialIndex()` → полное чтение `MATERIAL_STATE`. При обработке N строк это **N полных чтений MATERIAL_STATE**. Вдобавок `v12CalculatePositionState` присваивает `const warehouse = toNumber(input.warehouseQty)` и **нигде её не использует**, т.е. весь расчёт склада бесполезен.

**Ускорение (двойное)**: (1) убрать мёртвый вход `warehouseQty` — тогда исчезнет и сам вызов; (2) если он нужен — строить индекс MATERIAL_STATE один раз на execution и передавать его.

### P4. `v12HarvestDeficitInput` читает весь лист сводки и строит индекс позиций на **каждом** пересчёте
`v12RefreshDeficitSummary` всегда начинается с harvest, `v12RefreshDeficitSummaryRow` — тоже. Harvest читает `DEFICIT_SUMMARY` (`getDataRange`), строит `v12BuildPositionIndex()` (полное чтение `POSITION_STATE`) и потенциально пишет в `POSITION_STATE`/`MATERIAL_STATE`.

**Ускорение**: ограничивать harvest реально изменёнными строками (из `e.range`), а не сканировать весь лист; либо выполнять harvest только по time-триггеру. Как минимум не вызывать harvest перед **каждым** точечным обновлением.

### P5. Повторное построение одних и тех же индексов и карт
За один execution многократно строятся: `v12BuildPositionIndex` (POSITION_STATE), `v12BuildMaterialIndex` (MATERIAL_STATE), `v12BuildRevisionDateMap` (BOM_REVISION, читается **дважды** за полный refresh — в ОТБОРКЕ и Dashboard), `v12BuildExcludedMap` (EXCLUDED_BOMS), `v12AggregateReservations` (POSITION_STATE).

**Ускорение**: per-execution-кэш (module-level map с инвалидацией на границах execution). В GAS глобальные переменные живут в пределах одного запуска — этого достаточно. Ключ — имя листа; сброс — в конце `v12OnEdit`/`v12RunFullSync`.

### P6. `v12SyncBOM` строит полный индекс POSITION_STATE **для каждого BOM**
**Где**: `v12RunFullSync` → для каждого файла `v12SyncBOM(source)` → `v12BuildPositionIndex()` + `v12GetPositionsByBom` (проход по всему индексу). При 2 000 BOM это 2 000 полных чтений POSITION_STATE и столько же проходов.

**Ускорение**: построить индекс один раз в `v12RunFullSync` и передавать; сгруппировать записи в POSITION_STATE по всем BOM и сделать один батч. Достаточно одного индекса `Map<bomId, Map<pid, row>>`.

### P7. `v12ApplySourceRevision` пишет каждую изменённую позицию отдельным `batchWrite`
`v12UpdatePosition` (в цикле по изменённым позициям) делает отдельный `batchWrite` на позицию — при массовой синхронизации это сотни/тысячи отдельных записей.
**Ускорение**: накапливать `writes` по всем позициям и делать один `batchWrite`. То же — для `v12AdjustWarehouseQty` (вызов на каждую передачу).

### P8. Форматирование и data validation переустанавливаются при каждом пересчёте
- `v12InstallDeficitCheckboxes` / `v12InstallPickingCheckboxes` / `v12InstallDashboardCheckboxes`: `clearDataValidations()` + `setDataValidation()` на **весь столбец** — 2 тяжёлых операции × 3 листа × каждый refresh.
- `v12ApplyDeficitColors` / `v12ApplyPickingColors`: `setBackgrounds()` на **весь диапазон** — запись форматирования по всем ячейкам на каждый refresh.
- `v12ApplyDashboardColors`: `setConditionalFormatRules()` (перестройка 6 правил) на каждый refresh Dashboard.
- `v12SetupDashboardNotes`: `setNotes()` по всем строкам на каждый refresh.
- `v12InstallPickingBomFilter`: `setDataValidation(requireValueInList([...все проекты...]))` на B1 при **каждом** пересчёте ОТБОРКИ.

**Ускорение**: ставить чекбоксы/условное форматирование/выпадающий список **один раз** (в `v12EnsureAllSheets`/`v12Install`); при изменении числа строк — только расширять диапазон; фон перекрашивать только изменённые строки; учитывать, что `requireValueInList` ограничен ~500 пунктами (при большом числе проектов список может не установиться — рассмотреть фильтр без валидации).

### P9. `SpreadsheetApp.flush()` в горячем пути
`v12SetOrderedQty` / `v12SetExpectedDate` / `v12HarvestDeficitInput` / `v12HandleDeficitRangeEdit` вызывают `SpreadsheetApp.flush()` (иногда дважды за операцию). Flush форсирует завершение всех ожидающих записей и заметно замедляет правку.
**Ускорение**: если проекции считать из in-memory массива (P2), надобность во flush в горячем пути отпадает.

### P10. Прочее
- `v12PickingRowColor`/`v12FormatDateOnly`/`new Date(...)` вызываются по каждой строке — при массовой пересборке считать даты один раз.
- `records.sort(... a.localeCompare(b, "ru"))` — `localeCompare` медленный на больших массивах; предвычислить ключ сортировки (верхний регистр строки).
- `getLastColumn()`/`getLastRow()` — вызывать один раз и запоминать.

### Оценка эффекта
Реализация P1–P3 (пересборка только затронутого + один read на execution + удаление бесполезного чтения склада) сокращает число обращений к SpreadsheetApp на одну правку с **десятков–сотен** до **единиц** — это и есть «существенное ускорение». P8 убирает самые дорогие вызовы записи (форматирование/валидации по всем строкам).

---

## 7. Ошибки логики и конфликты

### B1. `v12UpsertSourceBOM` не возвращает `bomName`/`sourceRevision`, а `v12ApplySourceRevision` их использует
`v12_source.js`:
```js
function v12UpsertSourceBOM(source) { ... return { bomId: bomId, created: false, changed: changed }; }
```
`v12_change_engine.js`:
```js
addedRows.push(v12BuildPositionRow(bomId, mat, pid, registry.sourceRevision, ...)); // undefined
row[P.SOURCE_REVISION - 1] = registry.sourceRevision;   // undefined
changes.SOURCE_REVISION = registry.sourceRevision;      // undefined
```
**Последствия**: при изменении исходного BOM в колонку «Ревизия» пишется `undefined` (для новых строк спасает только `|| 1` в `v12BuildPositionRow`). `registry.bomName` тоже `undefined`, но имя не теряется «по счастливой случайности» (сейчас `bomId === bomName`, а `v12BuildPositionRow` подставляет `|| bomId`). **Латентный дефект**, проявится при первой реальной синхронизации; локальные тесты этот путь не покрывают.
**Исправление**: `v12UpsertSourceBOM` должен возвращать `sourceRevision` и `bomName` (взять из `reg.values` после upsert).

### B2. Dashboard-статус «Ожидание поставки (опаздывает)» недостижим
`v12AggregateBomStates` инкрементирует `notOrdered`, `partial`, `onTime`, но **никогда** — `late`. В `v12ComputeBomStatus`:
```js
if (agg.late > 0) return BS.WAITING_LATE;   // недостижимо
...
return BS.WAITING_ON_TIME;                  // сюда попадают и "late"-случаи
```
**Последствия**: статус «Ожидание поставки (опаздывает)» и его цветовое правило — мёртвые; опаздывающие BOM ошибочно показываются как «в срок». Решение К2 реализовано не до конца.
**Исправление**: в агрегации сравнивать `expected ≤ deadline` per-позиция и инкрементировать `late`/`onTime` по факту.

### B3. Вход `warehouseQty` расчётного движка не используется
`v12CalculatePositionState` объявляет `const warehouse = toNumber(input.warehouseQty)` и не использует. Следствия: физический склад (`MATERIAL_STATE.WAREHOUSE_QTY`) **никак не влияет** на `supplyState`/`productionState`/`deficitQty`; вся ветка `v12GetWarehouseQty`/`v12GetWarehouseQtyForPositionRow`/`v12AdjustWarehouseQty` нужна лишь для контроля `MATERIAL_STATE`, но не для решений по позиции. См. также P3 — это причина лишней массовой нагрузки.

### B4. Контроль `reserved ≤ warehouse` (ТЗ №30) вычисляется, но его результат выбрасывается
`v12RecalculateWarehouseConsistency()` возвращает список несоответствий, но в `v12RunFullSync` вызывается без использования:
```js
v12RecalculateWarehouseConsistency();   // результат игнорируется
v12RefreshAllProjections();
```
Флаг `FLAGS.RESERVATION_PHYSICAL_INCONSISTENCY` **никогда** ни одной строке не присваивается — требование ТЗ №30 фактически не выполнено (есть только побочный пересчёт `RESERVED_QTY`/`FREE_QTY` в `MATERIAL_STATE`).
**Исправление**: проставлять флаг позициям, либо писать несоответствия в журнал/лист, либо выдавать алерт по итогам синхронизации.

### B5. Передача из WORKING BOM неработоспособна
`WORKING_BOM_COLUMNS.PRODUCTION_STATE` = 13 — это **текстовый статус** («На складе»/«Передано»), не чекбокс. Обработчик:
```js
function v12HandleWorkingBomEdit(e) {
  if (column !== W.PRODUCTION_STATE) { ...revert...; return; }
  ...
  if (v12IsChecked(checked)) v12MarkReceivedByProduction(positionId, SOURCE_UI.WORKING_BOM);
}
```
`v12IsChecked("На складе")` → `false`, реального чекбокса в WORKING BOM нет. Значит передача из WORKING BOM **никогда** не срабатывает; `SOURCE_UI.WORKING_BOM`, действие `WORKING_BOM_CHECKBOX` и роль `PRODUCTION` для этого пути — мёртвый код. Плюс лист целиком пересобирается на каждом refresh — правки всё равно затираются.
**Исправление**: либо добавить настоящий столбец-чекбокс, либо удалить `v12HandleWorkingBomEdit` и ветку WORKING_BOM из `v12OnEdit`.

### B6. Статусный словарь раздваивается (регистр)
Статусы сводки выводятся в `v12DeficitStatusDisplay` как `"Ожидание поставки (в Срок)"` (заглавная «С»), а статусы Dashboard (`V12_CONFIG.BOM_STATUS`) — как `"Ожидание поставки (в срок)"` (строчная «с»). Сверки (`v12ApplyDeficitColors`, `v12ApplyDeficitColorForRow`, `whenTextContains`) привязаны к этим строкам. Правка строки в одном месте сломает сверку в другом.
**Рекомендация**: единый enum статусов и единый билдер подписи.

### B7. «Реальная поставка» из сводки — только полная
Чекбокс в сводке (`v12HandleDeficitEdit`, `v12HandleDeficitRangeEdit`, `v12HarvestDeficitInput`) при отметке ставит `REAL_DELIVERY_QTY = required` и при снятии `0`. Частичная поставка через сводку **невозможна**, хотя статус `PARTIALLY_DELIVERED` и флаг `SHORT_DELIVERY` существуют; частичная поставка доступна только программно (`v12SetRealDeliveryQty(positionId, qty)`), но в UI поля количества нет — только чекбокс.
**Рекомендация**: добавить колонку «Поставлено (кол-во)» либо задокументировать, что сводка фиксирует только полную поставку.

### B8. `v12Diagnostic` и `v12ConsistencyCheck` ничего не показывают
Обе формируют и `return` отчёт, но **не вызывают** `SpreadsheetApp.getUi().alert(...)`. Return-значение функции из меню в GAS нигде не отображается — пункты меню «Диагностика V12» и «Проверка консистентности» выглядят как «ничего не произошло».
**Исправление**: выводить результат через `alert`/`toast` (как в `v12RunDebug`).

### B9. Работа под блокировкой и риск таймаутов
`v12OnEdit` держит `acquireScriptLock()` на всё время обработки, включая полную пересборку 5 проекций (P1). `LOCK_TIMEOUT = 30000`. Если правка превышает 30 c (на реальных объёмах превысит), следующая не дождётся блокировки; исключение ловится `try/catch` и **логируется молча** — правка теряется без обратной связи.
**Исправление**: сократить объём работы под блокировкой (P1/P8) и/или показывать `alert` при неудачном захвате.

### B10. `v12RevertEdit` не восстанавливает диапазонные правки
`v12RevertEdit` использует `e.oldValue`, которое задано только для одиночной ячейки. Для диапазонной запрещённой правки откат не произойдёт.

### B11. Асимметрия обработки строки заголовка в ОТБОРКЕ
В `v12HandlePickingRangeEdit` есть guard `if (firstRow + r === 1) continue;`, а в `v12HandlePickingEdit` — нет (там защищает проверка по колонке `CHECKBOX`; заголовок кол. 12 не является чекбоксом). Сейчас безопасно, но асимметрия опасна при будущих изменениях.

### B12. Дублирующиеся пункты меню
`v12OnOpen` вешает **два** пункта на одну функцию `v12RunFullSync`: «🔄 Полная синхронизация» и «📥 Импорт BOM (источник)». Избыточно.

### B13. Диапазонная правка сводки без права не откатывается
`v12HandleDeficitRangeEdit` при отсутствии права (`canOrdered/canExpected/canDelivery`) просто игнорирует изменение — ячейка на листе остаётся изменённой и позже перезаписывается проекцией (визуально «мигнёт»), в отличие от ОТБОРКИ, где чекбокс снимается явно.
---

## 8. Инварианты и скрытые допущения

1. **`positionId` стабилен**: `bomId:materialKey`. Переименование BOM = новый BOM (новые positionId). Так как `materialKey` строится по `code`, **изменение кода** материала создаёт новую позицию, а старая уходит в `POSITION_DELETED` (REMOVED).
2. **`SOURCE_REVISION`** увеличивается только при смене хэша материалов источника (`v12HashSourceData` по JSON). Порядок строк стабилизируется `materials.sort`.
3. **`availableForProduction = reserved + realDelivery`** (К1) — это НЕ «склад минус резерв». Склад (`MATERIAL_STATE`) в расчётах не участвует (B3).
4. **Передача производству идемпотентна** и **списывает `required`** со склада (`Math.max(0, ...)` — не уйдёт в минус). Повторная передача не удваивает списание.
5. **Схема меняется только через конфиг + миграции** (`v12MigratePickingSchema`, `v12MigratePositionSchema`); данные строк не мигрируются, кроме удаления колонок.
6. **`_lockDepth`** делает ScriptLock реентрантным в пределах execution — вложенные операции не блокируются, но и не сериализуются сверх внешнего захвата.
7. **`V12_ROLE_MAP` пуст** (`v12_roles.js`) → RBAC фактически **отключён**, все = ADMIN (`v12GetCurrentUserRole`). Все проверки прав сейчас — no-op. Заполнить перед продакшеном.
8. **`claspignore`** исключает `_local_tests/` — Node-тесты (`require`/`vm`) не попадают в GAS.
9. **`getSheetByName` использует `SpreadsheetApp.getActive()`** — скрипт предполагает привязку к таблице.
10. **Совместное редактирование** защищено только ScriptLock; harvest-механизмы — единственная страховка от потери правок.

---

## 9. План устранения (приоритизированный, для Act Mode)

### Этап 1 — Производительность (наибольший эффект)
1. Читать `POSITION_STATE` один раз за execution и прокидывать матрицу во все `v12Refresh*` (P2, P5). Выполнить
2. Пересобирать только затронутые проекции (P1). Выполнить
3. Убрать мёртвый `warehouseQty` из расчёта и массовые вызовы `v12GetWarehouseQtyForPositionRow` (P3, B3). Выполнить
4. Вынести установку чекбоксов/условного форматирования/цветов из горячего пути (P8).Выполнить
5. `v12RunFullSync`: один индекс на проход, один батч записи (P6, P7). Выполнить
6. Убрать лишние `flush()` (P9). Выполнить

### Этап 2 — Логика
7. Починить возврат `sourceRevision`/`bomName` из `v12UpsertSourceBOM` (B1). Выполнить
8. Реализовать `late`/`onTime` в агрегации Dashboard или убрать недостижимую ветку (B2). Выполнить
9. Определиться с WORKING BOM: чекбокс или удаление мёртвой ветки (B5). Чекбокс
10. Писать `BOM_REVISION`/`MATERIAL_HISTORY` либо удалить мёртвые подсистемы (5.3). Пишем
11. Проставлять `RESERVATION_PHYSICAL_INCONSISTENCY` или логировать несоответствия (B4). 
12. Показывать результат `v12Diagnostic`/`v12ConsistencyCheck` (B8). Выполнить
13. Унифицировать статусный словарь сводки/Dashboard (B6). Приведи в соотсветствие

### Этап 3 — Чистка
14. Удалить неиспользуемые функции (5.1) и конфиг (5.2). Выполнить
15. Убрать дублирующий пункт меню (B12). Выполнить
16. Заполнить `V12_ROLE_MAP` (инвариант 7).

---

## 10. Что не проверено и требует прогона в Google Apps Script
- `v12RunFullSync` целиком: `v12UpsertSourceBOM` → `v12DetectBOMChanges` → `v12ApplySourceRevision` (там сидит B1). Локальные тесты этот путь не покрывают.
- Реальный размер листов: поведение `getDataRange()`, `requireValueInList` (P8), лимит времени 6 мин на `v12RunFullSync`.
- `onEdit` для чекбоксов в реальной локали (страховка `v12IsChecked` покрывает `true/1/yes/истина/да`).
- Совместная работа нескольких пользователей под ScriptLock (B9).

---

## 11. Модульный справочник (одной строкой на файл)

| Файл | Назначение |
|------|-----------|
| `v12_config.js` | Единый конфиг: листы, колонки, заголовки, статусы, роли, цвета, события, решения К1–К7 |
| `v12_source.js` | Чтение исходных BOM из Drive (read-only), hash, upsert в BOM_REGISTRY, карта исключённых |
| `v12_sheet_service.js` | Доступ к листам V12, индексы (position/material/registry), миграции схем, точечные записи |
| `v12_position_state.js` | Построение новой строки POSITION_STATE и применение вычислений в строку |
| `v12_calculate.js` | Чистый расчётный движок: дефицит/непокрытие/перезаказ/недопоставка/available/supply+production state |
| `v12_change_engine.js` | Сопоставление источника с позициями, ChangeSet, применение ревизии, `v12SyncBOM` |
| `v12_material_state.js` | Физический склад: остаток, агрегация резервов, контроль `reserved ≤ warehouse` |
| `v12_operations.js` | Операции снабжения: `v12SetOrderedQty`, `v12SetExpectedDate`, `v12SetRealDeliveryQty` |
| `v12_projections.js` | 5 проекций, harvest-страховки, статусы/окраска, инкрементальное обновление строки сводки |
| `v12_handoff.js` | `v12MarkReceivedByProduction` (идемпотентно) + `v12ReturnFromArchive` + корректировка склада |
| `v12_roles.js` | RBAC: `V12_ROLE_MAP`, `v12GetCurrentUserRole`, `v12CanEditField`, `v12RequireRole` |
| `v12_audit.js` | Буферизованный `v12Audit` + `v12FlushAudit` в AUDIT_LOG |
| `v12_trigger.js` | `v12OnEdit`-роутер, обработчики правок листов, `v12InstallTriggers`, `v12RunFullSync`, `v12ScheduledUpdate` |
| `v12_controller.js` | Меню `v12OnOpen`, `v12Install`, `v12Diagnostic`, `v12ConsistencyCheck`, self-тест `v12RunDebug` |
| `sheet_service.js` | Generic-обёртки: `getSheetByName`, `readSheetValues`, `writeValues`, `clearBody`, `appendRow`, `ensureSheet`, `batchWrite` |
| `utils.js` | `toNumber`, `normalizeMaterialId`, `generateEventId`, `getCurrentUser`, даты |
| `utils.js`/`v12_utils.js` | `v12ToDate`/`v12DateValue` — устойчивый парсинг дат (серийные номера Sheets, dd.MM.yyyy, ISO) |
| `logger.js` | Буферизованный `logSystem`/`flushSystemLog` в SYSTEM_LOG |
| `lock.js` | Реентрантный `acquireScriptLock` |
| `_local_tests/v12_delivery_test.js` | Локальные тесты цепочки «Реальная поставка» (9 сценариев) |
| `_local_tests/v12_picking_schema_test.js` | Локальные тесты схемы/миграции/окраски ОТБОРКИ |

---

## 12. Рекомендуемый порядок чтения для нового разработчика
1. `v12_config.js` — понять сущности, номера колонок, статусы (это «схема БД»).
2. `v12_calculate.js` — ядро логики (чистая функция), понять 8 количеств и К1/К3.
3. `v12_position_state.js` — как строка состояния собирается и пересчитывается.
4. `v12_trigger.js` — как правки пользователя доходят до состояния и проекций (главный «контроллер»).
5. `v12_projections.js` — как состояние превращается в 5 представлений (и где узкие места).
6. `v12_change_engine.js` + `v12_source.js` — обновление источника и что здесь сломано (B1).
7. `v12_handoff.js` — единственная «операция-переход» с идемпотентностью и архивом.

---

## 13. Резюме
- Архитектурная идея (**SOURCE ≠ STATE ≠ VIEW**, чистый расчётный движок, центральное `POSITION_STATE`, буферизованные журналы, реентрантный lock) — **хорошая**, её стоит сохранить.
- **Производительность** — главная проблема: один edit вызывает полную пересборку 5 проекций с многократным чтением `POSITION_STATE` и рисками по `MATERIAL_STATE`. Ключевые правки — P1–P3 и P8; они дают основной прирост (с десятков–сотен обращений к SpreadsheetApp на правку до единиц).
- **Логика**: подтверждён латентный баг синхронизации (B1), недостижимый Dashboard-статус (B2), мёртвый вход склада (B3), неработающий контроль ТЗ №30 (B4), нерабочая передача из WORKING BOM (B5), регистровая ловушка статусов (B6).
- **Мёртвый код**: ~14 неиспользуемых функций, ~8 групп неиспользуемого конфига, 3 листа-подсистемы без писателя (`EVENT_LOG`, `MATERIAL_HISTORY`, `BOM_REVISION`).
- **Недостающее**: RBAC не активирован (пустой `V12_ROLE_MAP`), UI не поддерживает частичную поставку, диагностика не показывает результат.
