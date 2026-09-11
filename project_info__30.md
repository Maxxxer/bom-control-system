# BOM CONTROL SYSTEM V12 — Полный аудит кода и производительности

> Отчёт №30. Проведён сплошной аудит всех 18 загружаемых файлов (`*.js` в корне проекта) + 2 локальных Node-теста. Цель: ускорение, удаление мёртвого кода, выявление конфликтов и логических ошибок, предложения по устранению.

---

## Summary

Проект — **Google Apps Script add-on** для управления BOM (Bill of Materials) на производстве: единая книга-Google-таблица, которая читает исходные BOM из папки Drive (read-only), строит центральное операционное состояние `POSITION_STATE` и генерирует набор проекций (Сводка дефицитов, ОТБОРКА, WORKING BOM, СНАБЖЕНИЕ, Dashboard). Пользователи (снабжение, кладовщик, производство) правят проекции вручную; система пересчитывает состояния и складские остатки.

Архитектурный принцип: **SOURCE ≠ STATE ≠ VIEW**. Исходный BOM — единственный источник потребности; `POSITION_STATE` — центральное состояние; проекции — только представления, пересобираемые из состояния.

Система функционально полная, но содержит **значительный объём мёртвого кода**, **дублирующие тяжёлые чтения листов** (главный тормоз), **две реальные функциональные ошибки** (WORKING BOM-чекбокс, никогда не заполняемый `BOM_REVISION`) и **несколько конфликтов логики** между проекциями и обработчиками.

---

## Architecture

**Паттерн**: слоистая односторонняя архитектура + event-driven (onEdit / time-driven triggers), «состояние-центричная».

```
Drive (исходные BOM, read-only)
        │  v12ListSourceBOMFiles / v12ReadSourceBOM / v12ParseSourceRows
        ▼
  v12_change_engine (detect → ChangeSet → applySourceRevision)
        │
        ▼
  BOM_REGISTRY ──► POSITION_STATE  ◄── MATERIAL_STATE (физ. склад)
   (реестр)          (ядро, 31 кол.)        (9 кол.)
        │                  │
        │                  ├── v12_calculate (чистый движок: 8 количеств, supply/production state, flags)
        │                  │
        ▼                  ▼
   PROJECTIONS: DEFICIT_SUMMARY · ОТБОРКА · WORKING BOM · СНАБЖЕНИЕ · DASHBOARD
                       ▲
        onEdit-триггер (v12_trigger) ──► операции v12_operations / v12_handoff
```

**Технологии**: Google Apps Script, runtime V8 (`appsscript.json`), Google Sheets API (через `SpreadsheetApp`), Drive API, LockService, PropertiesService. Деплой — `clasp` (`scriptId` задан). Никаких внешних зависимостей/сборки нет: все функции — **глобальные**, порядок загрузки неявный (единственный namespace — глобальная область).

**Старт исполнения**:
1. `onOpen()` (`v12_controller.js`) — простой триггер → `v12OnOpen()` строит меню `BOM CONTROL V12`.
2. `v12Install()` — создаёт листы, снимает старые триггеры, ставит `v12OnEdit` (onEdit) и `v12ScheduledUpdate` (каждый час).
3. `v12OnEdit(e)` — центральный диспетчер всех правок.
4. `v12RunFullSync()` — чтение Drive → синхронизация → пересчёт `MATERIAL_STATE` → пересборка всех проекций.

**Время выполнения как инвариант**: Apps Script ограничивает исполнение 6 мин (потребительский триггер — 30 c для простых, 6 мин для installable). Текущий дизайн на каждом onEdit делает 5+ полных проходов по `POSITION_STATE` — это главный риск.

---

## Directory Structure

```
BOM_CONTROL_SYSTEM/
├── appsscript.json              — манифест (scopes, webapp, V8)
├── .clasp.json                  — clasp: rootDir="", scriptExtensions [".js",".gs"]
├── .claspignore                 — исключает _local_tests/**, node_modules/**, .git/**
│
│  ── Инфраструктура (generic, но зависит от V12_CONFIG) ──
├── lock.js                      — acquireScriptLock() (реентрантный ScriptLock)
├── logger.js                    — logSystem()/flushSystemLog() (буфер → SYSTEM_LOG)
├── sheet_service.js             — обёртки SpreadsheetApp: read/write/clear/batch/ensure
├── utils.js                     — toNumber, normalizeMaterialId, generateEventId, getCurrentUser
│
│  ── Конфиг ──
├── v12_config.js                — V12_CONFIG (листы, 15 наборов колонок, статусы, роли, цвета, К1–К7)
│
│  ── Ядро V12 ──
├── v12_source.js                — чтение исходных BOM из Drive + BOM_REGISTRY (upsert)
├── v12_change_engine.js         — детект изменений источника → ChangeSet → применение ревизии
├── v12_calculate.js             — ЧИСТЫЙ движок расчёта (8 количеств, supply/production state)
├── v12_position_state.js        — построение/применение строк POSITION_STATE
├── v12_material_state.js        — MATERIAL_STATE, агрегация резервов, контроль №30
├── v12_sheet_service.js         — доступ к листам V12, индексы (position/bom/material), v12UpdatePosition
├── v12_operations.js            — заказ / ожидаемая дата / реальная поставка
├── v12_handoff.js               — передача производству + возврат из архива + архив
├── v12_projections.js           — ВСЕ проекции (Сводка, ОТБОРКА, WORKING BOM, СНАБЖЕНИЕ, Dashboard)
├── v12_roles.js                 — RBAC (карта email→роль + права по полям)
├── v12_audit.js                 — AUDIT_LOG (буфер)
├── v12_trigger.js               — v12OnEdit, обработчики, v12ScheduledUpdate, v12RunFullSync
├── v12_controller.js            — меню, install, диагностика, консистентность, self-тест
├── v12_utils.js                 — materialKey (К5), positionId, валидация №8, нормализация дат
│
├── _local_tests/                — Node-тесты (vm + моки Sheets), НЕ выгружаются
│   ├── v12_delivery_test.js         — «Реальная поставка» (9 сценариев S1–S9)
│   └── v12_picking_schema_test.js   — схема ОТБОРКИ, миграции, фильтр, окраска
│
├── task_progress.md             — чек-лист разработки V12
└── project_info__1..30.md       — отчёты исследовательских сессий (артефакты, не код)
```

---

## Key Abstractions

### V12_CONFIG (`v12_config.js`)
- **Ответственность**: единственный источник правды — имена листов, **позиции всех колонок по 15 листам**, канонические заголовки, состояния (`SUPPLY_STATE`, `PRODUCTION_STATE`, `LIFECYCLE_STATE`, `BOM_STATUS`), роли, палитра, действия аудита, а также фиксация решений по конфликтам ТЗ (К1–К7).
- **Ключевые константы**: `POSITION_COLUMNS` (31), `COLUMN_COUNT.POSITION_STATE = 31`, `PICKING_COLUMNS` (12), `WORKING_BOM_COLUMNS` (15), `DEFICIT_COLUMNS` (14).
- **Используется**: буквально всеми модулями.

### v12CalculatePositionState (`v12_calculate.js`)
- **Ответственность**: **чистая** функция (без I/O) — валидация + расчёт всех канонических количеств, `supplyState`, `productionState`, `flags`.
- **Интерфейс**: принимает `{ requiredQty, reservedQty, orderedQty, realDeliveryQty, expectedDate, deadline, receivedByProduction, receivedByProductionQty, warehouseQty, row }`, возвращает `{ deficitQty, uncoveredNeed, overOrderedQty, shortDeliveryQty, availableForProduction, readyForHandoff, supplyState, productionState, flags, valid, missing }`.
- **ВАЖНО (аудит)**: параметры `warehouseQty`, `expectedDate`, `deadline`, `receivedByProductionQty` **не используются в теле функции** — «мёртвые» входы (см. раздел «Проблемы»).

### POSITION_STATE + v12UpdatePosition / v12ApplyComputedToRow
- **Ответственность**: центральное состояние. `v12BuildPositionRow` создаёт строку, `v12ApplyComputedToRow` пересчитывает производные колонки, `v12UpdatePosition` пишет изменения батчем + `UPDATED_AT`.
- **Индексы**: `v12BuildPositionIndex` → `Map<positionId,{row,values}>`; аналогично `v12BuildBomRegistryIndex`, `v12BuildMaterialIndex`.

### Проекции (`v12_projections.js`)
- **Ответственность**: пересобрать 5 листов-представлений из `POSITION_STATE`.
- **Дублирующие entry-points**: `v12RefreshAllProjections()` и `v12RefreshProjections()` **идентичны по телу** — обе пересобирают всё.
- **«Harvest»-страховки**: `v12HarvestDeficitInput()` и `v12HarvestPickingInput()` — перед перезаписью проекции подбирают ещё не обработанные правки из листа (защита от пропущенных onEdit при быстром вводе). Это источник самых дорогих повторных чтений.

### v12MarkReceivedByProduction (`v12_handoff.js`)
- **Ответственность**: идемпотентная передача позиции производству. Статусы `handoff | already | blocked`. Внутри: проверка роли → валидация → проверка доступности → `v12UpdatePosition` → `v12ArchivePosition` → `v12AdjustWarehouseQty(-required)` → аудит.
- **Флаг `skipRefresh`**: при массовой передаче проекции не пересчитываются (делает вызывающий).

### v12OnEdit (`v12_trigger.js`)
- **Ответственность**: центральный диспетчер. Ранний выход для не-actionable листов **до** захвата блокировки; захват реентрантного `ScriptLock`; маршрутизация по листу/колонке; поддержка диапазонов для Сводки и ОТБОРКИ.

---

## Data Flow

### A. Полная синхронизация (`v12RunFullSync`, меню / час)
1. `acquireScriptLock()` + `v12SetBusy(true)`.
2. `v12ListSourceBOMFiles()` → `DriveApp.getFolderById` → фильтр MIME → вычитание `EXCLUDED_BOMS` (`v12BuildExcludedMap`).
3. Для каждого файла: `v12ReadSourceBOM` → `v12ParseSourceRows` (поиск заголовков `v12FindHeader`).
4. `v12SyncBOM(source)` → `v12UpsertSourceBOM` (hash MD5 → `SOURCE_REVISION++`) → `v12DetectBOMChanges` → при изменениях `v12ApplySourceRevision`.
5. `v12RecalculateWarehouseConsistency()` → пересчёт `RESERVED_QTY`/`FREE_QTY` в `MATERIAL_STATE`.
6. `v12RefreshAllProjections()` → 5 листов.

### B. Правка «Заказано» в Сводке дефицитов (onEdit)
1. `v12OnEdit` → лист `DEFICIT_SUMMARY`, колонка 9 → `v12HandleDeficitEdit`.
2. `v12SetOrderedQty(positionId, value)` → RBAC → `v12BuildPositionIndex()` → `v12UpdatePosition(...)` → `v12Audit`.
3. `SpreadsheetApp.flush()` → `v12RefreshDeficitSummaryRow(positionId,"ORDERED_QTY")` → `v12HarvestDeficitInput(...)` (читает лист сводки + `POSITION_STATE` + строит индекс).
4. Если `EXPECTED_DATE` уже задана → `v12RefreshSupply()` + `v12RefreshDashboard()`.
5. `finally`: `lock.releaseLock()`, `v12FlushAudit()`.

### C. Передача производству из ОТБОРКИ (одиночная)
1. `v12OnEdit` → лист `PICKING`, колонка 12 → `v12HandlePickingEdit` → `v12MarkReceivedByProduction(pid, "PICKING")`.
2. Успех → позиция архивируется (`ARCHIVE` + `LIFECYCLE_STATE=ARCHIVED`), склад `-= required`, `v12RefreshProjections()` (полная пересборка всего).
3. Отказ (`blocked`) → `v12RevertEdit` + alert.

### D. Массовая передача (диапазон чекбоксов)
1. `v12HandlePickingRangeEdit` → для каждой отмеченной строки `v12MarkReceivedByProduction(pid, "PICKING", /*skipRefresh*/=true)`.
2. Один `v12RefreshProjections()` в конце.

### E. Реальная поставка (чекбокс в Сводке)
1. `v12HandleDeficitEdit` → кол. 12 → `v12SetRealDeliveryQty(pid, required|0)`.
2. `delta = new − old` → `v12AdjustWarehouseQty(materialKey, delta)` → `v12RefreshProjections()`.

---

# РЕЗУЛЬТАТЫ АУДИТА

## 1. ПРОИЗВОДИТЕЛЬНОСТЬ — главные тормоза

### P1. `POSITION_STATE` читается 6–8 раз за один пересчёт проекций ⚠ КРИТИЧНО
Каждая из `v12RefreshDeficitSummary`, `v12RefreshPicking`, `v12RefreshWorkingBOM`, `v12RefreshSupply`, `v12RefreshDashboard` **самостоятельно** вызывает `v12ReadSheet("POSITION_STATE")`. Плюс `v12RefreshDashboard` дополнительно вызывает `v12AggregateBomStates()` (ещё одно чтение) и `v12BuildRevisionDateMap()` (BOM_REVISION), а `v12RefreshPicking` — тоже `v12BuildRevisionDateMap()`. Итого **один пересчёт ≈ 6–7 полных чтений `POSITION_STATE` + 2 чтения `BOM_REVISION` + 1 `EXCLUDED_BOMS` + 1 `MATERIAL_STATE`**, причём `SpreadsheetApp.getActive().getSheetByName()` вызывается десятки раз.

**Устранение**: читать `POSITION_STATE` один раз в `v12RefreshAllProjections` и передавать массив во все билдеры (`v12RefreshDeficitSummary(data)`, `v12RefreshPicking(data)`, …). Кэшировать объект листа и индексы (`MATERIAL_STATE`, `EXCLUDED_BOMS`, `BOM_REVISION`) в пределах одного вызова. Ожидаемый эффект — снижение числа API-вызовов чтения в ~7 раз.

### P2. `v12GetWarehouseQtyForPositionRow` строит индекс `MATERIAL_STATE` на каждый вызов ⚠ КРИТИЧНО
Функция игнорирует переданный `index` и вызывает `v12GetWarehouseQty(materialKey)`, которая при отсутствии индекса строит **весь** индекс `MATERIAL_STATE` (`v12BuildMaterialIndex()`). Вызывается в цикле по строкам в `v12HarvestDeficitInput`, `v12SetRealDeliveryQty`, `v12HandleDeficitRangeEdit` → фактически **O(N²)** обращений к листу склада.

**Ещё важнее**: результат этой функции **не влияет на расчёт** — `v12CalculatePositionState` игнорирует `warehouseQty` (см. «Мёртвый код»). То есть это чистая потеря времени.

**Устранение**: (а) убрать `warehouseQty` из расчёта и из `v12ApplyComputedToRow` (или передавать уже загруженную карту склада), (б) заменить цикл на один проход с готовым индексом `MATERIAL_STATE`.

### P3. Полная очистка + перезапись всех проекций на каждую одиночную правку ⚠ ВЫСОКО
`v12RefreshProjections()` (идентична `v12RefreshAllProjections`) вызывается после **любой** одиночной операции (`v12SetRealDeliveryQty`, `v12MarkReceivedByProduction` без `skipRefresh`, `v12ReturnFromArchive`) и внутри `v12HandleDeficitRangeEdit`. При этом `v12ClearBody` + `v12WriteRows` проходят по всем 31 колонке и всем строкам всех 5 листов.

**Устранение**: включить заявленные в ТЗ (К7) **dirty-флаги** — пересобирать только затронутые проекции; для одиночных операций писать точечно (в проектах уже есть `v12RefreshDeficitSummaryRow` — распространить подход). Для массовых — батчить.

### P4. Двойной полный проход «harvest» на каждое обновление проекции ⚠ ВЫСОКО
`v12RefreshDeficitSummary` начинается с `v12HarvestDeficitInput()` (чтение листа сводки + `POSITION_STATE` + новый индекс позиций). `v12RefreshPicking` — с `v12HarvestPickingInput()` (чтение листа ОТБОРКИ + вызовы `v12MarkReceivedByProduction`, каждый из которых **снова строит индекс позиций и склада**, снова берёт лок и ходит в листы). При массовой передаче это O(N) перестроений индексов и O(N) `appendRow`/`batchWrite`.

**Устранение**: (а) передавать в `skipRefresh=true`-ветку уже построенные индексы (не пересобирать); (б) хранить «последний обработанный» штамп либо использовать `PropertiesService`/скрытую колонку вместо полного ре-сканирования листа; (в) в `v12HarvestPickingInput` собрать все `positionId` и обработать одним проходом.

### P5. `SpreadsheetApp.flush()` вызывается многократно и синхронно
`flush()` встречается в `v12SetOrderedQty`, `v12SetExpectedDate`, `v12HarvestDeficitInput`, `v12HarvestPickingInput`, `v12HandleDeficitRangeEdit`. Каждый `flush()` вынуждает немедленную синхронизацию с Sheets — дорого.

**Устранение**: один `flush()` в конце операции (в `finally`), либо вообще без `flush()` (Apps Script сам сбросит изменения при записи из скрипта).

### P6. Полная синхронизация: индекс читается на каждый BOM, реестр — на каждый BOM ⚠ ВЫСОКО
`v12SyncBOM` вызывает `v12BuildPositionIndex()` (полное чтение `POSITION_STATE`) **для каждого файла** в цикле `v12RunFullSync`; `v12UpsertSourceBOM` вызывает `v12BuildBomRegistryIndex()` при каждом файле. При сотнях/тысячах BOM это тысячи полных чтений.

**Устранение**: построить индексы один раз перед циклом и передавать их в `v12SyncBOM`/`v12UpsertSourceBOM`; писать все новые позиции/обновления реестра **одним батчем** в конце синхронизации.

### P7. Пересоздание data-validation и conditional-formatting правил на каждую пересборку
`v12InstallPickingCheckboxes`/`v12InstallDeficitCheckboxes`/`v12InstallDashboardCheckboxes` делают `clearDataValidations()`+`setDataValidation()`; `v12ApplyDashboardColors()` вызывает `setConditionalFormatRules()` (дорогая операция уровня листа); `v12InstallPickingBomFilter` — `clearDataValidations()`+`setDataValidation()`+`getValue()`.

**Устранение**: устанавливать валидации/форматирование **только при изменении состава строк** (dirty-флаг или сравнение числа строк), а не при каждом пересчёте.

### P8. Блокировка ожиданием 30 с (`waitLock`)
`acquireScriptLock()` использует `lock.waitLock(30000)`. При частых онEdit однотипные правки выстраиваются в очередь и могут упираться в лимит исполнения.

**Устранение**: `tryLock(0)` + быстрый выход (правку подберёт следующий пересчёт / `v12ScheduledUpdate`) — сейчас же поток ждёт. Либо уменьшить таймаут и перенести тяжёлые пересчёты в `PropertiesService`-очередь, обрабатываемую time-driven триггером.

### P9. `appendRow` в циклах
`v12RecalculateWarehouseConsistency`, `v12AdjustWarehouseQty`, `v12UpsertSourceBOM`, `v12ArchivePosition`, `v12GetPositionHistory`-поток используют `appendRow` (по одному вызову API). В массовых операциях — десятки/сотни вызовов.

**Устранение**: накапливать строки и писать одним `setValues` (как уже сделано в `v12FlushAudit`/`flushSystemLog`).

### P10. Поиск по заголовкам O(H·C) на каждый BOM
`v12FindHeader` делает `indexOf` и полный `map(v12Norm)` по заголовкам — незначительно, но в связке с P6 складывается.

---

## 2. МЁРТВЫЙ КОД И НЕИСПОЛЬЗУЕМЫЕ ФУНКЦИИ

### 2.1 Функции, определённые, но нигде не вызываемые (безопасно удалить)
| Функция | Файл | Комментарий |
|---|---|---|
| `v12IsReadyForHandoff(position)` | v12_calculate.js | обёртка, нигде не используется |
| `v12IsReservationPhysicalInconsistent(t,w)` | v12_calculate.js | логика продублирована инлайн в `v12RecalculateWarehouseConsistency` |
| `v12BuildPositionStableKey(row)` | v12_utils.js | не используется (positionId строится из `materialKey`) |
| `v12BuildWarehouseMap(data)` | v12_material_state.js | нигде не читается |
| `v12SupplyStatusDisplay(state,val)` | v12_projections.js | Сводка использует свой `v12DeficitStatusDisplay` |
| `v12IsActivePosition(row)` | v12_position_state.js | фильтры «архив/удалён» продублированы инлайн во всех проекциях |
| `v12RoleLabel(role)` | v12_roles.js | нет UI, показывающего человекочитаемую роль |
| `v12AppendRows(key, rows)` | v12_sheet_service.js | не используется (есть `appendRow`/`writeValues`) |
| `v12IsBusy()` | v12_trigger.js | `v12SetBusy` пишет `V12_RECALCULATING`, но **никто не читает** — механизм «занятости» мёртв |
| `warehouseFor(positionId, index)` | v12_change_engine.js | всегда возвращает `0`, параметры игнорируются — фиктивная функция |

### 2.2 Мёртвые параметры в «живых» функциях
- `v12CalculatePositionState`: входы **`warehouseQty`, `expectedDate`, `deadline`, `receivedByProductionQty`** не используются в теле → производные вычисления (`v12ApplyComputedToRow`) передают их зря, что тянет за собой дорогие чтения склада (см. P2).
- `v12ApplyComputedToRow(row, warehouseQty)` — второй параметр не влияет ни на что.
- `v12Audit`: `const A = V12_CONFIG.AUDIT_COLUMNS;` — объявлена и не используется.
- `v12ConsistencyCheck`: `report.archivedPositionIds.forEach(...)` — тело пустое (no-op); `Set` собирается зря.
- `v12HandleDeficitRangeEdit`: `const M = V12_CONFIG.MATERIAL_COLUMNS;` используется, но блок применения складских дельт дублирует `v12HarvestDeficitInput` почти дословно (дублирование ~40 строк).

### 2.3 Листы-призраки (создаются, но никогда не заполняются)
- **`EVENT_LOG`** — создаётся в `v12EnsureAllSheets`, объявлен в конфиге, но **ни одна функция не пишет в него**. `V12_CONFIG.EVENTS` используется только как строковые типы внутри ChangeSet.
- **`MATERIAL_HISTORY`** — только **читается** (`v12GetPositionHistory`), никогда не пишется → в `ARCHIVE` колонка «История» всегда `[]`.
- **`BOM_REVISION`** — только **читается** (`v12BuildRevisionDateMap`), но **никогда не пишется**. Последствия — см. B2 в разделе «Баги».

### 2.4 Мёртвые конфиг-значения
- `V12_CONFIG.SETTINGS.DATE_FORMAT` — не используется.
- `V12_CONFIG.BOM_REGISTRY_COLUMNS.DIRTY`, `ACTIVE`, `COMPLETED_FLAG`, `WORKING_SPREADSHEET_ID` — пишутся при upsert, но логикой не читаются (кроме записи).
- `V12_CONFIG.MATERIAL_COLUMNS.RESERVED_QTY/FREE_QTY` заполняются только в `v12RecalculateWarehouseConsistency` (вызывается лишь из полной синхронизации).

### 2.5 Дубли
- `v12RefreshAllProjections()` ≡ `v12RefreshProjections()` (идентичные тела) — оставить одну.
- В меню `v12OnOpen` два пункта ведут на **одну** функцию `v12RunFullSync` («🔄 Полная синхронизация» и «📥 Импорт BOM (источник)») — убрать один.
- `v12DeficitStatusDisplay` и `v12SupplyStatusDisplay` — две разные системы «человекочитаемых» статусов; первая используется, вторая мертва.
- `v12RefreshDashboard` и `v12AggregateBomStates` оба читают POSITION_STATE независимо.

---

## 3. БАГИ, КОНФЛИКТЫ ЛОГИКИ

### B1. WORKING BOM: колонки сдвинуты, чекбокс никогда не работает 🔴 КРИТИЧНО
- `V12_CONFIG.WORKING_BOM_COLUMNS`: `… PRODUCTION_STATE:13, CHECKBOX:14, UPDATED_AT:15`.
- `v12RefreshWorkingBOM` пишет **ровно 14 значений**: индексы 12→кол.13 (`PRODUCTION_STATE`) — верно, но индекс 13 = `new Date()` попадает в **кол.14 = CHECKBOX**, а `UPDATED_AT` (кол.15) **не пишется вообще**.
- `v12RefreshWorkingBOM` **не вызывает** ни одной `Install…Checkboxes` → на листе отображается дата вместо чекбокса, а валидация-чекбокс не установлена.
- `v12HandleWorkingBomEdit` при этом проверяет `column !== W.PRODUCTION_STATE` (13), т.е. реакция привязана к **текстовой** колонке «ProductionState», а не к чекбоксу (кол.14). Функция `v12MarkReceivedByProduction(..., WORKING_BOM)` практически недостижима корректным путём.

**Устранение**: писать 15 значений (`… status, false /*checkbox*/, new Date()`), добавить `v12InstallWorkingBomCheckboxes(rowCount)` и перевести `v12HandleWorkingBomEdit` на `W.CHECKBOX`.

### B2. `BOM_REVISION` никогда не заполняется 🔴 ВЫСОКО
`v12BuildRevisionDateMap()` читает `BOM_REVISION`, но **ни одна функция в неё не пишет**. Следствия:
- Dashboard, колонка «Дата создания» — **всегда пустая**.
- `v12PickingDeliveryDate`: ветка «зарезервировано ≥ требуется → дата поставки = дата создания BOM» **никогда не срабатывает** (bomCreatedDate всегда `undefined`), т.е. спорная, но заявленная в ТЗ логика не работает.

**Устранение**: при `v12UpsertSourceBOM` (создание BOM) и/или при первой синхронизации писать строку в `BOM_REVISION` (`Дата создания, BOM ID, Ревизия, Создал`).

### B3. `v12ReturnFromArchive` не подключён 🟠 СРЕДНЕ
Функция реализована (К6/ТЗ №78–82), но **не вызывается ниоткуда**: нет пункта меню, нет триггера, нет UI. Функциональность возврата из архива фактически отсутствует. Либо добавить в меню/диалог, либо зафиксировать как «не реализовано».

### B4. `v12RemoveV11Triggers` удаляет ВСЕ триггеры проекта 🔴 ОПАСНО
`removeV11Triggers()` (`v12_trigger.js`) безусловно удаляет **все** триггеры проекта, не только V11. Любой пользовательский триггер (или сторонний) будет уничтожен при `v12InstallTriggers`. Название не соответствует поведению.

**Устранение**: фильтровать по целевому идентификатору/имени функции; удалять только `v12OnEdit`, `v12ScheduledUpdate` и известные V11-функции.

### B5. Несогласованная нормализация чекбоксов 🟠 СРЕДНЕ
`v12IsChecked()` корректно обрабатывает `true/"TRUE"/1/"да"`, и он используется в обработчиках `onEdit`. Но при **чтении с листов** в других местах применяется строгое `=== true`:
- `v12IsDeficitRowActive`, `v12GetBomProjectCodes`, `v12AggregateBomStates` (`received`), `v12ApplyComputedToRow` (`receivedByProduction`), `v12BuildExcludedMap` (DONE).

Если Sheets вернёт стороку `"TRUE"` (что бывает при вставке/автозаполнении), логика даст ложный результат: позиция не будет исключена как «переданная», BOM не будет помечен выполненным и т.п.

**Устранение**: использовать `v12IsChecked()` всюду, где читается признак-чекбокс.

### B6. `v12ConsistencyCheck` — проверка «дубликатов» некорректна 🟡 НИЗКО
`if (report.positionIds.size !== (positionData.length - 1))` — сравнение числа **уникальных непустых** ID с числом **строк**. Любая строка с пустым `positionId` даст ложное «обнаружены дубликаты». Кроме того, блок `archivedPositionIds.forEach(...)` пуст → архивированные позиции в проекциях фактически не проверяются, хотя это заявлено в ТЗ №160–161.

### B7. `v12ApplyDeficitColors` не сбрасывает фон «хвоста» 🟡 НИЗКО
`clearBody` вызывает `clearContent()`+`clearDataValidations()`, но **не** `clearFormat`/`setBackground`. Если строк стало меньше, старые заливки остаются на пустых строках. Тот же дефект — на остальных проекциях.

### B8. Двойной учёт складских дельт — потенциальный конфликт 🟠 СРЕДНЕ
Складские дельты применяются **в двух местах**: 
1. `v12HandleDeficitRangeEdit` и `v12HarvestDeficitInput` — своими блоками по `warehouseDelta`;
2. `v12SetRealDeliveryQty`/`v12MarkReceivedByProduction` — через `v12AdjustWarehouseQty`.

Защита сейчас — через `skip`-параметр harvest и проверку `currentReal < required`. Это хрупко: при рассинхроне листа и состояния (или при потере onEdit) возможен **двойной/пропущенный** учёт. Код сам это признаёт комментариями.

**Устранение**: единая точка мутации склада (`v12AdjustWarehouseQty`) + ledger-подход (запись дельт в отдельный журнал), идемпотентный по operationId.

### B9. `v12OnEdit` не различает «Сводку» при multi-column диапазоне корректно 🟡 НИЗКО
`isSummaryRange = !isSingleCell && name === DEFICIT_SUMMARY` — при вставке блока, затрагивающего колонки за пределами Заказ/Ожидаемая/Реальная, обработчик просто игнорирует лишние колонки (ок), но `v12RevertEdit` для одиночной правки в неизвестной колонке может конфликтовать с массовым выделением.

### B10. Синхронный `v12RunDebug` через `alert` 🟡 НИЗКО
`v12RunDebug` в конце вызывает `SpreadsheetApp.getUi().alert(...)`. Если функцию вызвать из триггера/без UI — исключение. Защиты (try/catch) нет, в отличие от `v12HandleDeficitEdit`, где alert обёрнут в try.

### B11. Мутация входного массива в Change Engine 🟡 НИЗКО
`v12DetectBOMChanges` делает `materials.sort(...)` — сортирует массив `source.materials` **на месте**, побочный эффект для вызывающего.

### B12. `v12BuildPositionIndex` вызывается 2–3 раза подряд в одной операции 🟠 СРЕДНЕ
Например `v12SetOrderedQty`: сначала `v12BuildPositionIndex()`, затем внутри `v12RefreshDeficitSummaryRow` → `v12HarvestDeficitInput` снова `v12BuildPositionIndex()`, затем снова чтение `POSITION_STATE`. Это и производительность (P1/P4), и риск «устаревшего снимка» между вызовами.

---

## 4. АРХИТЕКТУРНЫЕ РИСКИ

1. **Отсутствие модульности Apps Script**: все функции глобальны; переименование `v12OnEdit`/`v12ScheduledUpdate` мгновенно ломает меню (меню ссылается на имена строками). Нет единой точки регистрации.
2. **`getDataRange().getValues()` повсеместно**: читает все 31 колонку даже там, где нужны 3. Для роста до 40k строк (явно упомянуто в коде) это упор в лимиты.
3. **Отсутствие транзакционности**: последовательность «прочитать → изменить → записать» защищена только ScriptLock; при ошибке между шагами возможно частичное состояние (индексы и лист расходятся). Код компенсирует это «harvest»-перечитыванием (ценой производительности).
4. **Плотная связность проекций**: три функции (`v12ApplyDeficitColors`, `v12ApplyDeficitColorForRow`, `v12DeficitStatusDisplay`) хардкодят русские строки статусов вместо использования констант конфига — рассинхрон при переименовании.
5. **Отладочные/диагностические функции в продакшене** (`v12RunDebug`, `v12Diagnostic`, `v12ConsistencyCheck`) — занимают место и время на UI, но полезны; предложение — не удалять, а скрыть за пунктом «Диагностика».

---

## 5. ПРИОРИТИЗИРОВАННЫЙ ПЛАН УСТРАНЕНИЯ

### Этап 1 — быстрые победы (низкий риск, высокий эффект)
1. **Убрать `warehouseQty` из расчёта**: удалить параметр из `v12CalculatePositionState` и `v12ApplyComputedToRow`; удалить вызовы `v12GetWarehouseQtyForPositionRow`/`v12GetWarehouseQty` из горячих путей (P2, 2.2).
2. **Читать `POSITION_STATE` один раз на пересчёт**, передавать массив во все билдеры (P1).
3. Удалить мёртвые функции из таблицы 2.1 и мёртвые переменные (2.2).
4. Объединить `v12RefreshAllProjections` / `v12RefreshProjections`; убрать дублирующий пункт меню (2.5).
5. Установить валидации/CF-правила только при изменении числа строк (P7).

### Этап 2 — корректность
6. Исправить WORKING BOM: 15 колонок, чекбокс, обработчик (B1).
7. Заполнять `BOM_REVISION` при создании BOM (B2).
8. Заменить `=== true` на `v12IsChecked()` при чтении признаков (B5).
9. `removeV11Triggers` → удалять только свои триггеры (B4).
10. Переписать `v12ConsistencyCheck` (проверка дубликатов и архивных позиций) (B6).
11. Подключить `v12ReturnFromArchive` к UI или задокументировать как «отключено» (B3).

### Этап 3 — производительность на масштаб (40k строк)
12. Перевести `v12RunFullSync` на **единые индексы + единый батч записи** (P6).
13. Ввести **dirty-флаги** и точечную запись в проекции (P3) — по образцу уже существующего `v12RefreshDeficitSummaryRow`.
14. Обрабатывать массовые передачи одним проходом с готовыми индексами, без перестроений (P4, B12).
15. Убрать множественные `flush()`; использовать одно чтение/одну запись (P5).
16. `appendRow` → батч `setValues` в циклах (P9).
17. `waitLock(30000)` → `tryLock(0)` + очередь через time-driven триггер (P8).
18. Заполнять склад иерархично: единая точка мутации + ledger дельт (B8).
19. Убрать/скрыть листы-призраки `EVENT_LOG`, `MATERIAL_HISTORY` (2.3) — либо начать их заполнять, либо исключить из `SHEETS`/`HEADERS`.

### Этап 4 — гигиена
20. Вынести хардкод статусов в конфиг; `clearFormat`/`setBackground` при сокращении строк (B7).
21. Обернуть `alert` в `v12RunDebug` в try/catch (B10).
22. Обеспечить `v12EnsureAllSheets` идемпотентность после правок конфига (миграции уже есть — расширить на WORKING BOM).

---

## Module Reference

| Файл | Назначение |
|---|---|
| `v12_config.js` | Единый конфиг: листы, колонки, статусы, роли, цвета, решения К1–К7 |
| `v12_source.js` | Чтение исходных BOM (Drive, read-only), парсинг, `BOM_REGISTRY` upsert, `EXCLUDED_BOMS` |
| `v12_change_engine.js` | `v12DetectBOMChanges` → ChangeSet → `v12ApplySourceRevision`; `v12SyncBOM` |
| `v12_calculate.js` | Чистый расчётный движок (дефицит, доступность, supply/production state, flags) |
| `v12_position_state.js` | `POSITION_STATE`: построение строки, применение вычислений, персистенция |
| `v12_material_state.js` | `MATERIAL_STATE`: остаток/резерв/свободно, агрегация резервов, контроль №30 |
| `v12_sheet_service.js` | Доступ к листам V12, индексы, `v12UpdatePosition`, `v12UpdateBomRegistry` |
| `v12_operations.js` | Операции снабжения: заказ / ожидаемая дата / реальная поставка |
| `v12_handoff.js` | Передача производству (идемпотентная), архивация, возврат из архива, склад |
| `v12_projections.js` | 5 проекций + harvest-страховки + окраска + фильтр ОТБОРКИ |
| `v12_roles.js` | RBAC: карта email→роль, права по полям/действиям |
| `v12_audit.js` | AUDIT_LOG (буфер + батч-сброс) |
| `v12_trigger.js` | `v12OnEdit` + обработчики листов, `v12ScheduledUpdate`, `v12RunFullSync`, `v12SetBomDone` |
| `v12_controller.js` | Меню, `v12Install`, `v12Diagnostic`, `v12ConsistencyCheck`, `v12RunDebug` |
| `v12_utils.js` | materialKey (К5), positionId, валидация №8, `v12ToDate`, `v12IsChecked` |
| `sheet_service.js` | Generic-обёртки Sheets (read/write/batch/clear/ensure) |
| `utils.js` | `toNumber`, `normalizeMaterialId`, `generateEventId`, `getCurrentUser` |
| `lock.js` | Реентрантный `acquireScriptLock()` |
| `logger.js` | `logSystem` / `flushSystemLog` (буфер) |
| `_local_tests/*.js` | Node-диагностика (не выгружается; см. `.claspignore`) |

---

## Suggested Reading Order

1. **`v12_config.js`** — вся предметная модель и решения по конфликтам ТЗ собраны здесь; без него остальной код нечитаем.
2. **`v12_calculate.js`** — 40 строк чистого движка задают ВСЮ бизнес-логику количеств; отсюда видно мёртвые входы (warehouse/expected/deadline).
3. **`v12_projections.js`** — где сосредоточены и производительность, и большая часть логики; harvest-механизм объясняет большинство «странностей».
4. **`v12_trigger.js`** — реальная точка входа и все правила обработки правок; здесь же выявляются конфликты по листам.
5. **`v12_handoff.js` + `v12_operations.js`** — операции, мутирующие состояние и склад (двойной учёт, блокировки, RBAC).
6. **`v12_sheet_service.js`** — индексы и `batchWrite`: ключ к пониманию производительности.

---

*Отчёт №30. Никакие файлы кода не изменялись — режим Explore.*
