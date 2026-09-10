# BOM CONTROL SYSTEM V12 — Как работает столбец «Передано» на листе «ОТБОРКА»

## Краткий ответ

На листе **ОТБОРКА** (`V12_CONFIG.SHEETS.PICKING = "ОТБОРКА"`) за передачу отвечают **две** колонки:

| Кол. | Заголовок в листе | Поле конфига | Значение |
|------|-------------------|--------------|----------|
| 11 | `ProductionState` | `PICKING_COLUMNS.PRODUCTION_STATE` | текст статуса производства; при `RECEIVED` → строка **«Передано»** |
| 12 | `Отметка получено` | `PICKING_COLUMNS.CHECKBOX` | чекбокс — это и есть действие передачи |

> **ОБНОВЛЕНИЕ:** из листа ОТБОРКА удалены две колонки: «Передано (кол-во)» (`PICKING_COLUMNS.RECEIVED_QTY`; всегда 0, не читалась кодом) и «Складской остаток» (`PICKING_COLUMNS.WAREHOUSE_QTY`; физический остаток материала). Теперь лист содержит 13 колонок (`COLUMN_COUNT.PICKING = 13`), а `UPDATED_AT` занимает кол. 13.

**Суть:** текст «Передано» (кол. 11 `ProductionState`) на листе ОТБОРКА **никогда не отображается** для видимых строк. Передачу запускает **чекбокс в кол. 12**, а после успешной передачи строка **исчезает из ОТБОРКИ** (уходит в архив). То есть «Передано» — это не «отметка, которую видно на листе», а **момент, после которого строки на листе уже нет**.

---

## Как устроен лист ОТБОРКА

Определение колонок — `v12_config.js`, `PICKING_COLUMNS` (и дублирующие заголовки в `HEADERS.PICKING`):

```
1  Position ID                 (POSITION_ID)
2  BOM                          (BOM_NAME)
3  Строка                       (BOM_ROW)
4  Код                          (MATERIAL_CODE)
5  Наименование                 (MATERIAL_NAME)
6  Модель                       (MODEL)
7  Ед.изм                       (UNIT)
8  Требуется                    (REQUIRED_QTY)
9  Зарезервировано              (RESERVED_QTY)
10 Доступно для производства    (AVAILABLE_FOR_PRODUCTION)
11 ProductionState              (PRODUCTION_STATE)  <-- сюда маппится текст «Передано»
12 Отметка получено             (CHECKBOX)          <-- ЭТО действие передачи
13 Обновлено                    (UPDATED_AT)
```

Общее число колонок — `COLUMN_COUNT.PICKING = 13` (колонки `RECEIVED_QTY` «Передано (кол-во)» и `WAREHOUSE_QTY` «Складской остаток» удалены; `UPDATED_AT` сместился 15 → 13).

---

## Что именно показывают «передаточные» колонки

### Колонка 11 `ProductionState` — текст статуса
Заполняется в `v12RefreshPicking()` (`v12_projections.js`) через `v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1])`.

Функция `v12ProductionStatusDisplay` (`v12_projections.js`) маппит `PRODUCTION_STATE` в русский текст:

| `PRODUCTION_STATE` | Текст в листе |
|--------------------|----------------|
| `NOT_AVAILABLE` | «Нет в наличии» |
| `PARTIALLY_AVAILABLE` | «Частично доступно» |
| `READY_FOR_HANDOFF` | «На складе» |
| `RECEIVED` | **«Передано»** |

`PRODUCTION_STATE` вычисляется в едином движке `v12CalculatePositionState()` (`v12_calculate.js`, п. 6): `RECEIVED` ставится **только если** `receivedByProduction === true`. Иначе позиция получает `READY_FOR_HANDOFF`, `PARTIALLY_AVAILABLE` или `NOT_AVAILABLE` в зависимости от `availableForProduction = reservedQty + realDeliveryQty` против `requiredQty`.

### Колонки `Передано (кол-во)` и `Складской остаток` — **УДАЛЕНЫ**
- **`Передано (кол-во)` (`RECEIVED_QTY`)** заполнялась значением `POSITION_STATE.RECEIVED_BY_PRODUCTION_QTY` (поле № 16) и всегда была равна 0 для видимых строк (переданные позиции исключаются из проекции, при возврате значение обнуляется). Значение по-прежнему хранится в `POSITION_STATE` (кол. 16) и попадает в лист «Архив».
- **`Складской остаток` (`WAREHOUSE_QTY`)** заполнялась `MATERIAL_STATE.WAREHOUSE_QTY` — физическим остатком материала (глобально по `materialKey`). Не читалась кодом (готовность определяется `availableForProduction`, а не складом) и не дублировала другие колонки, но по решению убрана для компактности листа.

Обе колонки удалены из `PICKING_COLUMNS`/`HEADERS.PICKING`; миграция `v12MigratePickingSchema` удаляет их с существующего листа.

---

## Как формируется лист (`v12RefreshPicking`)

`v12RefreshPicking()` (`v12_projections.js`) читает `POSITION_STATE` и включает в лист только строки, прошедшие **все** фильтры:

```js
const lc = r[P.LIFECYCLE_STATE - 1];
if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) continue;   // только ACTIVE
if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) continue;   // НЕ переданные
```

Затем для каждой оставшейся строки:
- для кол. 11 берётся `v12ProductionStatusDisplay(PRODUCTION_STATE)`;
- для кол. 12 жёстко пишется `false` (чекбокс всегда сбрасывается при пересборке);
- кол. 13 `UPDATED_AT` = текущее время.

Далее лист очищается (`v12ClearBody("PICKING")`), строки пишутся заново (`v12WriteRows`), заново ставятся чекбоксы (`v12InstallPickingCheckboxes`) и окраска (`v12ApplyPickingColors`: «На складе» → голубой `COLORS.STOCK`, остальное — белый).

### **Ключевой вывод (неочевидное поведение)**
Так как строка с `RECEIVED_BY_PRODUCTION = true` **отфильтровывается**, на листе ОТБОРКА:
- кол. 11 **никогда не покажет «Передано»** — переданная позиция уже исключена из выборки;
- реально видимые значения кол. 11-статуса — только «Нет в наличии», «Частично доступно», «На складе».

Отображаемая здесь деятельность — это статус готовности к передаче («На складе»), а не факт передачи.

---

## Что реально выполняет передачу — чекбокс (кол. 12)

### Одиночная отметка
`v12OnEdit` (`v12_trigger.js`) → для листа ОТБОРКА → `v12HandlePickingEdit(e)`:

1. Если колонка ≠ 12 (`K.CHECKBOX`) — правка откатывается (`v12RevertEdit`), меняется только чекбокс.
2. Берётся `positionId` из кол. 1 этой строки.
3. Если чекбокс отмечен — вызывается `v12MarkReceivedByProduction(positionId, "PICKING")`.
4. Если результат `blocked` — чекбокс откатывается и показывается `alert("Не удалось передать: " + reason)`.

### Диапазонная отметка (выделение нескольких чекбоксов)
`v12OnEdit` распознаёт `isPickingRange` (несколько ячеек на листе ОТБОРКА) → `v12HandlePickingRangeEdit(e)`:
- обходит **все** отмеченные строки диапазона;
- для каждой вызывает `v12MarkReceivedByProduction(..., skipRefresh = true)`;
- блокированные строки — снимает галочку;
- пересчёт проекций делается **один раз** в конце (`v12RefreshProjections()`), чтобы не пересобирать лист на каждую строку.

### Страховка от потери отметок
В начале `v12RefreshPicking()` вызывается `v12HarvestPickingInput()`: если в листе остались отмеченные чекбоксы, для которых передача ещё не зафиксирована, она выполняется идемпотентно (`skipRefresh = true`). Это защита от пропущенных/наложившихся `onEdit` (быстрое массовое проставление).

---

## Цепочка передачи — `v12MarkReceivedByProduction(positionId, sourceUI, skipRefresh)`

Файл `v12_handoff.js`. Единая идемпотентная операция (ТЗ №25–27, №96):

1. Захват скрипт-блокировки (`acquireScriptLock`), проверка роли (`v12RequireRole` — для PICKING действие `PICKING_CHECKBOX`).
2. `blocked`, если позиция не найдена.
3. **Идемпотентность:** если `RECEIVED_BY_PRODUCTION === true` и `receivedByProductionQty >= requiredQty` → `{status:"already"}` (ничего не делается).
4. **Валидация (ТЗ №24/№106):**
   - `validation !== VALID` → `blocked` («Позиция невалидна…»);
   - `availableForProduction < requiredQty` → `blocked` («Не хватает доступного количества…»).
5. Фиксация в `POSITION_STATE`: `RECEIVED_BY_PRODUCTION = true`, `RECEIVED_BY_PRODUCTION_QTY = requiredQty`, `RECEIVED_BY_PRODUCTION_AT = new Date()`, `RECEIVED_BY_PRODUCTION_USER = текущий пользователь`.
6. **Архивация:** `v12ArchivePosition()` добавляет строку в лист `Архив` и ставит `LIFECYCLE_STATE = ARCHIVED`. Именно из-за этого строка исчезает из ОТБОРКИ.
7. **Списание со склада:** `v12AdjustWarehouseQty(materialKey, -requiredQty)` — резерв перешёл в производство, `MATERIAL_STATE.WAREHOUSE_QTY` уменьшается (с защитой от ухода ниже 0).
8. **Аудит:** `v12Audit({action: PRODUCTION_HANDOFF, field: "RECEIVED_BY_PRODUCTION", oldValue:false, newValue:true, reason:"Передано производству из PICKING"})`.
9. Если `skipRefresh` не задан — `v12RefreshProjections()` (пересборка всех проекций; при массовой передаче вызывается один раз снаружи).
10. Ошибки → аудит с `field:"ERROR"` + `logSystem`, возврат `{status:"blocked"}`.

Возврат из архива (`v12ReturnFromArchive`) обнуляет `RECEIVED_BY_PRODUCTION_QTY` и возвращает количество на склад, поэтому возвращённая позиция снова появляется в ОТБОРКЕ.

---

## Неочевидные поведения и подводные камни (ОТБОРКА)

1. **«Передано» на ОТБОРКЕ не видно.** Передача делает `LIFECYCLE_STATE = ARCHIVED` и `RECEIVED_BY_PRODUCTION = true`, а проекция `v12RefreshPicking` фильтрует такие строки (`lc !== ACTIVE` и `received === true`). Поэтому кол. 11 никогда не показывает «Передано». Единственное «видимое» последствие передачи — **строка исчезла** из листа (и появилась в «Архиве»).
2. Полезный статус здесь — кол. 11 со значением **«На складе»** (`READY_FOR_HANDOFF`) и голубая подсветка строки.
3. **Передача возможна только при полной доступности.** `availableForProduction (= reservedQty + realDeliveryQty) >= requiredQty`. Чекбокс активен визуально всегда (валидация данных ставится на все строки), но при клике на неготовую строку будет `alert` и откат.
4. **Чекбокс обнуляется при любой пересборке листа** (в `v12RefreshPicking` пишется `false`). Это безопасно только потому, что отмеченная строка сразу уходит в архив; для «застрявших» отметок работает `v12HarvestPickingInput`.
5. **Передача — идемпотентная и защищена блокировкой** (`acquireScriptLock`), поэтому двойной клик/двойная обработка не создают двух передач и двух строк в архиве (ТЗ №127: 1 handoff = 1 архив).
6. **Побочный эффект на физ. склад:** передача уменьшает `MATERIAL_STATE.WAREHOUSE_QTY` на `requiredQty`. Если склад был недостаточен, значение «зажимается» до 0 — инвариант `WAREHOUSE_QTY >= 0` соблюдается всегда.
7. **Блокированные строки снимают галочку** (и в одиночном, и в диапазонном режиме) — это защита от «залипших» отметок, но она же означает, что при сбое пользователь не увидит, что именно не прошло, кроме `alert` (при массовой отметке — без деталей по каждой строке).
8. **Русские заголовки — «канон»** (`HEADERS.PICKING`), но программирование ведётся по числовым константам `PICKING_COLUMNS`. Изменение порядка колонок на листе без правки конфига сломает сопоставление.

---

## Модульная ссылка (файлы, участвующие в логике «передано» на ОТБОРКЕ)

| Файл | Роль |
|------|------|
| `v12_config.js` | `PICKING_COLUMNS` (11=ProductionState, 12=CHECKBOX, 13=UPDATED_AT), `PRODUCTION_STATE`, `HEADERS.PICKING`, `SOURCE_UI` |
| `v12_projections.js` | `v12RefreshPicking` — построение листа; `v12ProductionStatusDisplay` — маппинг «Передано»; `v12InstallPickingCheckboxes`, `v12ApplyPickingColors`, `v12HarvestPickingInput` |
| `v12_sheet_service.js` | `v12MigratePickingSchema` — удаление устаревших колонок ОТБОРКИ при установке |
| `v12_trigger.js` | `v12OnEdit` → `v12HandlePickingEdit` (одиночная), `v12HandlePickingRangeEdit` (диапазон/автозаполнение, `isPickingRange`) |
| `v12_handoff.js` | `v12MarkReceivedByProduction` — идемпотентная передача, архивация, списание со склада, аудит |
| `v12_calculate.js` | `v12CalculatePositionState` — расчёт `PRODUCTION_STATE` (`RECEIVED`/`READY_FOR_HANDOFF`/…) |
| `v12_position_state.js` | `POSITION_COLUMNS` (16=`RECEIVED_BY_PRODUCTION_QTY`, 17=`RECEIVED_BY_PRODUCTION`, 18/19 — дата/кто), `v12ApplyComputedToRow` |
| `_local_tests/v12_picking_schema_test.js` | Схема ОТБОРКИ и миграция (C1–C5) |
| `_local_tests/v12_delivery_test.js` | Сценарий S9 — массовая отметка чекбоксов передачи в ОТБОРКЕ |

---

## Ответ одной фразой

Колонка «Передано» на листе ОТБОРКА **не отображает факт передачи**: текст «Передано» в кол. 11 `ProductionState` по построению недостижим, потому что `v12RefreshPicking` исключает переданные строки (`RECEIVED_BY_PRODUCTION=true` и `LIFECYCLE_STATE=ARCHIVED`). Передачу выполняет **чекбокс кол. 12**, который вызывает `v12MarkReceivedByProduction(positionId, "PICKING")` — идемпотентно, только при полной доступности; после этого строка **исчезает** из ОТБОРКИ, уходит в «Архив», а её количество списывается из `MATERIAL_STATE.WAREHOUSE_QTY`.
