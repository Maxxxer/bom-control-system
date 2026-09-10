# BOM CONTROL SYSTEM V12 — План доработки: столбец «Ожидаемая поставка» + окраска строк в ОТБОРКЕ

> Замечание Explore-режима: это **документ-план**, а не реализация. Изменения
> кода в Explore-режиме не вносятся. Чтобы выполнить план — переключитесь в
> **Act Mode**. Этот файл остаётся как спецификация задачи.

## 1. Что требуется (из фидбэка)

1. Добавить в лист **ОТБОРКА** (`PICKING`) столбец **«Ожидаемый срок поставки»**
   справа от колонки `ProductionState` — со значением `expectedDate` позиции.
2. Подсветить **каждую строку** отборки по состоянию готовности материала:
   - **Красный** — материала нет: он **не заказан** или **заказан частично**.
   - **Жёлтый** — материала не хватает, но он **заказан**, и ожидаемый приход
     на склад планируется **до крайнего срока включительно**.
   - **Оранжевый** — материала не хватает, но он заказан, а приход планируется
     **после крайнего срока** (в фидбэке 3-е условие продублировано с 2-м и,
     вероятно, опечатка — трактуем как «опаздывает»; формулировка ниже
     подтверждается существующей логикой `v12DeficitStatusDisplay`).

## 2. Текущее состояние листа ОТБОРКА (12 колонок)

`V12_CONFIG.PICKING_COLUMNS` (после удаления «Зарезервировано»):

| # | Поле | Заголовок |
|---|------|-----------|
| 1 | POSITION_ID | Position ID |
| 2 | BOM_NAME | BOM |
| 3 | BOM_ROW | Строка |
| 4 | MATERIAL_CODE | Код |
| 5 | MATERIAL_NAME | Наименование |
| 6 | MODEL | Модель |
| 7 | UNIT | Ед.изм |
| 8 | REQUIRED_QTY | Требуется |
| 9 | AVAILABLE_FOR_PRODUCTION | Доступно для производства |
| 10 | PRODUCTION_STATE | Состояние |
| 11 | CHECKBOX | Отметка получено |
| 12 | UPDATED_AT | Обновлено |

`COLUMN_COUNT.PICKING = 12`.
Заголовок `HEADERS.PICKING` — 12 значений.
Строку собирает `v12RefreshPicking()` в `v12_projections.js` (массив из 12 ячеек).
Окраску делает `v12ApplyPickingColors(rows)` там же — сейчас только
«На складе» → голубой (`STOCK`), иначе белый.

## 3. Целевая схема (13 колонок)

Добавляем `EXPECTED_DATE` (уже существует в POSITION_STATE, кол. 14; отдельного
поля в POSITION_STATE создавать НЕ нужно) сразу после `PRODUCTION_STATE`:

| # | Поле | Заголовок |
|---|------|-----------|
| 1 | POSITION_ID | Position ID |
| 2 | BOM_NAME | BOM |
| 3 | BOM_ROW | Строка |
| 4 | MATERIAL_CODE | Код |
| 5 | MATERIAL_NAME | Наименование |
| 6 | MODEL | Модель |
| 7 | UNIT | Ед.изм |
| 8 | REQUIRED_QTY | Требуется |
| 9 | AVAILABLE_FOR_PRODUCTION | Доступно для производства |
| 10 | PRODUCTION_STATE | ProductionState |
| 11 | **EXPECTED_DATE** | **Ожидаемая поставка** |
| 12 | CHECKBOX | Отметка получено |
| 13 | UPDATED_AT | Обновлено |

`COLUMN_COUNT.PICKING` → **13**; `HEADERS.PICKING` → **13** элементов.

Важно: `PICKING_FILTER.CELL_COL = 2` (B1 = BOM_NAME) — не меняется, т.к.
новая колонка вставлена правее кол. 2. `CHECKBOX` сдвигается с 11 на **12**,
код, читающий чекбокс, использует `K.CHECKBOX` (без жёстких индексов), поэтому
сдвиг безопасен.

## 4. Точные правки по файлам

### 4.1 `v12_config.js`
- `COLUMN_COUNT.PICKING`: `12` → `13`.
- `PICKING_COLUMNS`: добавить `EXPECTED_DATE: 11`, сдвинуть
  `CHECKBOX: 11→12`, `UPDATED_AT: 12→13`. Итог:
  ```js
  PICKING_COLUMNS: {
    POSITION_ID: 1, BOM_NAME: 2, BOM_ROW: 3,
    MATERIAL_CODE: 4, MATERIAL_NAME: 5, MODEL: 6, UNIT: 7,
    REQUIRED_QTY: 8, AVAILABLE_FOR_PRODUCTION: 9,
    PRODUCTION_STATE: 10, EXPECTED_DATE: 11,
    CHECKBOX: 12, UPDATED_AT: 13
  },
  ```
- `HEADERS.PICKING`: вставить `"Ожидаемая поставка"` после `"ProductionState"`:
  ```js
  PICKING: [
    "Position ID", "BOM", "Строка", "Код", "Наименование", "Модель", "Ед.изм",
    "Требуется", "Доступно для производства", "ProductionState",
    "Ожидаемая поставка", "Отметка получено", "Обновлено"
  ],
  ```

### 4.2 `v12_projections.js` — `v12RefreshPicking()`
В массив строки (`rows.push([...])`) после `v12ProductionStatusDisplay(...)`
вставить `v12FormatDateOnly(r[P.EXPECTED_DATE - 1])` (кол. 11):
```js
rows.push([
  r[P.POSITION_ID - 1], bomName, r[P.BOM_ROW - 1],
  r[P.MATERIAL_CODE - 1], r[P.MATERIAL_NAME - 1], r[P.MODEL - 1], r[P.UNIT - 1],
  r[P.REQUIRED_QTY - 1], r[P.AVAILABLE_FOR_PRODUCTION - 1],
  v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1]),
  v12FormatDateOnly(r[P.EXPECTED_DATE - 1]),   // НОВОЕ — кол. 11
  false, // CHECKBOX
  new Date()
]);
```
`v12FormatDateOnly` уже есть в этом файле.

### 4.3 `v12_projections.js` — окраска (главное)
Сейчас `v12ApplyPickingColors(rows)` принимает проекцию и видит только
`PRODUCTION_STATE`-метку. Для новых правил нужны `supplyState`, `expected`,
`deadline` из POSITION_STATE. Два варианта:

**Вариант A (рекомендуемый):** при сборке строк в `v12RefreshPicking` рядом со
`rows` формировать параллельный массив цветов на основе исходной строки `r`
(в цикле доступны `P.SUPPLY_STATE`, `P.EXPECTED_DATE`, `P.DEADLINE`,
`P.PRODUCTION_STATE`), и передать его в `v12ApplyPickingColors(rows, colors)` /
сразу применять `setBackgrounds`.

**Вариант B:** передавать в `v12ApplyPickingColors` исходные строки `r`.

Логика цвета (соответствует уже существующему `v12DeficitStatusDisplay`):
```js
// «На складе» (READY_FOR_HANDOFF, available >= required) → голубой (как сейчас)
// materialType: не хватает:
//   supplyState === NOT_ORDERED   → красный
//   supplyState === PARTIALLY_ORDERED → красный
//   supplyState === ORDERED (и PARTIALLY_DELIVERED):
//       expected && deadline && expected <= deadline → жёлтый
//       expected && deadline && expected >  deadline → оранжевый
//       нет даты сравнения                             → белый/без окраски
```
Использовать `V12_CONFIG.COLORS.RED / YELLOW / ORANGE / STOCK / WHITE` и
`v12ToDate`/`v12DateValue` для разбора `expectedDate`/`deadline` (та же
толерантная нормализация, что в `v12DeficitStatusDisplay`).
Ширина фона — `COLUMN_COUNT.PICKING` (станет 13).

Пример опорной проверки «не хватает»: `toNumber(r[P.AVAILABLE_FOR_PRODUCTION-1]) < toNumber(r[P.REQUIRED_QTY-1])`
(или `productionState !== READY_FOR_HANDOFF`).

### 4.4 `v12_sheet_service.js` — миграция
`v12MigratePickingSchema()` перезаписывает строку заголовка `HEADERS.PICKING`
(теперь 13 значений) — правок в списке legacy-колонок НЕ требуется (новая
колонка добавляется, а не удаляется). Существующий лист допишет 13-й заголовок.

### 4.5 `v12_trigger.js`
Правок логики не требуется (`K.CHECKBOX`, `K.POSITION_ID`, `K.BOM_NAME`
используются динамически). Комментарии «кол. 11/12» при желании обновить.

### 4.6 `_local_tests/v12_picking_schema_test.js`
- `COLUMN_COUNT.PICKING` ожидать `13`; `HEADERS.PICKING.length` = `13`;
  `UPDATED_AT` = `13`; `CHECKBOX` = `12`; `EXPECTED_DATE` = `11`.
- Канонический `CANON` добавит `"Ожидаемая поставка"`.
- C5: тело строки = 13 колонок; кол. 10 = статус, кол. 11 = дата,
  кол. 12 = чекбокс, кол. 13 = дата обновления.
- При необходимости — тест окраски (можно мокать `setBackgrounds`).

## 5. Инварианты и подводные камни
- `EXPECTED_DATE` в POSITION_STATE **уже есть** (кол. 14) — заполняется из
  снабжения (`v12SetExpectedDate`) и подхватом из сводки
  (`v12HarvestDeficitInput`). В отборке колонка только отображает её.
- `CHECKBOX` с 11 → 12: все потребители используют `K.CHECKBOX`, жёстких
  индексов в рабочем коде нет (проверено grep). Единственное место с числом —
  комментарии.
- `v12InstallPickingCheckboxes` ставит валидацию чекбокса по `K.CHECKBOX` —
  сдвинется автоматически.
- `B1`-фильтр (`PICKING_FILTER.CELL_COL=2`) не затрагивается.
- `v12GetPickingFilter` сверяет значение B1 с `HEADERS.PICKING[K.BOM_NAME-1]`
  (= «BOM») — не затрагивается.
- Цвета уже определены в `V12_CONFIG.COLORS`: RED `#F4CCCC`, ORANGE `#F4B183`,
  YELLOW `#FFF2CC`, STOCK `#9FC5E8`, WHITE `#FFFFFF`.
- Логика цвета дублирует уже принятую в «Сводке дефицитов»
  (`v12ApplyDeficitColors` + `v12DeficitStatusDisplay`) — стоит держать их
  согласованными.

## 6. Чек-лист внедрения (для Act Mode)
1. `v12_config.js`: `COLUMN_COUNT.PICKING=13`, `PICKING_COLUMNS` (+EXPECTED_DATE,
   сдвиг CHECKBOX/UPDATED_AT), `HEADERS.PICKING` (+«Ожидаемая поставка», 13).
2. `v12_projections.js`: строка `v12RefreshPicking` +11-я ячейка (дата);
   новые правила `v12ApplyPickingColors` (красный/жёлтый/оранжевый/голубой).
3. Обновить `_local_tests/v12_picking_schema_test.js` под 13 колонок.
4. `node _local_tests/v12_picking_schema_test.js` → ожидать ALL TESTS PASSED.
5. `node _local_tests/v12_delivery_test.js` → регресс по чекбоксу передачи.
6. `node --check` по изменённым файлам.
