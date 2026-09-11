# BOM CONTROL SYSTEM V12 — Отчёт о внесённых изменениях (реализация аудита №30)

> Отчёт №31. Реализация исправлений и ускорений по результатам аудита `project_info__30.md`.
> Режим: ACT. Все изменения внесены в исходники; проверены локальными Node-тестами и `node --check`.

## Итог проверки

- `_local_tests/v12_delivery_test.js` — **ALL TESTS PASSED** (S1–S9).
- `_local_tests/v12_picking_schema_test.js` — **ALL TESTS PASSED** (C1–C8).
- `node --check` по всем 19 файлам — **OK**.
- Авто-проверка кросс-ссылок: 131 определение функций, 113 уникальных вызовов `v12*` — **все вызываемые функции определены**.

---

## 1. Исправленные ошибки (корректность)

### B1 — WORKING BOM (колонки сдвинуты, чекбокс не работал) 🔴
- `v12_projections.js :: v12RefreshWorkingBOM` теперь пишет **15 значений** (… `false` в кол.14 CHECKBOX, `new Date()` в кол.15 UPDATED_AT), а не 14 со сдвигом.
- Добавлена `v12InstallWorkingBomCheckboxes(rowCount)` и её вызов из `v12RefreshWorkingBOM`.
- `v12_trigger.js :: v12HandleWorkingBomEdit` переведён на колонку `W.CHECKBOX` (14), добавлена обработка статуса `blocked` с откатом и alert; остальные колонки — read-only для не-Admin.

### B2 — `BOM_REVISION` никогда не заполнялся 🔴
- `v12_source.js`: добавлена `v12AppendBomRevision(bomId, revision)`; вызывается в `v12UpsertSourceBOM` при создании BOM (ревизия 1) и при изменении hash (новая ревизия).
- Теперь Dashboard «Дата создания» и «Дата поставки» в ОТБОРКЕ (для позиций, закрытых резервом BOM) получают данные.

### B3 — `v12ReturnFromArchive` не был подключён 🟠
- `v12_controller.js`: в меню добавлен пункт «↩ Вернуть из архива» → новая `v12PromptReturnFromArchive()` (спрашивает Position ID и причину, вызывает `v12ReturnFromArchive`).

### B4 — `removeV11Triggers` удалял ВСЕ триггеры 🔴
- `v12_trigger.js`: удаляются только обработчики `v12OnEdit` и `v12ScheduledUpdate` (по `getHandlerFunction()`), пользовательские триггеры больше не уничтожаются.

### B5 — несогласованная нормализация чекбоксов 🟠
- Строгое `=== true` заменено на `v12IsChecked(...)` при чтении признаков: `v12_calculate` (receivedByProduction), `v12_position_state` (receivedByProduction), `v12_projections` (`v12IsDeficitRowActive`, `v12GetBomProjectCodes`, `v12RefreshPicking`), `v12_source` (`v12BuildExcludedMap`).

### B6 — `v12ConsistencyCheck` (ложные «дубликаты») 🟡
- `v12_controller.js`: дубликаты определяются сравнением уникальных ID с числом **непустых** ID; удалён no-op блок по архивированным позициям (он ссылался на удалённый Set).

### B10 — `alert` в `v12RunDebug` без защиты 🟡
- Вызов `SpreadsheetApp.getUi().alert` обёрнут в try/catch (работает и при запуске из триггера).

---

## 2. Удалён мёртвый код

Удалены неиспользуемые функции:
- `v12IsReadyForHandoff`, `v12IsReservationPhysicalInconsistent` (`v12_calculate.js`)
- `v12BuildPositionStableKey` (`v12_utils.js`)
- `v12BuildWarehouseMap` (`v12_material_state.js`)
- `v12SupplyStatusDisplay` (`v12_projections.js`)
- `v12IsActivePosition` (`v12_position_state.js`)
- `v12RoleLabel` (`v12_roles.js`)
- `v12AppendRows` (`v12_sheet_service.js`)
- `v12IsBusy` + `v12SetBusy` и мёртвый механизм `V12_RECALCULATING` (`v12_trigger.js`)
- `warehouseFor` (`v12_change_engine.js`, всегда возвращала 0)

Удалены мёртвые переменные/параметры:
- `warehouseQty`, `expectedDate`, `deadline`, `receivedByProductionQty` — неиспользуемые входы `v12CalculatePositionState` (и второй аргумент `v12ApplyComputedToRow`).
- `const A` в `v12Audit`.
- `existingIds` в `v12DetectBOMChanges`; параметр `opsFor(ignored)` → `opsFor()`.

Убран дублирующий пункт меню («Импорт BOM» → та же `v12RunFullSync`).

---

## 3. Ускорение (производительность)

### P2 — снят бесполезный плумбинг склада ⚠
`v12CalculatePositionState` игнорирует `warehouseQty`, поэтому удалены все его вычисления:
- `v12ApplyComputedToRow(row, warehouseQty)` → `v12ApplyComputedToRow(row)`;
- удалена `v12GetWarehouseQtyForPositionRow` и её вызовы из `v12_operations.js`, `v12_projections.js`, `v12_trigger.js`, `v12_change_engine.js`.
Это убрало построение полного индекса `MATERIAL_STATE` на каждый вызов (ранее — O(N²) в циклах обработки диапазонов).

### P1 — одно чтение `POSITION_STATE` на пересчёт ⚠
- `v12RefreshProjections()` теперь: harvest (Сводка + ОТБОРКА) → **одно** чтение `POSITION_STATE` → передача данных во все проекции.
- Сигнатуры проекций принимают необязательный `posData`: `v12RefreshDeficitSummary`, `v12RefreshPicking`, `v12RefreshWorkingBOM`, `v12RefreshSupply`, `v12RefreshDashboard`, `v12AggregateBomStates`.
- `v12RefreshAllProjections()` делегирует в `v12RefreshProjections()` (устранён дубль).
- `v12HandleDeficitRangeEdit` вызывает единый `v12RefreshProjections()` вместо пяти проекций подряд.
Было ~5–6 полных чтений `POSITION_STATE` за пересчёт → стало 1.

### P6 — полная синхронизация: единые индексы ⚠
- `v12RunFullSync` строит `positionIndex` и `registryIndex` **один раз** и передаёт их в `v12SyncBOM` → `v12UpsertSourceBOM`. Ранее индексы перечитывались на каждый BOM.
- `v12SyncBOM(source, positionIndex, registryIndex)` и `v12UpsertSourceBOM(source, registryIndex)` поддерживают как внешние индексы, так и самостоятельное построение.

### P7 — без пересоздания UI-правил
- `v12_projections.js`: добавлен `_v12ProjectionUiState`; `v12InstallDeficitCheckboxes`, `v12InstallPickingCheckboxes` и `v12ApplyDashboardColors` (условное форматирование — дорогая операция уровня листа) пропускают работу, если число строк не изменилось.

---

## 4. Что НЕ сделано (осознанно, вне рамок безопасной правки)

- **P3 (dirty-флаги / полностью инкрементальные проекции)** и **P4 (полная переработка harvest)** — требуют изменения архитектуры пересчёта и тестирования в реальном Google Apps Script; частично смягчены P1 (harvest один раз на пересчёт).
- **P5 (`SpreadsheetApp.flush`)** — оставлен: в ряде мест он синхронизирует только что записанные значения до чтения (снятие рискует потерей правок при быстром вводе).
- **P8 (`tryLock` вместо `waitLock`)**, **P9 (appendRow→батч в циклах)**, переработка листов-призраков `EVENT_LOG`/`MATERIAL_HISTORY` — задокументированы в `project_info__30.md` как следующий этап.

---

## 5. Матрица изменённых файлов

| Файл | Изменения |
|---|---|
| `v12_calculate.js` | убраны мёртвые входы; `v12IsChecked`; удалены 2 мёртвые функции |
| `v12_position_state.js` | `v12ApplyComputedToRow(row)`; удалён `v12IsActivePosition` |
| `v12_material_state.js` | удалён `v12BuildWarehouseMap` |
| `v12_utils.js` | удалён `v12BuildPositionStableKey` |
| `v12_roles.js` | удалён `v12RoleLabel` |
| `v12_sheet_service.js` | удалён `v12AppendRows` |
| `v12_audit.js` | удалён неиспользуемый `const A` |
| `v12_change_engine.js` | `v12SyncBOM(..., positionIndex, registryIndex)`; удалён `warehouseFor`, `existingIds`, параметр `opsFor` |
| `v12_source.js` | `v12AppendBomRevision` + вызовы (B2); `v12UpsertSourceBOM(source, registryIndex)`; `v12IsChecked` в excluded-map |
| `v12_operations.js` | одно-аргументный `v12ApplyComputedToRow`; удалён warehouse-хелпер |
| `v12_projections.js` | единое чтение POSITION_STATE (P1); WORKING BOM 15 колонок + чекбокс (B1); `_v12ProjectionUiState` (P7); удалён `v12SupplyStatusDisplay` |
| `v12_trigger.js` | WORKING BOM-обработчик на CHECKBOX (B1); scoped `removeV11Triggers` (B4); удалён busy-механизм; единые индексы в full sync (P6); range-edit → `v12RefreshProjections` |
| `v12_controller.js` | меню без дубля + «Вернуть из архива» (B3); `v12PromptReturnFromArchive`; исправлен `v12ConsistencyCheck` (B6); try/catch вокруг alert (B10) |

---

## 6. Рекомендация по проверке в реальном Google Apps Script

После `clasp push` выполнить: `v12Install` → `v12RunFullSync` → `v12RunDebug` → `v12ConsistencyCheck`.
Для проверки новых функций: отметить чекбокс в WORKING BOM (должна сработать передача) и один раз в `BOM_REVISION` после синхронизации новой BOM должна появиться строка с датой создания.
