# Как работает столбец «Передано» на листе «ОТБОРКА»

_(Сохранено в `project_info__19.md`)_

## Краткий ответ

На листе **ОТБОРКА** (`V12_CONFIG.SHEETS.PICKING = "ОТБОРКА"`) есть **две** колонки, связанные с «передано»:

| Кол. | Заголовок | Поле конфига | Значение |
|------|-----------|--------------|----------|
| 12 | `ProductionState` | `PICKING_COLUMNS.PRODUCTION_STATE` | текст статуса; при `RECEIVED` → **«Передано»** |
| 13 | `Отметка получено` | `PICKING_COLUMNS.CHECKBOX` | чекбокс — **это и есть действие передачи** |
| 14 | `Передано (кол-во)` | `PICKING_COLUMNS.RECEIVED_QTY` | число `receivedByProductionQty` |

**Суть:** сам «столбец передано» (кол. 14 «Передано (кол-во)» и текст «Передано» в кол. 12) на ОТБОРКЕ **практически всегда пуст/0** для видимых строк. Передачу запускает **чекбокс в кол. 13**, а после успешной передачи строка **исчезает из ОТБОРКИ** (уходит в архив). То есть «Передано» — это не отметка, которую видно на листе, а **момент, после которого строки на листе уже нет**.

---

## Структура листа ОТБОРКА

Определение — `v12_config.js`, `PICKING_COLUMNS` (+ дублирующие русские заголовки в `HEADERS.PICKING`):

```
1  Position ID              (POSITION_ID)
2  BOM                       (BOM_NAME)
3  Строка                    (BOM_ROW)
4  Код                       (MATERIAL_CODE)
5  Наименование              (MATERIAL_NAME)
6  Модель                    (MODEL)
7  Ед.изм                    (UNIT)
8  Требуется                 (REQUIRED_QTY)
9  Зарезервировано           (RESERVED_QTY)
10 Доступно для производства (AVAILABLE_FOR_PRODUCTION)
11 Складской остаток         (WAREHOUSE_QTY)
12 ProductionState           (PRODUCTION_STATE)  <-- сюда маппится текст «Передано»
13 Отметка получено          (CHECKBOX)          <-- ЭТО действие передачи
14 Передано (кол-во)         (RECEIVED_QTY)      <-- receivedByProductionQty
15 Обновлено                 (UPDATED_AT)
```
Всего — `COLUMN_COUNT.PICKING = 15`.

---

## Что показывают «передаточные» колонки

### Колонка 12 `ProductionState` (текст)
Заполняется в `v12RefreshPicking()` (`v12_projections.js`) через `v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1])`:

| `PRODUCTION_STATE` | Текст в листе |
|--------------------|----------------|
| `NOT_AVAILABLE` | «Нет в наличии» |
| `PARTIALLY_AVAILABLE` | «Частично доступно» |
| `READY_FOR_HANDOFF` | «На складе» |
| `RECEIVED` | **«Передано»** |

`PRODUCTION_STATE` считает единый движок `v12CalculatePositionState()` (`v12_calculate.js`, п. 6): `RECEIVED` ставится **только если** `receivedByProduction === true`; иначе `READY_FOR_HANDOFF` (когда `availableForProduction = reservedQty + realDeliveryQty >= requiredQty`) / `PARTIALLY_AVAILABLE` / `NOT_AVAILABLE`.

### Колонка 14 `Передано (кол-во)` (число)
Берётся из `POSITION_STATE.RECEIVED_BY_PRODUCTION_QTY` (поле №16 в `POSITION_COLUMNS`). Выставляется равным `requiredQty` в момент передачи и **обнуляется** при возврате из архива.

---

## Как формируется лист (`v12RefreshPicking`)

Читает `POSITION_STATE`, включает строки только при **всех** фильтрах:

```js
const lc = r[P.LIFECYCLE_STATE - 1];
if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) continue;   // только ACTIVE
if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) continue;   // НЕ переданные
```

Далее кол. 12 ← текст статуса; кол. 13 **жёстко пишется `false`** (при пересборке чекбокс всегда сбрасывается); кол. 14 ← `RECEIVED_BY_PRODUCTION_QTY`. Затем `v12ClearBody("PICKING")` + `v12WriteRows`, заново чекбоксы (`v12InstallPickingCheckboxes`) и окраска (`v12ApplyPickingColors`: «На складе» → голубой `COLORS.STOCK`, остальное — белый).

### ⚠️ Ключевой вывод
Так как строка с `RECEIVED_BY_PRODUCTION = true` **отфильтровывается**, на ОТБОРКЕ:
- кол. 12 **никогда не покажет «Передано»** — переданная позиция уже исключена;
- кол. 14 «Передано (кол-во)» для видимых строк **всегда 0**;
- реально видимые значения кол. 12 — только «Нет в наличии», «Частично доступно», **«На складе»**.

Обе «передаточные» колонки на ОТБОРКЕ фактически **мёртвые/дублирующие** — они описывают состояние, недостижимое в этой проекции. Полезный сигнал здесь — статус готовности «На складе» (`READY_FOR_HANDOFF`) и голубая подсветка строки.

---

## Что реально выполняет передачу — чекбокс (кол. 13)

**Одиночная отметка:** `v12OnEdit` (`v12_trigger.js`) → `v12HandlePickingEdit(e)`:
1. колонка ≠ 13 → `v12RevertEdit(e)` (менять можно только чекбокс);
2. берётся `positionId` из кол. 1;
3. чекбокс отмечен → `v12MarkReceivedByProduction(positionId, "PICKING")`;
4. результат `blocked` → откат чекбокса + `alert("Не удалось передать: " + reason)`.

**Диапазон (выделение нескольких чекбоксов):** распознаётся `isPickingRange` → `v12HandlePickingRangeEdit(e)`:
- обход **всех** отмеченных строк диапазона;
- для каждой `v12MarkReceivedByProduction(..., skipRefresh = true)`;
- блокированные — снять галочку;
- пересчёт проекций — **один раз** в конце (`v12RefreshProjections()`).

**Страховка:** в начале `v12RefreshPicking()` вызывается `v12HarvestPickingInput()` — «застрявшие» отметки, для которых передача не зафиксирована, выполняются идемпотентно. Защита от пропущенных/наложившихся `onEdit`.

---

## Цепочка передачи — `v12MarkReceivedByProduction(positionId, sourceUI, skipRefresh)`

Файл `v12_handoff.js`. Единая идемпотентная операция (ТЗ №25–27, №96):

1. `acquireScriptLock` + проверка роли (`v12RequireRole`, для PICKING — `PICKING_CHECKBOX`).
2. `blocked`, если позиция не найдена.
3. **Идемпотентность:** если `RECEIVED_BY_PRODUCTION === true` и `receivedByProductionQty >= requiredQty` → `{status:"already"}`.
4. **Валидация (ТЗ №24/№106):** `validation !== VALID` → `blocked`; `availableForProduction < requiredQty` → `blocked` («Не хватает доступного количества…»). **Частичная передача запрещена.**
5. Фиксация в `POSITION_STATE`: `RECEIVED_BY_PRODUCTION = true`, `RECEIVED_BY_PRODUCTION_QTY = requiredQty`, `..._AT = now`, `..._USER = текущий пользователь`.
6. **Архивация** (`v12ArchivePosition`): строка → лист `Архив`, `LIFECYCLE_STATE = ARCHIVED`. **Из-за этого строка исчезает из ОТБОРКИ.**
7. **Списание со склада:** `v12AdjustWarehouseQty(materialKey, -requiredQty)` на `MATERIAL_STATE.WAREHOUSE_QTY` (с зажимом до 0).
8. **Аудит:** `action = PRODUCTION_HANDOFF`, `field = RECEIVED_BY_PRODUCTION`, `reason = "Передано производству из PICKING"`.
9. `skipRefresh` не задан → `v12RefreshProjections()` (при массовой передаче — один раз снаружи).
10. Ошибки → аудит `field:"ERROR"` + `logSystem`, `{status:"blocked"}`.

Возврат (`v12ReturnFromArchive`) обнуляет `RECEIVED_BY_PRODUCTION_QTY` и возвращает количество на склад, поэтому возвращённая позиция снова появляется в ОТБОРКЕ с «Передано (кол-во)» = 0.

---

## Неочевидные поведения / подводные камни

1. **«Передано» на ОТБОРКЕ не видно.** Передача ставит `LIFECYCLE_STATE=ARCHIVED` и `RECEIVED_BY_PRODUCTION=true`, а `v12RefreshPicking` такие строки отбрасывает. Кол. 12 никогда не покажет «Передано», кол. 14 всегда 0. Единственный видимый эффект — **строка исчезла с листа** (появилась в «Архиве»).
2. **Две «передаточные» колонки дублируют друг друга и обе неинформативны** на этом листе.
3. **Передача только при полной доступности** (`reserved + realDelivery >= required`). Визуально чекбокс активен всегда (валидация данных ставится на все строки), но на неготовой строке будет `alert` и откат.
4. **Чекбокс обнуляется при любой пересборке листа** — безопасно лишь потому, что отмеченная строка сразу уходит в архив; для «залипших» работает `v12HarvestPickingInput`.
5. **Идемпотентность + блокировка** — двойной клик не создаёт двух передач/архивных строк (ТЗ №127: 1 handoff = 1 архив).
6. **Побочный эффект:** передача уменьшает `MATERIAL_STATE.WAREHOUSE_QTY` на `requiredQty` (инвариант `>= 0` соблюдается).
7. **При массовой передаче нет деталей по каждой ошибке** — только снятие галочки; одиночная даёт `alert`.
8. **Заголовки — русский «канон», а код завязан на числовые `PICKING_COLUMNS`** — смена порядка колонок на листе без правки конфига сломает сопоставление.

---

## Модульная ссылка

| Файл | Роль |
|------|------|
| `v12_config.js` | `PICKING_COLUMNS` (12=ProductionState, 13=CHECKBOX, 14=RECEIVED_QTY), `PRODUCTION_STATE`, `HEADERS.PICKING`, `SOURCE_UI` |
| `v12_projections.js` | `v12RefreshPicking`, `v12ProductionStatusDisplay` (маппинг «Передано»), `v12InstallPickingCheckboxes`, `v12ApplyPickingColors`, `v12HarvestPickingInput` |
| `v12_trigger.js` | `v12OnEdit` → `v12HandlePickingEdit` (одиночная), `v12HandlePickingRangeEdit` (диапазон, `isPickingRange`) |
| `v12_handoff.js` | `v12MarkReceivedByProduction` — идемпотентная передача, архивация, списание со склада, аудит |
| `v12_calculate.js` | `v12CalculatePositionState` — расчёт `PRODUCTION_STATE` |
| `v12_position_state.js` | `POSITION_COLUMNS` (16=`RECEIVED_BY_PRODUCTION_QTY`, 17=`RECEIVED_BY_PRODUCTION`, 18/19 — дата/кто), `v12ApplyComputedToRow` |
| `_local_tests/v12_delivery_test.js` | Сценарий S9 — массовая отметка чекбоксов передачи |

---

## Ответ одной фразой

Столбец «Передано» на ОТБОРКЕ **не отображает факт передачи** — он (как и текст «Передано» в кол. `ProductionState`) по построению пуст/0, потому что `v12RefreshPicking` исключает переданные строки (`RECEIVED_BY_PRODUCTION=true` / `LIFECYCLE_STATE=ARCHIVED`). Передачу выполняет **чекбокс кол. 13** → `v12MarkReceivedByProduction(positionId, "PICKING")` — идемпотентно и только при полной доступности; после этого строка **исчезает** из ОТБОРКИ, уходит в «Архив», а её количество списывается из `MATERIAL_STATE.WAREHOUSE_QTY`.

---

Если хотите, могу углубиться: например, показать, что именно видит кладовщик в момент клика, разобрать взаимодействие ОТБОРКА ↔ WORKING BOM (два интерфейса, одна передача), или посмотреть, насколько колонки «Передано» стоит переиспользовать (например, показывать частичную передачу). Уточните направление.