# BOM CONTROL SYSTEM V12 — Полный аудит: производительность, мёртвый код, конфликты логики

Полный отчёт сохранён в `project_info__28.md` (следующий свободный номер после 27). Ниже — его содержание.

> Документ составлен по результатам чтения **всех** исходных файлов проекта `c:\Users\Максим\BOM_CONTROL_SYSTEM`.
> Предыдущая серия `project_info__1…27` описывала промежуточные состояния схемы ОТБОРКИ (13 колонок с «Ожидаемая поставка»). **Текущий код отличается:** ОТБОРКА сейчас — 12 колонок, кол. 11 = «Дата поставки» (отображение `REAL_DELIVERY_DATE`), чекбокс на кол. 12. Подтверждено `_local_tests/v12_picking_schema_test.js` и `V12_CONFIG.HEADERS.PICKING`.

---

## 1. Что это за система

Google Apps Script (`.js`, V8, `appsscript.json`) + Google Sheets. Управляет потребностью в комплектующих (BOM) для производственных проектов: читает **исходные BOM только на чтение** из папки Google Drive, строит центральное состояние позиций и набор «проекций» для снабжения, склада, производства и руководителя. Пользователи: снабженец, кладовщик/производство, экономист, администратор, наблюдатель. Масштаб по конфигу — до 100 000 позиций, до 2 000 BOM (`V12_CONFIG.LIMITS`). На таком объёме текущая реализация проекций работать **не будет** (раздел 6).

## 2. Архитектура

Поток данных (манифест в `v12_config.js`):

```
ORIGINAL BOM (Drive, read-only)
  -> BOM_REGISTRY          (реестр: bomId, ревизия, hash, dirty)
    -> POSITION_STATE      (31 колонка — центральное состояние позиции)
      -> MATERIAL_STATE    (физический склад)
      -> DEFICIT_SUMMARY / ОТБОРКА / WORKING BOM / СНАБЖЕНИЕ / Dashboard  (проекции)
```

- **SOURCE** — файлы BOM на Drive, никогда не перезаписываются (`v12_source.js`).
- **STATE** — `POSITION_STATE` (истина по позиции) + `MATERIAL_STATE` (склад).
- **VIEW** — 5 листов-проекций, полностью пересобираемых из `POSITION_STATE`.
- **Журналы** — `AUDIT_LOG`, `SYSTEM_LOG` (+ заявленные, но мёртвые `EVENT_LOG`, `MATERIAL_HISTORY`, `BOM_REVISION`).

Стек: чистый JavaScript без сборщика и типов, `clasp` для выгрузки, без внешних библиотек. Вся логика — глобальные функции (нет модулей/классов).

Точки входа: `onOpen()→v12OnOpen()` (меню), `v12OnEdit(e)` (installable), `v12ScheduledUpdate()` (почасовой time-based).

## 3. Структура каталогов

```
BOM_CONTROL_SYSTEM/
├─ appsscript.json, .clasp.json, .claspignore
├─ v12_config.js         — ЕДИНЫЙ конфиг: листы, колонки, статусы, роли, цвета, события, К1–К7
├─ v12_source.js         — чтение исходных BOM из Drive + BOM_REGISTRY (upsert/hash)
├─ v12_sheet_service.js  — доступ к листам, индексы, миграции схем, точечные записи
├─ v12_position_state.js — построение/применение строки POSITION_STATE
├─ v12_calculate.js      — ЧИСТЫЙ расчётный движок (8 количеств, состояния, флаги)
├─ v12_change_engine.js  — detectBOMChanges → ChangeSet → applySourceRevision, синхронизация
├─ v12_material_state.js — MATERIAL_STATE, агрегация резервов, reserved ≤ warehouse
├─ v12_operations.js     — заказ/дата/реальная поставка
├─ v12_projections.js    — 5 проекций + harvest-страховки + окраска
├─ v12_handoff.js        — передача производству (идемпотентная) + возврат из архива
├─ v12_roles.js          — RBAC
├─ v12_audit.js          — буферизованный AUDIT_LOG
├─ v12_trigger.js        — onEdit-роутер, обработчики, триггеры, full sync
├─ v12_controller.js     — меню, установка, диагностика, self-тест
├─ sheet_service.js, utils.js, logger.js, lock.js  — базовые сервисы
└─ _local_tests/         — Node-тесты (vm); НЕ выгружаются (v12_delivery_test, v12_picking_schema_test)
```

## 4. Ключевые абстракции

- **`V12_CONFIG`** — единственный источник правды по листам/колонкам/статусам; код обращается к колонкам только через именованные ключи (`P.ORDERED_QTY`).
- **Позиция (`POSITION_STATE`, 31 колонка)** — ядро; `positionId` = `<bomId>:<materialKey>` (при дублях `#2`…), `materialKey` = `code`, иначе `name|model|unit` (К5).
- **`v12CalculatePositionState`** — чистая функция без I/O. `deficit = max(0, required − reserved)`; `uncovered = max(0, deficit − ordered)`; `availableForProduction = reserved + realDelivery` (К1). **Проблема:** вход `warehouseQty` не используется (баг B3).
- **`v12OnEdit`** — роутер правок под `acquireScriptLock()`; **каждый edit → полная пересборка всех 5 проекций** (раздел 6).
- **Проекции (`v12_projections.js`)** — 5 пересборщиков; есть точечное обновление строки сводки `v12RefreshDeficitSummaryRow` (образец правильного подхода); harvest-механизмы — страховка от потери массовых отметок.
- **`v12MarkReceivedByProduction`** — идемпотентная передача: роль → валидность → доступность → запись → архивация → списание со склада → аудит; возврат `v12ReturnFromArchive`.
- **Сервисный слой** — `readSheetValues`, `writeValues`, `clearBody`, `appendRow`, `ensureSheet`, `batchWrite` (группирует изменения по строкам и пишет непрерывные отрезки через `setValues`).
- **Журналы** — `logSystem`/`v12Audit` буферизуются (порог 50/40) и сбрасываются пачкой; `acquireScriptLock` реентрантный (`_lockDepth`).

## 5. Мёртвый код, dead config и незавершённые функции

### 5.1 Функции, которые нигде не вызываются (безопасно удалить)

| Файл | Функция |
|------|---------|
| `utils.js` | `getCurrentUserSafe()`, `toDate()` + `isValidDate()`, `normalizeDateValue()`, `emptyArray()` |
| `logger.js` | `safeSystemLog()` |
| `v12_utils.js` | `v12BuildPositionStableKey()` |
| `v12_sheet_service.js` | `v12AppendRows()` |
| `v12_position_state.js` | `v12IsActivePosition()` |
| `v12_calculate.js` | `v12IsReadyForHandoff()`, `v12IsReservationPhysicalInconsistent()` |
| `v12_material_state.js` | `v12BuildWarehouseMap()` |
| `v12_projections.js` | `v12SupplyStatusDisplay()` |
| `v12_roles.js` | `v12RoleLabel()` |
| `v12_trigger.js` | `v12IsBusy()` (флаг `V12_RECALCULATING` пишется, но не читается) |

### 5.2 Мёртвая конфигурация (`v12_config.js`)
`SETTINGS.LOG_BUFFER_THRESHOLD`, `ENABLE_HISTORY`, `ENABLE_AUTO_WORKING_BOM`, `AUTO_RESIZE_DASHBOARD`, `AUTO_RESIZE_MAX_ROWS`; `LIMITS`; `SUPPLY_COLOR`, `PRODUCTION_COLOR`; `SYSTEM.SCHEMA_VERSION`, `ENVIRONMENT`; большинство `EVENTS.*`; большинство `FLAGS.*` (применяются только `OVER_ORDERED`, `SHORT_DELIVERY`, `CHANGED`); `LIFECYCLE_STATE.RETURNED`.

### 5.3 Мёртвые / неработающие листы и подсистемы (важно)
- **`EVENT_LOG`** — создаётся, но **никогда не пишется** (нет писателя). Ветка событий `EVENTS` холостая.
- **`MATERIAL_HISTORY`** — читается (`v12GetPositionHistory`), но **никогда не пишется** → `Archive.HISTORY` всегда `[]`.
- **`BOM_REVISION`** — читается (`v12BuildRevisionDateMap`), но **никогда не пишется** → «Дата создания» в Dashboard пуста, а ветка «зарезервировано ≥ требуется → дата создания BOM» в `v12PickingDeliveryDate` не срабатывает никогда. `v12UpsertSourceBOM` увеличивает `SOURCE_REVISION`, но запись в `BOM_REVISION` не создаёт.

---

## 6. Производительность — главные узкие места

### P1. Одна правка → полная пересборка всех 5 проекций
Все обработчики (`v12HandleDeficitEdit/RangeEdit`, `v12HandlePickingEdit`, `v12SetRealDeliveryQty`, `v12MarkReceivedByProduction`, `v12ReturnFromArchive`) вызывают `v12RefreshProjections()` = 5 полных пересборок (`clearBody` + запись всех строк + переустановка чекбоксов + перекраска фона).
**Ускорение:** пересобирать только затронутые проекции (ORDERED/EXPECTED → сводка+СНАБЖЕНИЕ+Dashboard; REAL_DELIVERY → сводка+ОТБОРКА+WORKING BOM+СНАБЖЕНИЕ+Dashboard; передача → ОТБОРКА+WORKING BOM+Dashboard), агрегаты — реже (debounce).

### P2. `POSITION_STATE` читается 5–6 раз за один `onEdit`
Каждый из `v12RefreshDeficitSummary`, `v12RefreshPicking`, `v12RefreshWorkingBOM`, `v12RefreshSupply`, `v12AggregateBomStates` делает `v12ReadSheet("POSITION_STATE")`; плюс `v12HarvestDeficitInput` строит индекс (ещё чтение).
**Ускорение:** читать лист **один раз** и прокидывать матрицу во все пересборщики (сигнатуры уже принимают `data`/`index`).

### P3. `v12GetWarehouseQtyForPositionRow` — на каждую позицию, и результат выбрасывается
Он **игнорирует** переданный `index` и вызывает `v12GetWarehouseQty(materialKey)` без индекса → `v12BuildMaterialIndex()` → полное чтение `MATERIAL_STATE` **на каждую строку**. А `v12CalculatePositionState` `warehouseQty` не использует вовсе.
**Ускорение:** удалить мёртвый вход склада (тогда вызов исчезнет) либо строить индекс склада один раз.

### P4. `v12HarvestDeficitInput` сканирует весь лист сводки на каждом пересчёте
Читает `DEFICIT_SUMMARY` + строит `v12BuildPositionIndex()` (чтение `POSITION_STATE`), потенциально пишет.
**Ускорение:** ограничивать изменёнными строками (`e.range`) или переносить на time-триггер.

### P5. Повторное построение индексов
`v12BuildPositionIndex`, `v12BuildMaterialIndex`, `v12BuildRevisionDateMap` (читается дважды за refresh), `v12BuildExcludedMap`, `v12AggregateReservations` — многократно за execution.
**Ускорение:** per-execution-кэш (глобальная переменная с инвалидацией на границах запуска).

### P6. `v12SyncBOM` строит полный индекс POSITION_STATE **для каждого BOM** (при 2000 BOM — 2000 чтений).
**Ускорение:** один индекс (`Map<bomId, Map<pid,row>>`) на весь `v12RunFullSync`.

### P7. `v12ApplySourceRevision` пишет каждую изменённую позицию отдельным `batchWrite`.
**Ускорение:** накопить `writes` по всем позициям, один `batchWrite`.

### P8. Форматирование/валидации переустанавливаются при каждом пересчёте
`clearDataValidations()`+`setDataValidation()` на весь столбец × 3 листа; `setBackgrounds()` на весь диапазон; `setConditionalFormatRules()` на каждый refresh Dashboard; `setNotes()` по всем строкам; `requireValueInList([...все проекты...])` на B1 при каждом пересчёте ОТБОРКИ (лимит ~500 пунктов).
**Ускорение:** ставить чекбоксы/правила/список один раз в `v12EnsureAllSheets`/`v12Install`; перекрашивать только изменённые строки.

### P9. `SpreadsheetApp.flush()` в горячем пути (иногда дважды за операцию) — замедляет правку.
**Ускорение:** считать проекции из in-memory массива (P2) → flush в горячем пути не нужен.

### P10. Прочее
Даты/`new Date()` по каждой строке; `localeCompare(...,"ru")` в сортировке (медленный — предвычислить ключ); `getLastColumn/Row` вызывать один раз.

**Оценка эффекта:** P1–P3+P8 сокращают число обращений к SpreadsheetApp на одну правку с **десятков–сотен** до **единиц**.

---

## 7. Ошибки логики и конфликты

- **B1 (латентный, критично).** `v12UpsertSourceBOM` возвращает `{bomId, created, changed}` — **без `bomName` и `sourceRevision`**, а `v12ApplySourceRevision` использует `registry.sourceRevision`/`registry.bomName` → в колонку «Ревизия» пишется `undefined` (спасает только `|| 1`), имя не теряется лишь потому, что `bomId === bomName`. Проявится при первой реальной синхронизации. **Исправление:** возвращать `sourceRevision`/`bomName`.
- **B2.** `v12AggregateBomStates` никогда не инкрементирует `late` → статус Dashboard «Ожидание поставки (опаздывает)» и его цвет — мёртвые; опаздывающие BOM показываются как «в срок».
- **B3.** `warehouseQty` в расчётном движке не используется → физический склад не влияет на решения по позиции (и порождает нагрузку P3).
- **B4.** `v12RecalculateWarehouseConsistency()` возвращает несоответствия, но в `v12RunFullSync` результат **выбрасывается**; `FLAGS.RESERVATION_PHYSICAL_INCONSISTENCY` (ТЗ №30) не проставляется никогда.
- **B5.** Передача из WORKING BOM неработоспособна: `PRODUCTION_STATE` (кол. 13) — текстовый статус, не чекбокс; `v12IsChecked("На складе")` = false → передача никогда не срабатывает (`SOURCE_UI.WORKING_BOM`, `WORKING_BOM_CHECKBOX` — мёртвые).
- **B6.** Регистровая ловушка статусов: сводка `"…(в Срок)"` (заглавная С) vs Dashboard `"…(в срок)"` (строчная) — правка строки в одном месте ломает сверку в другом.
- **B7.** Чекбокс «Реальная поставка» фиксирует только **полную** поставку (`= required`); частичная возможна лишь программно; в UI поля количества нет.
- **B8.** `v12Diagnostic` и `v12ConsistencyCheck` возвращают отчёт, но не показывают его (`alert`/`toast` не вызывается) — пункты меню «ничего не делают».
- **B9.** `v12OnEdit` держит ScriptLock (`LOCK_TIMEOUT=30000`) на всё время полной пересборки 5 проекций; при превышении правка молча теряется.
- **B10.** `v12RevertEdit` не восстанавливает диапазонные правки (`e.oldValue` только для одной ячейки).
- **B11.** Асимметрия guard'а строки заголовка в ОТБОРКЕ (range-обработчик vs одиночный).
- **B12.** Два пункта меню на одну функцию `v12RunFullSync`.
- **B13.** Диапазонная правка сводки без права не откатывается (в отличие от ОТБОРКИ).

---

## 8. Инварианты и скрытые допущения
1. `positionId` стабилен = `bomId:materialKey`; переименование BOM = новый BOM; смена кода материала = новая позиция (старая → REMOVED).
2. `SOURCE_REVISION` растёт только при смене хэша исходных материалов (порядок строк стабилизируется sort).
3. `availableForProduction = reserved + realDelivery` — это не «склад минус резерв»; склад в расчётах не участвует.
4. Передача производству идемпотентна и списывает `required` со склада (`Math.max(0,...)`).
5. Схема меняется через конфиг + миграции; данные строк не мигрируются.
6. `_lockDepth` делает ScriptLock реентрантным в пределах execution.
7. **`V12_ROLE_MAP` пуст → RBAC фактически отключён, все = ADMIN.** Все проверки прав сейчас no-op. Заполнить перед продакшеном.
8. `claspignore` исключает `_local_tests/` (в GAS нет `require`/`vm`).
9. `getSheetByName` работает через `SpreadsheetApp.getActive()` (скрипт привязан к таблице).
10. Совместное редактирование защищено только ScriptLock; harvest — единственная страховка от потери правок.

---

## 9. План устранения (для Act Mode)

**Этап 1 — Производительность:** (1) один read `POSITION_STATE` на execution; (2) пересборка только затронутых проекций; (3) удалить мёртвый `warehouseQty` и массовые вызовы склада; (4) вынести чекбоксы/форматирование/списки из горячего пути; (5) `v12RunFullSync` — один индекс и один батч; (6) убрать лишние `flush()`.

**Этап 2 — Логика:** (7) починить возврат `sourceRevision`/`bomName`; (8) реализовать `late`/`onTime`; (9) определиться с WORKING BOM; (10) писать `BOM_REVISION`/`MATERIAL_HISTORY` или удалить их; (11) проставлять `RESERVATION_PHYSICAL_INCONSISTENCY` или логировать; (12) показывать результат диагностики; (13) унифицировать статусный словарь.

**Этап 3 — Чистка:** (14) удалить мёртвые функции (5.1) и конфиг (5.2); (15) убрать дубль меню; (16) заполнить `V12_ROLE_MAP`.

---

## 10. Что не проверено (нужен прогон в Apps Script)
`v12RunFullSync` целиком (там сидит B1); поведение `getDataRange()`/`requireValueInList` на реальных объёмах и лимит 6 мин; `onEdit` чекбоксов в реальной локали; совместная работа под ScriptLock (B9).

## 11. Рекомендуемый порядок чтения
1. `v12_config.js` (схема) → 2. `v12_calculate.js` (ядро расчёта) → 3. `v12_position_state.js` → 4. `v12_trigger.js` (как правки доходят до состояния) → 5. `v12_projections.js` (узкие места) → 6. `v12_change_engine.js` + `v12_source.js` (баг B1) → 7. `v12_handoff.js`.

## 12. Резюме
- Архитектура (**SOURCE ≠ STATE ≠ VIEW**, чистый движок, центральное `POSITION_STATE`, буферизованные журналы, реентрантный lock) — **хорошая**, её стоит сохранить.
- **Главная проблема — производительность:** один edit = полная пересборка 5 проекций с многократным чтением `POSITION_STATE` и `MATERIAL_STATE`. Ключ — P1–P3 и P8.
- **Логика:** подтверждён латентный баг синхронизации (B1), недостижимый Dashboard-статус (B2), мёртвый вход склада (B3), неработающий контроль ТЗ №30 (B4), нерабочая передача из WORKING BOM (B5), регистровая ловушка статусов (B6).
- **Мёртвый код:** ~14 неиспользуемых функций, ~8 групп конфига, 3 листа-подсистемы без писателя (`EVENT_LOG`, `MATERIAL_HISTORY`, `BOM_REVISION`).
- **Недостающее:** RBAC не активирован, UI не поддерживает частичную поставку, диагностика не показывает результат.

---

Я в **Explore Mode** — могу анализировать и документировать, но не вносить изменения. Чтобы реализовать любую из правок (P1–P10, B1–B13, чистку мёртвого кода), переключитесь в **Act Mode** — этот отчёт (`project_info__28.md`) перенесётся как контекст. Готов углубиться в любой пункт по вашему запросу (например, расписать точный diff для P1–P3 или восстановить недостающие записи в `BOM_REVISION`/`MATERIAL_HISTORY`).