# BOM CONTROL SYSTEM V12 — Правка «Сводки дефицитов»: только дефицит > 0 и без колонок «Требуется»/«Зарезервировано»

## Требование (актуально, отменяет предыдущее «все BOM в сводку»)
1. В «Сводку дефицитов» (DEFICIT_SUMMARY) попадают материалы **только при наличии дефицита**: `deficit > 0` (т.е. `required > reserved`).
2. Удалить из сводки столбцы **«Требуется»** (REQUIRED_QTY) и **«Зарезервировано»** (RESERVED_QTY). Снабжению важно только количество дефицита.

## Что меняется

### 1. Фильтр `deficit > 0` — `v12_projections.js`, `v12RefreshDeficitSummary`
Добавить после проверки «передано производству»:
```js
if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) {
  continue;
}
if (toNumber(r[P.DEFICIT_QTY - 1]) <= 0) {
  continue;   // нет дефицита — в сводку не берём
}
```
Это автоматически исключает позиции с `RESERVED` (reserved ≥ required → deficit 0) и `NO_REQUIREMENT` (required ≤ 0 → deficit 0).

### 2. Удалить колонки `REQUIRED_QTY` и `RESERVED_QTY`

**а) Строка записи** (`v12RefreshDeficitSummary`, массив `rows.push`): убрать
`r[P.REQUIRED_QTY - 1]` и `r[P.RESERVED_QTY - 1]`.

Новый вид (17 колонок):
```js
rows.push([
  r[P.POSITION_ID - 1],
  r[P.BOM_NAME - 1],
  r[P.BOM_ROW - 1],
  r[P.MATERIAL_CODE - 1],
  r[P.MATERIAL_NAME - 1],
  r[P.MODEL - 1],
  r[P.UNIT - 1],
  r[P.DEFICIT_QTY - 1],
  r[P.ORDERED_QTY - 1],
  r[P.UNCOVERED_NEED - 1],
  r[P.EXPECTED_DATE - 1],
  r[P.DEADLINE - 1],
  r[P.REAL_DELIVERY_QTY - 1],
  r[P.SUPPLY_STATE - 1],
  false,  // RECEIVED
  false,  // REAL_DELIVERY
  v12SupplyStatusDisplay(r[P.SUPPLY_STATE - 1], r[P.VALIDATION_STATUS - 1])
]);
```

**б) Конфиг** `V12_CONFIG.DEFICIT_COLUMNS` (переиндексация):
```js
DEFICIT_COLUMNS: {
  POSITION_ID: 1,
  BOM_NAME: 2,
  BOM_ROW: 3,
  MATERIAL_CODE: 4,
  MATERIAL_NAME: 5,
  MODEL: 6,
  UNIT: 7,
  DEFICIT_QTY: 8,
  ORDERED_QTY: 9,
  UNCOVERED_NEED: 10,
  EXPECTED_DATE: 11,
  DEADLINE: 12,
  REAL_DELIVERY_QTY: 13,
  SUPPLY_STATE: 14,
  RECEIVED: 15,
  REAL_DELIVERY: 16,
  STATUS: 17
}
```
`COLUMN_COUNT.DEFICIT_SUMMARY: 17` (было 19).

**в) Заголовки** `V12_CONFIG.HEADERS.DEFICIT_SUMMARY`:
```js
DEFICIT_SUMMARY: [
  "Position ID", "BOM", "Строка", "Код", "Наименование", "Модель", "Ед.изм",
  "Дефицит", "Заказано", "Непокрытая потребность", "Ожидаемая поставка",
  "Крайний срок", "Поставлено", "SupplyState", "Получено", "Реальная поставка", "Статус"
]
```

**г) `v12HandleDeficitEdit` (`v12_trigger.js`)** — сейчас читает `sheet.getRange(row, D.REQUIRED_QTY).getValue()` чтобы поставить реальную поставку = требование. Колонки `D.REQUIRED_QTY` больше нет → брать потребность из `POSITION_STATE`:
```js
function v12GetDeficitRequiredQty(positionId, index) {
  const pos = v12GetPositionById(positionId, index);
  const P = V12_CONFIG.POSITION_COLUMNS;
  return pos ? toNumber(pos.values[P.REQUIRED_QTY - 1]) : 0;
}
```
И в `v12HandleDeficitEdit` вместо `sheet.getRange(row, D.REQUIRED_QTY).getValue()`:
```js
const required = v12GetDeficitRequiredQty(positionId);
v12SetRealDeliveryQty(positionId, checked === true ? required : 0);
```
для веток `D.REAL_DELIVERY` и `D.RECEIVED`.

### 3. Проверить зависимые места
- `v12InstallDeficitCheckboxes` использует `D.RECEIVED`, `D.REAL_DELIVERY` — после переиндексации это 15/16; работает без изменений логики (только номера колонок из конфига).
- `v12HandleDeficitEdit` — `D.ORDERED_QTY` (9), `D.EXPECTED_DATE` (11), `D.REAL_DELIVERY` (16), `D.RECEIVED` (15) — обновляются автоматически из конфига; единственная ручная правка — `D.REQUIRED_QTY` -> получение из `POSITION_STATE`.
- Убедиться, что нигде больше не используется `D.REQUIRED_QTY` / `D.RESERVED_QTY` (по grep — только в `v12HandleDeficitEdit`).

## Единый признак «дефицита»
`deficit = max(0, required − reserved)` (из `v12_calculate.js`). `deficit > 0` ⇔ `required > reserved`. Фильтруем именно в проекции — `POSITION_STATE` не трогаем.

## Затрагиваемые файлы
- `v12_projections.js` — `v12RefreshDeficitSummary` (фильтр + удаление 2 колонок из `rows.push`).
- `v12_config.js` — `DEFICIT_COLUMNS`, `COLUMN_COUNT.DEFICIT_SUMMARY`, `HEADERS.DEFICIT_SUMMARY`.
- `v12_trigger.js` — `v12HandleDeficitEdit` (чтение `REQUIRED_QTY` из `POSITION_STATE` вместо колонки сводки).
