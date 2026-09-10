# BOM CONTROL SYSTEM V12 — Выпадающий фильтр по BOM на листе «ОТБОРКА»

> ⚠️ **Я в Explore Mode** — режим исследования кодовой базы, изменения не вношу. Ниже — точный анализ под задачу и карта изменений для **Act Mode** (переключатель режимов внизу чата). Отчёт сохранён в **`project_info__23.md`**.

---

## Краткий вывод

Задача ложится на **уже существующий механизм проекций**. Лист **`ОТБОРКА`** (`V12_CONFIG.SHEETS.PICKING = "ОТБОРКА"`) целиком пересобирается функцией **`v12RefreshPicking()`** из `v12_projections.js`: она читает `POSITION_STATE`, фильтрует строки, собирает тело и записывает его со строки 2. Значит «фильтр по проекту» — это не встроенный фильтр Google Sheets, а **перестройка тела листа** по выбранному коду + сортировка.

Заголовок колонки 2 сейчас — буквально строка **`"BOM"`** (`HEADERS.PICKING[1]`, ячейка **`B1`**) — её и надо заменить на dropdown.

«Код агрегата» (до первого дефиса) сегодня **нигде не вычисляется** — его надо получить из `BOM_NAME` (кол. 4 `POSITION_STATE` = кол. 2 ОТБОРКИ) через `split("-")[0]`.

**Важно:** в отличие от «Сводки дефицитов», ОТБОРКА показывает **ВСЕ активные, ещё не переданные позиции** (в т.ч. «в наличии»). Поэтому критерий «материал на складе — сверху» здесь **осмыслен и достижим** (в сводке он был противоречив — `project_info__21.md`).

**Меняются 5 файлов:** `v12_config.js`, `v12_utils.js`, `v12_projections.js`, `v12_trigger.js`, `v12_sheet_service.js` (+ опц. локальный тест).

---

## 1. Формулировка задачи в терминах кода

В листе **ОТБОРКА**:

1. Вместо надписи **`BOM`** (ячейка **`B1`**, кол. 2) — **dropdown** (`requireValueInList`), служащий **фильтром** по этой колонке.
2. В список — **только коды агрегата** = **первая часть `BOM_NAME` до первого дефиса** (`bomName.split("-")[0].trim()`).
3. Выбор кода → на листе остаются **только позиции этого проекта**.
4. Сортировка (в порядке применения): **кол. `BOM`** (кол. 2) → **«на складе» сверху** → **`BOM_ROW`** (кол. 3).

---

## 2. Схема листа ОТБОРКА (13 колонок)

`v12_config.js` → `PICKING_COLUMNS` / `HEADERS.PICKING`:

```
Кол. | PICKING_COLUMNS           | HEADERS.PICKING
-----+---------------------------+------------------------
  1  | POSITION_ID               | "Position ID"
  2  | BOM_NAME                  | "BOM"        <-- B1, ЗАМЕНЯЕМ
  3  | BOM_ROW                   | "Строка"
  4  | MATERIAL_CODE             | "Код"
  5  | MATERIAL_NAME             | "Наименование"
  6  | MODEL                     | "Модель"
  7  | UNIT                      | "Ед.изм"
  8  | REQUIRED_QTY              | "Требуется"
  9  | RESERVED_QTY              | "Зарезервировано"
 10  | AVAILABLE_FOR_PRODUCTION  | "Доступно для производства"
 11  | PRODUCTION_STATE          | "ProductionState" («На складе»/…)
 12  | CHECKBOX                  | "Отметка получено"
 13  | UPDATED_AT                | "Обновлено"
```

- Миграция `v12MigratePickingSchema()` (`v12_sheet_service.js`) удаляет устаревшие колонки и **безусловно перезаписывает строку заголовков каноном** (важно — см. §5.5).
- Заголовок (`B1 = "BOM"`) пишется один раз в `ensureSheet()` — только если лист пуст.

---

## 3. Ядро — как формируется тело листа

`v12_projections.js` → **`v12RefreshPicking()`**:

```js
function v12RefreshPicking() {
  v12HarvestPickingInput();                 // подбор отметок чекбоксов (кол. 12)
  const P = V12_CONFIG.POSITION_COLUMNS;
  const K = V12_CONFIG.PICKING_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[P.LIFECYCLE_STATE - 1] !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) continue; // только ACTIVE
    if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) continue;                      // НЕ переданные
    rows.push([
      r[P.POSITION_ID - 1],
      r[P.BOM_NAME - 1],               // кол. 2 = BOM (фильтр + первичная сортировка)
      r[P.BOM_ROW - 1],                // кол. 3 = Строка
      r[P.MATERIAL_CODE - 1], r[P.MATERIAL_NAME - 1], r[P.MODEL - 1], r[P.UNIT - 1],
      r[P.REQUIRED_QTY - 1], r[P.RESERVED_QTY - 1], r[P.AVAILABLE_FOR_PRODUCTION - 1],
      v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1]),  // кол. 11 = текст статуса
      false,                           // кол. 12 = чекбокс (всегда сбрасывается)
      new Date()                       // кол. 13 = Обновлено
    ]);
  }

  v12ClearBody("PICKING");             // чистит ТОЛЬКО строки >= 2 (заголовок 1 сохраняется)
  if (rows.length) v12WriteRows("PICKING", 2, rows);
  v12InstallPickingCheckboxes(rows.length);
  v12ApplyPickingColors(rows);         // «На складе» -> голубой (COLORS.STOCK)
}
```

**Фильтрация и сортировка встраиваются прямо в этот цикл. `clearBody` не трогает строку 1 → dropdown в `B1` при пересборке не стирается.**

Связанные: `v12InstallPickingCheckboxes` (кол. 12), `v12ApplyPickingColors`, `v12ProductionStatusDisplay`, `v12HarvestPickingInput` (кол. 2 не читает → с фильтром не конфликтует).

---

## 4. Что значит «материал на складе» (ключ вторичной сортировки)

`v12_calculate.js` → `v12CalculatePositionState()`:

```js
availableForProduction = reservedQty + realDeliveryQty;         // К1
productionState = received ? RECEIVED
                : availableForProduction >= required ? READY_FOR_HANDOFF  // «На складе», кол. 11
                : availableForProduction > 0 ? PARTIALLY_AVAILABLE
                : NOT_AVAILABLE;
```

**«В наличии» = `PRODUCTION_STATE === READY_FOR_HANDOFF` ⇔ `AVAILABLE_FOR_PRODUCTION >= REQUIRED_QTY`** (в листе «На складе», сейчас подсвечено голубым). Эти строки и надо поднять наверх.

---

## 5. Точная карта изменений

### 5.1. `v12_config.js` — константы
```js
PICKING_FILTER_CELL: { row: 1, col: 2 },   // B1 — вместо надписи "BOM"
PICKING_FILTER_ALL: "(Все проекты)"        // опция сброса
```

### 5.2. `v12_utils.js` — парсинг кода (рядом с `v12Norm`)
```js
function v12ExtractBomProjectCode(bomName) {
  return String(bomName || "").split("-")[0].trim();
}
function v12GetBomProjectCodes() {           // уникальные коды из ACTIVE/не переданных
  const data = v12ReadSheet("POSITION_STATE");
  const P = V12_CONFIG.POSITION_COLUMNS;
  const seen = {}, out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][P.LIFECYCLE_STATE - 1] !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) continue;
    if (data[i][P.RECEIVED_BY_PRODUCTION - 1] === true) continue;
    const code = v12ExtractBomProjectCode(data[i][P.BOM_NAME - 1]);
    if (code && !seen[code]) { seen[code] = true; out.push(code); }
  }
  return out.sort((a, b) => a.localeCompare(b, "ru"));
}
```

### 5.3. `v12_projections.js` — ядро (фильтр + сортировка + переустановка dropdown)
В `v12RefreshPicking()`: 1) прочитать выбранный проект из `B1`; 2) **отфильтровать** по `v12ExtractBomProjectCode(r[P.BOM_NAME-1]) === selected` (пусто/`(Все проекты)` → без фильтра); 3) **отсортировать** до записи; 4) после записи **переустановить dropdown**:

```js
function v12InstallPickingBomFilter() {
  const sheet = v12GetSheetByKey("PICKING");
  const codes = v12GetBomProjectCodes();
  const list = [V12_CONFIG.PICKING_FILTER_ALL].concat(codes);
  const cell = sheet.getRange(V12_CONFIG.PICKING_FILTER_CELL.row,
                              V12_CONFIG.PICKING_FILTER_CELL.col);
  cell.clearDataValidations();
  if (list.length > 1) {
    cell.setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(list, true).build());
  }
}

// сортировка: BOM -> «На складе» сверху -> BOM_ROW
rows.sort(function (a, b) {
  const k = V12_CONFIG.PICKING_COLUMNS;
  const c = String(a[k.BOM_NAME-1]||"").localeCompare(String(b[k.BOM_NAME-1]||""), "ru");
  if (c !== 0) return c;
  const av = x => x[k.PRODUCTION_STATE-1] === "На складе" ? 0 : 1;
  if (av(a) !== av(b)) return av(a) - av(b);
  return toNumber(a[k.BOM_ROW-1]) - toNumber(b[k.BOM_ROW-1]);
});
```

### 5.4. `v12_trigger.js` — обработка правки `B1`
Сейчас одиночная правка ОТБОРКИ идёт в `v12HandlePickingEdit`, где `if (column !== K.CHECKBOX) { v12RevertEdit(e); return; }` → **правка `B1` откатывается**. Нужна ветка до этого:
```js
if (name === S.PICKING && row === 1 && column === K.BOM_NAME) { v12RefreshPicking(); return; }
```
+ в `v12HandlePickingRangeEdit` исключить строку 1; `v12RevertEdit` для `B1` не вызывать; RBAC фильтра не должен требовать `PICKING_CHECKBOX`.

### 5.5. `v12_sheet_service.js` — установка при инсталляции
В `v12EnsureAllSheets()` **после** `v12MigratePickingSchema()` и `v12FormatAllSheets()` вызвать `v12InstallPickingBomFilter()`. ⚠️ `v12MigratePickingSchema` безусловно перезаписывает строку заголовков (`setValues([HEADERS.PICKING])`) → **сбросит `B1` в `"BOM"`**; порядок критичен.

### 5.6. `_local_tests/v12_picking_schema_test.js` — мок
Расширить `newDataValidation()` методом `requireValueInList`; тест `C4` сравнивает заголовок с каноном (`"BOM"`) — сломается, если `B1` заменить.

---

## 6. Неочевидные поведения и риски

1. **Dropdown ≠ встроенный фильтр** — `requireValueInList` не скрывает строки; фильтр = перестройка тела.
2. **`v12MigratePickingSchema` перезаписывает заголовок** — главная ловушка для `B1`; ставить dropdown после миграции.
3. **`v12OnEdit` сейчас откатывает `B1`** — без новой ветки фильтр не заработает.
4. **`clearBody` чистит только ≥2** → `B1` при пересборке сохраняется — схема «фильтр в заголовке» рабочая.
5. **Передача (`v12MarkReceivedByProduction`) архивирует строку** → она исчезает из ОТБОРКИ; после пересборки нужно переустанавливать dropdown (список проектов может сузиться).
6. **Код завязан на числовые `PICKING_COLUMNS`** — смена порядка колонок листа без правки конфига сломает сопоставление.
7. **`v12HarvestPickingInput` читает весь лист**, а не видимые строки — активный фильтр не мешает подбору отметок.
8. **Производительность** — смена фильтра = полная перезапись листа (архитектура и так полная пересборка, К7).

---

## 7. Открытые вопросы

1. **Опция «Все проекты»** для сброса — нужна?
2. **Где хранить выбор:** в `B1` (как просит задание — «вместо BOM») или отдельной ячейке?
3. **Порядок ключей сортировки:** «BOM → наличие → строка» (как в задании) или «сначала все „На складе“ по проекту, потом BOM»?
4. **«В наличии» = `READY_FOR_HANDOFF`** («На складе») — или иная градация (`AVAILABLE_FOR_PRODUCTION > 0`)?
5. **Пустые коды** (имя BOM без дефиса → код = всё имя) — включать в dropdown?

---

## 8. Модульная ссылка

| Файл | Роль |
|---|---|
| `v12_config.js` | `SHEETS.PICKING="ОТБОРКА"`, `PICKING_COLUMNS` (BOM_NAME=2, BOM_ROW=3, PRODUCTION_STATE=11, CHECKBOX=12), `HEADERS.PICKING` (`B1="BOM"`), `COLORS.STOCK` |
| `v12_projections.js` | **Ядро:** `v12RefreshPicking`, `v12ProductionStatusDisplay`, `v12InstallPickingCheckboxes`, `v12ApplyPickingColors`, `v12HarvestPickingInput` |
| `v12_trigger.js` | `v12OnEdit` → ветка для `B1`; `v12HandlePickingEdit`/`v12HandlePickingRangeEdit` |
| `v12_sheet_service.js` | `v12EnsureAllSheets`, `v12MigratePickingSchema` (перезапис заголовка), `v12FormatAllSheets` |
| `v12_utils.js` | добавить `v12ExtractBomProjectCode` / `v12GetBomProjectCodes` |
| `v12_calculate.js` | `v12CalculatePositionState` — критерий «в наличии» |
| `v12_position_state.js` / `v12_source.js` | `BOM_NAME = bomId = имя файла-источника` |
| `v12_handoff.js` | `v12MarkReceivedByProduction` — строка исчезает из ОТБОРКИ |
| `sheet_service.js` | `clearBody` (только ≥2), `ensureSheet`, `writeValues`, `batchWrite` |
| `v12_controller.js` / `v12_roles.js` | точка установки / RBAC |
| `_local_tests/v12_picking_schema_test.js` | мок `SpreadsheetApp` |

---

## 9. Порядок чтения для Act Mode

1. `v12_config.js` — схема `PICKING_COLUMNS` / `HEADERS.PICKING`.
2. `v12_projections.js` — `v12RefreshPicking` (сюда фильтр+сортировка+dropdown).
3. `v12_trigger.js` — `v12OnEdit` / `v12HandlePickingEdit` (правка `B1`).
4. `v12_sheet_service.js` — `v12EnsureAllSheets` / `v12MigratePickingSchema` (порядок установки).
5. `v12_source.js` + `v12_position_state.js` — происхождение `BOM_NAME`.
6. `v12_utils.js` — куда добавить хелперы парсинга.

---

## 10. Резюме одной фразой

Заменить `B1 = "BOM"` на листе **ОТБОРКА** на **dropdown кодов проектов** (`BOM_NAME.split("-")[0]`), научить **`v12RefreshPicking()`** фильтровать строки по коду и сортировать их (BOM → «На складе» сверху → `BOM_ROW`), добавить обработку правки `B1` в **`v12OnEdit`** (сейчас откатывается), хелперы в **`v12_utils.js`** и установку dropdown в **`v12EnsureAllSheets`** **после** `v12MigratePickingSchema`.

> **Это запрос на изменение кода.** Реализация — в **Act Mode** (селектор режимов внизу чата); весь этот анализ и `project_info__23.md` переносятся как контекст. Если хотите, в Explore Mode могу углубиться в конкретный пункт (например, точную логику `v12HandlePickingRangeEdit` или взаимодействие фильтра с массовой передачей).

---
_Источник: анализ кодовой базы V12._

> ⚠️ **Небольшое примечание по терминологии.** В задании фигурирует лист «Отборка» и колонка «BOM». В коде это лист **`ОТБОРКА`** (`SHEETS.PICKING`) с колонкой **`BOM`** (`PICKING_COLUMNS.BOM_NAME`, кол. 2). Ранее отчёты 21–22 разбирали похожую задачу для листа **«Сводка дефицитов»** — это **другой** лист; данная задача относится именно к ОТБОРКЕ.