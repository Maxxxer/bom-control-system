# BOM CONTROL SYSTEM V12 — Разбор задачи: выпадающий фильтр по BOM на листе «ОТБОРКА»

> ⚠️ **Я в Explore Mode** — режим исследования кодовой базы, изменения не вносятся. Ниже — точный анализ под конкретную задачу и карта изменений для **Act Mode** (переключатель режимов внизу чата). Все находки перенесутся туда как контекст.

---

## Краткий вывод

Задача ложится на **уже существующий механизм проекций**. Лист **`ОТБОРКА`** (`V12_CONFIG.SHEETS.PICKING = "ОТБОРКА"`) целиком пересобирается функцией **`v12RefreshPicking()`** из `v12_projections.js`: она читает `POSITION_STATE`, фильтрует строки, собирает тело листа и записывает его начиная со строки 2. Значит «фильтр по проекту» — это не встроенный фильтр Google Sheets, а **перестройка тела листа** по выбранному коду + сортировка.

Заголовок колонки 2 сейчас — буквально строка **`"BOM"`** (`HEADERS.PICKING[1]`, ячейка **`B1`**) — её и надо заменить на dropdown.

«Код агрегата» (буквенно-цифровой, до первого дефиса) сегодня **нигде не вычисляется** — его надо получить из `BOM_NAME` (кол. 4 в `POSITION_STATE` = кол. 2 в ОТБОРКЕ) через `split("-")[0]`.

**Важно:** в отличие от «Сводки дефицитов», лист ОТБОРКА показывает **ВСЕ активные, ещё не переданные позиции** (в т.ч. «в наличии»). Поэтому критерий сортировки «материал на складе — сверху» здесь **осмыслен и достижим** (в сводке он был противоречив — см. `project_info__21.md`).

**Задача меняет 5 файлов:** `v12_config.js`, `v12_utils.js`, `v12_projections.js`, `v12_trigger.js`, `v12_sheet_service.js` (+ опционально локальный тест `_local_tests/v12_picking_schema_test.js`).

---

## 1. Что конкретно просят (в терминах кода)

В листе **ОТБОРКА**:

1. Вместо надписи **`BOM`** (заголовок колонки 2, ячейка **`B1`**) — **выпадающий список** (data validation `requireValueInList`), служащий **фильтром** по этой же колонке `BOM`.
2. В список попадают **только буквенно-цифровые коды агрегата** = **первая часть `BOM_NAME` до первого дефиса** (`bomName.split("-")[0].trim()`).
3. Выбор кода → на листе остаются **только позиции этого проекта** (остальные не показываются).
4. Сортировка результата (в порядке применения):
   - **первично — по колонке `BOM`** (кол. 2, строковое сравнение);
   - затем — **по доступности материала: «на складе» — сверху**;
   - затем — **по номерам позиций в BOM** (`BOM_ROW`, кол. 3).

---

## 2. Схема листа ОТБОРКА (актуальная — 13 колонок)

Определение — `v12_config.js` → `PICKING_COLUMNS` и `HEADERS.PICKING`:

```
Кол. | PICKING_COLUMNS           | HEADERS.PICKING (рус.)
-----+---------------------------+------------------------
  1  | POSITION_ID               | "Position ID"
  2  | BOM_NAME                  | "BOM"        <-- B1, ЗАМЕНЯЕМ НА DROPDOWN
  3  | BOM_ROW                   | "Строка"
  4  | MATERIAL_CODE             | "Код"
  5  | MATERIAL_NAME             | "Наименование"
  6  | MODEL                     | "Модель"
  7  | UNIT                      | "Ед.изм"
  8  | REQUIRED_QTY              | "Требуется"
  9  | RESERVED_QTY              | "Зарезервировано"
 10  | AVAILABLE_FOR_PRODUCTION  | "Доступно для производства"
 11  | PRODUCTION_STATE          | "ProductionState"  (текст: «На складе»/«Нет в наличии»/…)
 12  | CHECKBOX                  | "Отметка получено"  (чекбокс передачи)
 13  | UPDATED_AT                | "Обновлено"
```

- `COLUMN_COUNT.PICKING = 13`.
- Миграция `v12MigratePickingSchema()` (`v12_sheet_service.js`) удаляет устаревшие колонки «Передано (кол-во)» и «Складской остаток» и **безусловно перезаписывает строку заголовков каноном** (см. §5.3 — это важно для dropdown).
- Заголовок строки 1 (в т.ч. `B1 = "BOM"`) пишется **один раз** в `ensureSheet()` — только если лист пуст (`getLastRow() === 0`).

---

## 3. Как формируется тело листа (ядро задачи)

`v12_projections.js` → **`v12RefreshPicking()`**:

```js
function v12RefreshPicking() {
  v12HarvestPickingInput();                 // подбор «застрявших» отметок чекбоксов -> передача
  const P = V12_CONFIG.POSITION_COLUMNS;
  const K = V12_CONFIG.PICKING_COLUMNS;
  const data = v12ReadSheet("POSITION_STATE");
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) continue;   // только ACTIVE
    if (r[P.RECEIVED_BY_PRODUCTION - 1] === true) continue;   // НЕ переданные
    rows.push([
      r[P.POSITION_ID - 1],
      r[P.BOM_NAME - 1],               // кол. 2 = BOM (по ней фильтр и первичная сортировка)
      r[P.BOM_ROW - 1],                // кол. 3 = Строка (третичная сортировка)
      r[P.MATERIAL_CODE - 1],
      r[P.MATERIAL_NAME - 1],
      r[P.MODEL - 1],
      r[P.UNIT - 1],
      r[P.REQUIRED_QTY - 1],
      r[P.RESERVED_QTY - 1],
      r[P.AVAILABLE_FOR_PRODUCTION - 1],
      v12ProductionStatusDisplay(r[P.PRODUCTION_STATE - 1]),  // кол. 11 = текст статуса
      false,                            // кол. 12 = чекбокс (всегда сбрасывается)
      new Date()                        // кол. 13 = Обновлено
    ]);
  }

  v12ClearBody("PICKING");               // чистит ТОЛЬКО строки >= 2 (заголовок 1 сохраняется)
  if (rows.length) {
    v12WriteRows("PICKING", 2, rows);    // запись со строки 2
  }
  v12InstallPickingCheckboxes(rows.length);
  v12ApplyPickingColors(rows);           // «На складе» -> голубой (COLORS.STOCK)
}
```

**Вывод:** фильтрация и сортировка встраиваются прямо в этот цикл (перед `clearBody`/записью). `clearBody` не трогает строку 1 → **dropdown в `B1` при пересборке не стирается**.

Связанные функции в том же файле:
- `v12InstallPickingCheckboxes(rowCount)` — чекбоксы в кол. 12 (кол. 2 не затрагивает).
- `v12ApplyPickingColors(rows)` — окраска по `PRODUCTION_STATE`: строка `«На складе»` → `COLORS.STOCK`, иначе белый.
- `v12ProductionStatusDisplay(state)` — маппинг: `READY_FOR_HANDOFF → "На складе"`, `PARTIALLY_AVAILABLE → "Частично доступно"`, `NOT_AVAILABLE → "Нет в наличии"`, `RECEIVED → "Передано"` (последнее в ОТБОРКЕ недостижимо — переданные строки отфильтрованы).
- `v12HarvestPickingInput()` — подбор отметок чекбоксов (кол. 12). **Кол. 2 (BOM) не читает** → фильтр с ним не конфликтует.

---

## 4. Что значит «материал на складе» (ключ вторичной сортировки)

Единый расчётный движок `v12_calculate.js` → `v12CalculatePositionState()`:

```js
availableForProduction = reservedQty + realDeliveryQty;          // К1
readyForHandoff = validation.valid && !received &&
                  availableForProduction >= required && required > 0;  // К3
productionState = received ? RECEIVED
                : availableForProduction >= required ? READY_FOR_HANDOFF   // «На складе»
                : availableForProduction > 0 ? PARTIALLY_AVAILABLE
                : NOT_AVAILABLE;
```

**Критерий «в наличии» для сортировки:** `PRODUCTION_STATE === READY_FOR_HANDOFF` (в листе отображается как `«На складе»`, кол. 11) ⇔ `AVAILABLE_FOR_PRODUCTION >= REQUIRED_QTY`. Именно такие строки сейчас подсвечиваются голубым (`v12ApplyPickingColors`). Их и надо поднять наверх.

> Это **не то же**, что условие дефицита: ОТБОРКА включает все активные позиции (и «в наличии», и нет), в отличие от «Сводки дефицитов», где `v12IsDeficitRowActive()` такие строки **отсекает**.

---

## 5. Точная карта изменений (что менять и где)

Ниже — минимальный архитектурно-корректный набор точек. **Реализацию выполняет Act Mode.**

### 5.1. `v12_config.js` — константы фильтра

- Добавить ячейку фильтра и маркер «все проекты». Например:
  ```js
  PICKING_FILTER_CELL: { row: 1, col: 2 },     // B1 — вместо надписи "BOM"
  PICKING_FILTER_ALL: "(Все проекты)"          // опция сброса в dropdown
  ```
- (Опционально) вынести строку-заглушку заголовка, если решите хранить фильтр в отдельной ячейке.

### 5.2. `v12_utils.js` — парсинг кода агрегата

Добавить рядом с `v12Norm`:

```js
/** Буквенно-цифровой код агрегата = первая часть имени BOM до первого дефиса. */
function v12ExtractBomProjectCode(bomName) {
  return String(bomName || "").split("-")[0].trim();
}
```

И — построение списка уникальных кодов для dropdown (уникальные, отсортированные):

```js
function v12GetBomProjectCodes() {
  const data = v12ReadSheet("POSITION_STATE");   // или PICKING
  const P = V12_CONFIG.POSITION_COLUMNS;
  const seen = {};
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const lc = data[i][P.LIFECYCLE_STATE - 1];
    if (lc !== V12_CONFIG.LIFECYCLE_STATE.ACTIVE) continue;
    if (data[i][P.RECEIVED_BY_PRODUCTION - 1] === true) continue;
    const code = v12ExtractBomProjectCode(data[i][P.BOM_NAME - 1]);
    if (code && !seen[code]) { seen[code] = true; out.push(code); }
  }
  return out.sort(function (a, b) { return a.localeCompare(b, "ru"); });
}
```

> Список кодов должен **пересчитываться при каждой пересборке** (состав BOM меняется) — см. §5.3.

### 5.3. `v12_projections.js` — ядро (фильтр + сортировка + переустановка dropdown)

В `v12RefreshPicking()`:

1. **Прочитать выбранный проект** из `B1` (`sheet.getRange(1, K.BOM_NAME).getValue()`; если пусто/`(Все проекты)` — без фильтра).
2. В цикле **отфильтровать** строки по `v12ExtractBomProjectCode(r[P.BOM_NAME-1]) === selected`.
3. **Отсортировать** `rows` до записи (стабильный мультиключ, см. ниже).
4. После записи — **переустановить dropdown** (`v12InstallPickingBomFilter()`), т.к. список кодов мог измениться.

Функции-компаньоны (по образцу `v12InstallPickingCheckboxes`):

```js
function v12InstallPickingBomFilter() {
  const sheet = v12GetSheetByKey("PICKING");
  const K = V12_CONFIG.PICKING_COLUMNS;
  const codes = v12GetBomProjectCodes();
  const list = [V12_CONFIG.PICKING_FILTER_ALL].concat(codes);
  const cell = sheet.getRange(V12_CONFIG.PICKING_FILTER_CELL.row,
                              V12_CONFIG.PICKING_FILTER_CELL.col);
  cell.clearDataValidations();
  if (list.length > 1) {
    cell.setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(list, true).build()
    );
  }
}
```

Сортировка строк (мультиключ, в порядке применения):

```js
rows.sort(function (a, b) {
  const bomA = String(a[K.BOM_NAME - 1] || "");
  const bomB = String(b[K.BOM_NAME - 1] || "");
  const c = bomA.localeCompare(bomB, "ru");
  if (c !== 0) return c;
  // «в наличии» — сверху: 0 у READY_FOR_HANDOFF («На складе»), 1 у остальных
  const availA = a[K.PRODUCTION_STATE - 1] === "На складе" ? 0 : 1;
  const availB = b[K.PRODUCTION_STATE - 1] === "На складе" ? 0 : 1;
  if (availA !== availB) return availA - availB;
  return toNumber(a[K.BOM_ROW - 1]) - toNumber(b[K.BOM_ROW - 1]);
});
```

> **Внимание к порядку ключей.** Как сформулировано в задании (BOM → наличие → строка). Если требование уточнится («сначала все `На складе` по проекту, потом BOM») — поменять порядок условий местами. Проверить у пользователя (§7).

Также проверить, что `v12InstallPickingCheckboxes(rows.length)` ставит валидацию кол. 12 ровно на фактическое число строк (`maxRows = max(lastRow-1, rowCount)`; при фильтре число строк уменьшается — «хвост» нужно чистить, что функция уже делает `clearDataValidations()` до установки).

### 5.4. `v12_trigger.js` — обработка правки ячейки фильтра

Сейчас `v12OnEdit` (`v12_trigger.js`) для одиночной правки на листе ОТБОРКА попадает в `v12HandlePickingEdit(e)`, где:

```js
if (column !== K.CHECKBOX) { v12RevertEdit(e); return; }
```

→ правка `B1` (кол. 2) **откатывается**. Нужна **явная ветка** до вызова `v12HandlePickingEdit`:

```js
if (name === S.PICKING && row === 1 && column === K.BOM_NAME) {
  v12RefreshPicking();     // пересобрать по выбранному проекту
  return;
}
```

Дополнительно:
- Ветка **диапазона** (`isPickingRange` → `v12HandlePickingRangeEdit`) обрабатывает только кол. 12; строку 1 (заголовок) нужно исключить, чтобы вставка в диапазон не «съела» фильтр.
- `v12RevertEdit` для `B1` **не вызывать** — смена фильтра это разрешённая правка.
- **RBAC:** смена фильтра — не изменение данных. Учесть, что `v12HandlePickingEdit` не проверяет роль (роль проверяется в `v12MarkReceivedByProduction`), поэтому фильтр не сломается у не-`ADMIN`; но если вы добавите проверку роли для `B1` — она не должна требовать `PROCUREMENT`/`PICKING_CHECKBOX`.

### 5.5. `v12_sheet_service.js` — установка dropdown при инсталляции

- В `v12EnsureAllSheets()` **после** `v12MigratePickingSchema()` и `v12FormatAllSheets()` вызвать `v12InstallPickingBomFilter()` (первичная установка), иначе при `⚙ Установка V12` dropdown не создастся.
- ⚠️ **`v12MigratePickingSchema()` безусловно перезаписывает строку заголовков** через `sheet.getRange(1,1,1,expected).setValues([V12_CONFIG.HEADERS.PICKING])`. Это **сбросит `B1` в `"BOM"`**. Поэтому порядок критичен: миграция → формат → **установка dropdown**. Если решите хранить выбранное значение в `B1`, оно будет сбрасываться на каждой установке/миграции (приемлемо, если это только при инсталляции, но нужно проверить, что миграция не вызывается на каждый пересчёт — она вызывается только в `v12EnsureAllSheets`).

### 5.6. (Опционально) `_local_tests/v12_picking_schema_test.js`

Мок `SpreadsheetApp` в тесте уже поддерживает `newDataValidation().requireCheckbox().build()` — понадобится расширить фабрику валидации методами `requireValueInList()` и учесть, что `B1` перестаёт быть `"BOM"`. Тест `C4` сравнивает заголовок с каноном (`CANON[1] === "BOM"`) — **сломается**, если `B1` заменяется на значение фильтра. Нужно либо оставить `"BOM"` в миграции и хранить коды в списке validation, либо обновить тест.

---

## 6. Неочевидные поведения, риски и решения

1. **Dropdown ≠ встроенный фильтр.** `requireValueInList` ограничивает ввод в **одной ячейке** и **не скрывает строки**. «Отфильтровать позиции» = **перестроить тело** (clearBody + запись только подходящих строк) — ровно то, что делает `v12RefreshPicking`. Встроенный Filter View тут не подходит: он не переживает пересборку кодом.

2. **`v12MigratePickingSchema` агрессивно перезаписывает заголовок.** Это главная «ловушка» для `B1`: любая инсталляция/миграция вернёт «BOM». Решение — устанавливать dropdown **после** миграции, а выбранное значение не считать «святыней» (сброс при установке допустим).

3. **`v12OnEdit` сейчас откатывает правку `B1`** (`v12HandlePickingEdit` при `column !== CHECKBOX` вызывает `v12RevertEdit`). Без новой ветки фильтр работать не будет — это ключевая точка правки триггера.

4. **Чекбоксы кол. 12 vs dropdown кол. 2 — разные колонки.** `v12InstallPickingCheckboxes` и `v12InstallPickingBomFilter` не пересекаются. Но при фильтре `v12InstallPickingCheckboxes(rows.length)` ставит валидацию на фактическое число строк; «хвост» чистится `clearDataValidations()` до установки — ок.

5. **`clearBody("PICKING")` чистит только строки ≥ 2** (`sheet_service.js`) → `B1` при пересборке **не стирается**. Это и делает схему «фильтр живёт в заголовке» рабочей.

6. **Передача производству меняет состав листа.** `v12MarkReceivedByProduction()` (`v12_handoff.js`) ставит `RECEIVED_BY_PRODUCTION = true` и `LIFECYCLE_STATE = ARCHIVED`, а `v12RefreshPicking` такие строки отбрасывает → после передачи строка исчезает из ОТБОРКИ. При активном фильтре это ожидаемо; надо лишь следить, чтобы пересборка **после** передачи **переустанавливала dropdown** (список проектов может сузиться).

7. **`v12HarvestPickingInput()` кол. 2 не читает** — фильтр не мешает подбору отметок. Но если фильтр «спрячет» строку с застрявшей отметкой, `v12HarvestPickingInput` всё равно её обработает (он читает **весь лист**, а не только видимые строки) — это корректно (передача идемпотентна).

8. **Смена порядка колонок ломает всё.** Код завязан на числовые `PICKING_COLUMNS`, а заголовки — русский «канон». Правка порядка колонок листа без правки конфига сломает сопоставление. Отдельно: замена `B1` на dropdown **меняет** заголовок колонки 2 (код это переживёт — он читает по индексу 2, а не по тексту).

9. **Производительность.** `v12RefreshPicking` пересобирает **весь лист** при каждом пересчёте. Смена фильтра = полная перезапись. Архитектура и так работает так (К7 — «пока полная пересборка»), но стоит помнить при больших объёмах.

10. **«Буквенно-цифровой код» — уточнение.** `split("-")[0]` может вернуть пустое/пробельное, если имя BOM начинается с дефиса, либо вернуть код с точкой (напр. `"1234.АБВ"`). Нужно решить, фильтровать ли пустые коды и включать ли «(Все проекты)» для сброса.

11. **Сортировка стабильна?** В JS `Array.prototype.sort` стабильна (ES2019+); в среде Apps Script (V8) — да. Но лучше задавать полный мультиключ, как в §5.3, чтобы порядок был детерминирован.

---

## 7. Открытые вопросы к пользователю (важно для Act Mode)

1. **Опция «Все проекты»** для сброса фильтра — нужна? (Рекомендую — да; иначе сброс только вручную.) Да, обязательно сделать
2. **Где хранить выбранное значение:** в самой `B1` (как просит задание — «вместо надписи BOM») или в отдельной ячейке (сохранить заголовок)? Задание говорит — **вместо `BOM`**, т.е. `B1`. Да
3. **Строго ли порядок сортировки «BOM → наличие → строка»?** Например, если внутри проекта по одному BOM встречается несколько строк, ключ «наличие» будет «плавать» между ними. Если нужно «сначала весь BOM, внутри него на складе, внутри — по строкам» — это ровно порядок из задания. Если «сначала все „На складе“ по проекту, потом всё остальное» — порядок ключей другой. Уточнить. Сначала сортировка по BOM, Потом внутри BOM идет сортировка по наличию, потом из позиций с одинаковым статусом идет сортировка по позициям, 
4. **Считать ли «в наличии» именно `PRODUCTION_STATE === READY_FOR_HANDOFF`** (в листе «На складе») — или иную градацию (напр. `AVAILABLE_FOR_PRODUCTION > 0`)? На складе сверху
5. **Что с пустыми кодами** (имя BOM без дефиса → код = всё имя; имя начинается с дефиса → пусто)? Включать ли такие строки в dropdown? Игнорировать не включать в фильтр

---

## 8. Модульная ссылка (файлы, релевантные задаче)

| Файл | Роль в задаче |
|---|---|
| `v12_config.js` | `SHEETS.PICKING="ОТБОРКА"`, `PICKING_COLUMNS` (BOM_NAME=2, BOM_ROW=3, PRODUCTION_STATE=11, CHECKBOX=12), `HEADERS.PICKING` (заголовок `"BOM"` = `B1`), `LIFECYCLE_STATE`, `PRODUCTION_STATE`, `COLORS.STOCK` |
| `v12_projections.js` | **Ядро:** `v12RefreshPicking` (сюда фильтр+сортировка), `v12ProductionStatusDisplay` (критерий «На складе»), `v12InstallPickingCheckboxes`, `v12ApplyPickingColors`, `v12HarvestPickingInput` |
| `v12_trigger.js` | `v12OnEdit` → нужна ветка для `B1` (строка 1, кол. 2) до `v12HandlePickingEdit`; `v12HandlePickingRangeEdit` — исключить строку 1 |
| `v12_sheet_service.js` | `v12EnsureAllSheets` (установка dropdown), `v12MigratePickingSchema` (перезаписывает заголовок — порядок!), `v12FormatAllSheets` |
| `v12_utils.js` | сюда добавить `v12ExtractBomProjectCode` / `v12GetBomProjectCodes` (рядом с `v12Norm`) |
| `v12_calculate.js` | `v12CalculatePositionState` — `availableForProduction`, `readyForHandoff`, `productionState` (критерий «в наличии») |
| `v12_position_state.js` | `v12BuildPositionRow` — `BOM_NAME = bomId = имя файла-источника` |
| `v12_source.js` | `v12ReadSourceBOM` — формирование `bomName = file.getName() без расширения` |
| `v12_handoff.js` | `v12MarkReceivedByProduction` — строка исчезает из ОТБОРКИ после передачи |
| `sheet_service.js` | `clearBody` (чистит только ≥2), `ensureSheet` (заголовок пишется один раз), `writeValues`, `batchWrite` |
| `v12_controller.js` | `v12Install` → `v12EnsureAllSheets` (точка установки) |
| `v12_roles.js` | `v12CanEditField`, `v12RequireRole` (RBAC фильтра — не должен требовать `PICKING_CHECKBOX`) |
| `_local_tests/v12_picking_schema_test.js` | мок`SpreadsheetApp` (расширить `requireValueInList`); тест `C4` сравнивает заголовок с каноном |

---

## 9. Рекомендуемый порядок чтения для Act Mode

1. `v12_config.js` — `PICKING_COLUMNS` + `HEADERS.PICKING` (понять схему; `B1 = "BOM" = кол. 2`).
2. `v12_projections.js` — `v12RefreshPicking` / `v12ProductionStatusDisplay` / `v12InstallPickingCheckboxes` (ядро: сюда фильтр+сортировка+dropdown).
3. `v12_trigger.js` — `v12OnEdit` / `v12HandlePickingEdit` (обработка правки `B1`; сейчас откатывается).
4. `v12_sheet_service.js` — `v12EnsureAllSheets` / `v12MigratePickingSchema` (порядок установки dropdown; миграция перезаписывает заголовок).
5. `v12_source.js` + `v12_position_state.js` — происхождение `BOM_NAME` (парсинг кода до дефиса).
6. `v12_utils.js` — куда добавить `v12ExtractBomProjectCode` / `v12GetBomProjectCodes`.

---

## 10. Резюме одной фразой

На листе **ОТБОРКА** надо заменить заголовок `B1 = "BOM"` на **dropdown кодов проектов** (`v12ExtractBomProjectCode` = `BOM_NAME.split("-")[0]`), научить **`v12RefreshPicking()`** (`v12_projections.js`) фильтровать строки по выбранному коду и сортировать их (BOM → «На складе» сверху (`PRODUCTION_STATE = READY_FOR_HANDOFF`) → `BOM_ROW`), добавить **обработку правки `B1` в `v12OnEdit`** (`v12_trigger.js` — сейчас она откатывается как «чужаколонковая»), хелперы парсинга в **`v12_utils.js`** и установку dropdown в **`v12EnsureAllSheets`** (`v12_sheet_service.js`) **после** `v12MigratePickingSchema` (она перезаписывает строку заголовков).

> **Это запрос на изменение кода.** Реализация выполняется в **Act Mode** — см. сообщение агента.
