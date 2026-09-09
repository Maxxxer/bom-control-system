# BOM CONTROL SYSTEM — Аудит после удаления V11 (V12)

## 1. Резюме

Удалены все файлы старой архитектуры V11 (единая мастер-таблица MATERIAL_STATE,
перезапись исходных BOM, логические флаги вместо количеств). Остался чистый
контур V12: `SOURCE → BOM_REGISTRY → POSITION_STATE → MATERIAL_STATE → проекции`.

### Остались следующие файлы (19 .js + конфигурация)
- **Общие сервисы**: `sheet_service.js` (примитивы), `logger.js`, `lock.js`, `utils.js`
- **V12 (15)**: `v12_config`, `v12_source`, `v12_position_state`, `v12_calculate`,
  `v12_change_engine`, `v12_material_state`, `v12_operations`, `v12_handoff`,
  `v12_projections`, `v12_roles`, `v12_audit`, `v12_sheet_service`, `v12_trigger`,
  `v12_controller`, `v12_utils`
- **Конфигурация**: `appsscript.json`, `.clasp.json`
- **Документация**: `project_info__1..9.md`, `task_progress.md`

### Что удалено (18 файлов)
`config.js, controller.js, trigger_engine.js, archive_engine.js, bom_engine.js,
bom_state_engine.js, color_engine.js, dashboard_engine.js, debug_engine.js,
deficit_engine.js, event_engine.js, exclusion_registry.js, export_engine.js,
import_engine.js, material_actions.js, material_service.js, roles.js, status_engine.js`

### Переносы
- `onOpen() → v12OnOpen()` перенесён в `v12_controller.js`
- `removeV11Triggers()` перенесён в `v12_trigger.js`
- `lock.js / logger.js` переведены с `V11_CONFIG` на `V12_CONFIG`
- `sheet_service.js` очищен от V11-функций и `V11_CONFIG`

## 2. Выполненная верификация

- **Синтаксис**: `node --check` / `vm.Script` по всем 19 `.js` — **OK**.
- **Кросс-ссылки**: 95 определений / 95 вызовов `v12*` — **пропущенных нет**;
  общие хелперы (`readSheetValues`, `batchWrite`, `removeV11Triggers` и др.) определены.
- **V11_CONFIG / legacy-функции**: обращений не осталось (только комментарий-пояснение
  «Заменяют старый saveDeficitChanges» в `v12_operations.js`).

## 3. Оставшиеся проблемные места (по приоритету)

### 🔴 Критично для работы по ТЗ

#### 1. `BOM_REVISION` никогда не заполняется → «Дата создания» на дашборде пустая
- `v12UpsertSourceBOM()` пишет в `BOM_REGISTRY`, но **не пишет строку в `BOM_REVISION`**.
- `v12BuildRevisionDateMap()` (добавлена для даты создания) читает `BOM_REVISION` → всегда пусто.
- **Фикс**: при создании BOM и при инкременте `SOURCE_REVISION` (`changed`) добавлять строку
  `[new Date(), bomId, sourceRevision, user]` в `BOM_REVISION`.

#### 2. Передача из WORKING BOM фактически не работает
- `WORKING_BOM_COLUMNS` **не содержит колонки-чекбокса** передачи (только `PRODUCTION_STATE` text).
- `v12HandleWorkingBomEdit` ожидает чекбокс в колонке `PRODUCTION_STATE` (13), но туда пишется
  текстовый статус → чекбокса нет, передача из WORKING BOM невозможна.
- **Фикс**: добавить колонку `HANDOFF_CHECKBOX` в `WORKING_BOM_COLUMNS`/HEADERS и обрабатывать её
  в `v12HandleWorkingBomEdit` (как в ОТБОРКЕ). ТЗ №25–27: и ОТБОРКА, и WORKING BOM — оба источника передачи.

#### 3. Семантика «Готов к производству» на дашборде
- `v12AggregateBomStates` считает `collected`, когда `productionState === RECEIVED`.
- `v12ComputeBomStatus`: `READY` («Готов к производству») при `collected === total`.
  → «Готов» показывается, когда всё **уже передано** производству (то есть фактически выполнено),
  а не когда всё **доступно** к передаче.
- **Фикс (уточнить по ТЗ №47/52)**: `collected` должен считаться как позиции
  `READY_FOR_HANDOFF` (или «отобранные»), а `RECEIVED` — это уже «выполнено». Тогда
  «Готов к производству» = все позиции готовы к передаче, а «Выполнено» = все переданы.

#### 4. Стабильность `positionId`
- `v12GeneratePositionId` = `bomId + ":" + materialKey`. `materialKey` = `code` или `name|model|unit`.
- При изменении кода/наименования/модели позиция «переименовывается» → получается
  `POSITION_DELETED + POSITION_ADDED`, теряется операционное состояние (заказ, поставка, передача, история).
- Также при дубликатах в одном BOM суффикс `#2/#3` назначается по порядку обхода — может «плыть».
- **Фикс**: присваивать постоянный внутренний `positionId` при первом импорте и сохранять маппинг
  (например, `bomId + ":" + bomRow` или UUID), не пересчитывая его по атрибутам (ТЗ №10, №150).

### 🟠 Важно для производительности/полноты

#### 5. `v12RefreshProjections()` — полный пересчёт всех проекций на каждую операцию
- Каждый заказ/дата/поставка/передача вызывает пересборку всех 5 проекций. Для 40k строк
  это не уложится в целевые тайминги (№92: <2с, <3с).
- **Фикс**: инкрементальное обновление только затронутых проекций по dirty-флагам (К7, №157–158).

#### 6. `v12RunDebug` покрывает только 6 сценариев расчёта
- ТЗ №120–128 требует ~20 сценариев (нулевой дефицит; склад без резерва; `RESERVE_CHANGED`;
  частичный/полный резерв; заказ; частичная/полная поставка; частичная/полная доступность;
  передача из ОТБОРКИ и WORKING BOM; синхронизация двух интерфейсов (1 handoff, 1 архив);
  повторная передача; архив; возврат; изменение потребности/срока; замена материала;
  добавление/удаление позиции; физическое несоответствие).
- **Фикс**: расширить `v12RunDebug` + `v12ConsistencyCheck` до полного цепочечного прогона
  `BOM ↔ POSITION_STATE ↔ DEFICIT ↔ ОТБОРКА ↔ WORKING BOM ↔ Dashboard ↔ Архив` (№160–161).

#### 7. `v12ConsistencyCheck` неполная
- Проверяет только `BOM_REGISTRY↔POSITION_STATE` (наличие BOM, дубли positionId).
- Не проверяет: соответствие проекций (DEFICIT/ОТБОРКА/WORKING BOM/Dashboard) состоянию `POSITION_STATE`;
  агрегат резервов `MATERIAL_STATE.reservedQty` против активных позиций; отсутствие архивных позиций в проекциях.

### 🟡 Мелкие / настройка

#### 8. `V12_ROLE_MAP` пустой — RBAC блокирует всех
- `v12GetUserRole` возвращает `""`, пока роли не заполнены → `v12RequireRole` бросает «Недостаточно прав».
- Нужно заполнить `email → роль` перед боевым использованием.

#### 9. Дублирование чекбоксов «Получено» и «Реальная поставка» в сводке
- Оба (кол. 17, 18) вызывают `v12SetRealDeliveryQty`. Пишутся всегда `false`, т.е. не «запоминаются»
  (количество живёт в кол. 15 через `POSITION_STATE.REAL_DELIVERY_QTY`). Избыточность UI — оставить один.

#### 10. `warehouseQty` передаётся в `v12CalculatePositionState`, но не используется
- В формуле `availableForProduction = reserved + realDelivery`; `warehouse` не участвует.
- Флаг `RESERVATION_PHYSICAL_INCONSISTENCY` считается отдельно в `v12RecalculateWarehouseConsistency`.
- **Рекомендация**: либо использовать `warehouse` в расчёте, либо убрать параметр (сейчас мёртвый).

#### 11. `v12RefreshSupply` считает `bomCount` по позициям, а не по BOM
- Колонка «BOM (кол-во)» должна показывать число BOM, а инкрементируется на каждую позицию.

#### 12. Нет защиты листов (sheet protection) при установке
- `v12Install` не ставит `protect()` на листы — только on-edit откат. Для усиления контроля — добавить.

#### 13. Потеря незаписанных записей аудита
- `v12Audit` буферизует и сбрасывает при пороге/явном вызове. При аварийном завершении часть
  записей теряется. Низкий риск — можно сбрасывать чаще.

## 4. Рекомендуемый порядок исправлений

1. Заполнять `BOM_REVISION` (критично для дашборда).
2. Добавить чекбокс передачи в WORKING BOM.
3. Уточнить семантику «collected»/READY на дашборде.
4. Ввести стабильный `positionId` (постоянный ключ позиции).
5. Инкрементальные проекции + полный регресс `v12RunDebug`/`v12ConsistencyCheck`.
6. Заполнить `V12_ROLE_MAP`; убрать дублирующий чекбокс в сводке.

> Код V12 синтаксически целостен и не содержит останков V11. Перечисленное —
> функциональные/архитектурные недоработки, требующие доработки и прогона в Google Apps Script.
