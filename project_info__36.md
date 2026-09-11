# Колонка «Проекты» в листе СНАБЖЕНИЕ — как реализовать

## Контекст

Запрос: в сводке снабжения (лист `СНАБЖЕНИЕ` / `SUPPLY`) добавить колонку **«Проекты»**, в ячейке которой перечислены проекты, использующие данный материал, в формате:

```
1234.АБВ - 05.09.2026
5678.ГДЕ - 20.09.2026
```

— по строке на проект, отсортировано по «крайней дате поставки» (самый ранний проект сверху).

Уточнение по листу: это именно `СНАБЖЕНИЕ` (`V12_CONFIG.SHEETS.SUPPLY`), т.к. её строки агрегированы по `materialKey`, и один материал встречается в нескольких BOM/проектах. Лист `DEFICIT_SUMMARY` («Сводка дефицитов») — построчный (одна позиция = один BOM), там колонка «Проекты» смысла не имеет.

---

## Где именно меняется код

### 1. `v12_config.js` — расширить схему листа

Текущее состояние (после удаления «Всего требуется»/«Всего зарезервировано»):

```js
COLUMN_COUNT: { ... SUPPLY: 11, ... },

SUPPLY_COLUMNS: {
  MATERIAL_KEY: 1, MATERIAL_CODE: 2, MATERIAL_NAME: 3, MODEL: 4, UNIT: 5,
  TOTAL_DEFICIT: 6, TOTAL_ORDERED: 7, TOTAL_REAL_DELIVERY: 8,
  TOTAL_UNCOVERED: 9, BOM_COUNT: 10, UPDATED_AT: 11
},

HEADERS: {
  SUPPLY: [
    "Material Key", "Код", "Наименование", "Модель", "Ед.изм",
    "Всего дефицит", "Всего заказано", "Всего поставлено",
    "Всего непокрыто", "BOM (кол-во)", "Обновлено"
  ]
}
```

Нужно:
- `COLUMN_COUNT.SUPPLY: 11 → 12`.
- В `SUPPLY_COLUMNS` добавить `PROJECTS` и сдвинуть `UPDATED_AT` (либо держать «Обновлено» последним, а `PROJECTS` вставить перед ним — рекомендую так, как ниже).
- В `HEADERS.SUPPLY` добавить заголовок `"Проекты"` в ту же позицию.

Рекомендуемый вариант (новое — перед «Обновлено»):

```js
COLUMN_COUNT: { ... SUPPLY: 12, ... },

SUPPLY_COLUMNS: {
  MATERIAL_KEY: 1, MATERIAL_CODE: 2, MATERIAL_NAME: 3, MODEL: 4, UNIT: 5,
  TOTAL_DEFICIT: 6, TOTAL_ORDERED: 7, TOTAL_REAL_DELIVERY: 8,
  TOTAL_UNCOVERED: 9, BOM_COUNT: 10, PROJECTS: 11, UPDATED_AT: 12
},

HEADERS: {
  SUPPLY: [
    "Material Key", "Код", "Наименование", "Модель", "Ед.изм",
    "Всего дефицит", "Всего заказано", "Всего поставлено",
    "Всего непокрыто", "BOM (кол-во)", "Проекты", "Обновлено"
  ]
}
```

### 2. `v12_projections.js` → `v12RefreshSupply()` — собрать список проектов

Текущая функция (агрегация по `materialKey`; строка собирается позиционно):

```js
function v12RefreshSupply(posData) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const S = V12_CONFIG.SUPPLY_COLUMNS;
  const data = posData || v12ReadSheet("POSITION_STATE");
  const agg = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const lc = r[P.LIFECYCLE_STATE - 1];
    if (lc === ARCHIVED || lc === REMOVED) continue;
    const key = v12BuildMaterialKey({ code, name, model, unit });
    if (!agg[key]) { agg[key] = { code, name, model, unit, deficit:0, ordered:0, realDelivery:0, uncovered:0, bomCount:0 }; }
    const a = agg[key];
    a.deficit += ...; a.ordered += ...; a.realDelivery += ...; a.uncovered += ...; a.bomCount += 1;
  }

  const rows = Object.keys(agg).map(function (key) {
    const a = agg[key];
    return [key, a.code, a.name, a.model, a.unit,
      a.deficit, a.ordered, a.realDelivery,
      a.uncovered, a.bomCount, new Date()];
  });

  v12ClearBody("SUPPLY");
  if (rows.length) v12WriteRows("SUPPLY", 2, rows);
}
```

Что добавить:

1. Завести в накопителе `agg[key]` структуру для проектов, например `projectsMap: {}` (ключ = код проекта), где значение = `{ project, date }` (дата — «крайняя дата поставки» для этого проекта).
2. При обходе каждой позиции вычислять код проекта и дату поставки и обновлять карту.

Черновой вид изменения (иллюстрация, не финальный код):

```js
// получаем даты создания BOM один раз (см. п.3 — лучше передать снаружи)
const bomCreatedDates = revDates || v12BuildRevisionDateMap();

...
  if (!agg[key]) { agg[key] = { ..., projects: {} }; }
  const a = agg[key];

  const project = v12ExtractBomProjectCode(r[P.BOM_NAME - 1]);
  if (project) {
    const deliveryDate = v12PickingDeliveryDate(r, bomCreatedDates[normalizeMaterialId(r[P.BOM_ID - 1])]);
    // ключ карты — код проекта; храним максимальную («крайнюю») дату
    const prev = a.projects[project];
    if (!prev || v12DateValue(deliveryDate) > v12DateValue(prev.date) || v12DateValue(prev.date) === "") {
      a.projects[project] = { project: project, date: deliveryDate };
    }
  }

...
  const rows = Object.keys(agg).map(function (key) {
    const a = agg[key];
    const projectsText = v12BuildSupplyProjectsText(a.projects);
    return [key, a.code, a.name, a.model, a.unit,
      a.deficit, a.ordered, a.realDelivery,
      a.uncovered, a.bomCount, projectsText, new Date()];
  });
```

Вспомогательная сборка текста с сортировкой и переносами:

```js
/**
 * Текст колонки «Проекты»: по строке на проект «<код> - <дата>»,
 * сортировка по дате поставки по возрастанию (самый ранний сверху).
 * Проекты без распознанной даты — в конце, с пустой датой.
 */
function v12BuildSupplyProjectsText(projectsMap) {
  const list = Object.keys(projectsMap).map(function (k) { return projectsMap[k]; });
  list.sort(function (a, b) {
    const da = v12ToDate(a.date);
    const db = v12ToDate(b.date);
    const ta = da ? da.getTime() : Infinity;
    const tb = db ? db.getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    return String(a.project).localeCompare(String(b.project), "ru");
  });
  return list.map(function (p) {
    const d = v12ToDate(p.date);
    const ds = d ? v12FormatDateOnly(d) : "";
    return ds ? (p.project + " - " + ds) : p.project;
  }).join("\n");
}
```

### 3. Прокинуть даты создания BOM (или читать внутри)

`v12PickingDeliveryDate(r, bomCreatedDate)` (уже есть в `v12_projections.js`) определяет «дату поставки» позиции по приоритету:
1. если `reserved >= required` и есть дата создания BOM → дата создания BOM;
2. иначе если `productionState === READY_FOR_HANDOFF` → `REAL_DELIVERY_DATE`;
3. иначе → `EXPECTED_DATE`.

Внутри `v12RefreshSupply` карты дат создания BOM нет. `v12RefreshProjections()` уже читает `revDates = v12BuildRevisionDateMap()` и раздаёт её в `v12RefreshPicking`/`v12RefreshDashboard`. Логично **дополнительно передать её в `v12RefreshSupply(posData, revDates)`**, чтобы не читать `BOM_REVISION` ещё раз (там есть явный комментарий про устранение повторных чтений — P-7 отчёта №33).

Т.е. в `v12RefreshProjections()`:
```js
v12RefreshSupply(posData, revDates);
```
и сигнатура: `function v12RefreshSupply(posData, revDates)` с фолбэком `revDates || v12BuildRevisionDateMap()`.

### 4. `v12_sheet_service.js` — расширение шапки

`v12MigrateSupplySchema()` уже приводит строку заголовков к канону (`HEADERS.SUPPLY`) и физически удаляет устаревшие колонки. После расширения `HEADERS.SUPPLY` до 12 она автоматически **допишет** «Проекты» в 11-ю колонку при следующем `v12EnsureAllSheets()` — отдельная миграция для добавления колонки не нужна (в отличие от удаления: удалять надо физически, а заголовок-расширение пишется `setValues([HEADERS.SUPPLY])`).

Проверить: `ensureSheet()` в `sheet_service.js` пишет шапку только на пустой лист, но `v12MigrateSupplySchema` перезаписывает её безусловно на канон.

### 5. Отображение многострочной ячейки

В Google Sheets перевод строки (`"\n"`) отображается как несколько строк **только при включённом «Переносить текст» (Wrap)**. Сейчас в V12 никакого форматирования ширины/wrap нет — `v12FormatAllSheets()` делает лишь `setFrozenRows(1)` и `setFontWeight("bold")`.

Нужно добавить в форматирование листа СНАБЖЕНИЕ (по месту — например, в `v12FormatAllSheets` или в конце `v12RefreshSupply`):
```js
sheet.getRange(2, S.PROJECTS, sheet.getMaxRows() - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
sheet.setColumnWidth(S.PROJECTS, 220); // ориентировочно
```
Замечание по производительности: `setWrapStrategy`/`setColumnWidth` — вызовы уровня листа; применять их один раз (в форматировании/инициализации), а не на каждом `v12RefreshSupply` (в проекте уже есть практика кэшировать дорогие UI-операции — см. `_v12ProjectionUiState`).

---

## Открытые вопросы, которые надо решить до реализации

1. **Что такое «крайняя дата поставки»?** В коде нет функции «крайняя дата поставки». Кандидаты:
   - **`v12PickingDeliveryDate`** (дата поставки: факт/ожидаемая/дата создания BOM) — уже семантически «дата поставки», используется в ОТБОРКЕ. **Рекомендуется.**
   - `EXPECTED_DATE` (Ожидаемая поставка) — только ожидаемая, без факта.
   - `DEADLINE` (Крайний срок) — это срок, к которому материал нужен в BOM, а не дата поставки.
   Надо подтвердить, какой из них подразумевается — от этого зависит и сортировка.

2. **Агрегация внутри проекта.** Если один материал в одном проекте встречается в нескольких BOM/позициях — брать **максимум** («крайняя», самая поздняя) или минимум дат? Формулировка «крайняя» склоняет к максимуму; сортировка «самый ранний сверху» — по возрастанию этого значения.

3. **Что показывать как «Номер проекта».** `v12ExtractBomProjectCode()` возвращает **часть имени BOM до первого разделителя** (пробел/дефис/подчёркивание): `«1234.АБВ-5678 Щит» → «1234.АБВ»`. Если нужен именно номер проекта — это он. Альтернатива — полное `BOM_NAME`. Подтвердить.

4. **Учитывать ли переданные производству позиции.** `v12RefreshSupply` сейчас исключает только `ARCHIVED`/`REMOVED`, но **не** исключает `RECEIVED_BY_PRODUCTION` (в отличие от ОТБОРКИ/ОБРАБОТКИ). Для «на каких проектах используется материал» — вероятно, учитывать все активные. Подтвердить.

5. **Проекты без даты.** Если дата не распознана — показывать только код проекта или «код - —»? В примере сортировки такие строки предложено помещать в конец.

6. **Влияние на «BOM (кол-во)».** Колонка `BOM_COUNT: 10` считает число позиций (BOM), а не проектов. Оставить как есть, либо рядом добавить «Проектов (шт.)» — при желании.

7. **Производительность.** `v12RefreshSupply` вызывается из `v12RefreshProjections` (полный пересчёт — 5 проекций). Сбор карты проектов не меняет асимптотику (O(positions)), но `v12BuildRevisionDateMap()` нельзя читать внутри повторно — передавать как в п.3.

---

## Сводка затрагиваемых файлов

| Файл | Изменение |
|------|-----------|
| `v12_config.js` | `COLUMN_COUNT.SUPPLY` 11→12; в `SUPPLY_COLUMNS` добавить `PROJECTS: 11`, `UPDATED_AT: 12`; в `HEADERS.SUPPLY` добавить `"Проекты"` перед `"Обновлено"` |
| `v12_projections.js` | В `v12RefreshSupply`: накапливать проекты по позициям; новая хелпер-функция `v12BuildSupplyProjectsText` (сортировка + `\n`); прокинуть `revDates`; в `v12RefreshProjections` вызвать `v12RefreshSupply(posData, revDates)` |
| `v12_sheet_service.js` | Ничего обязательного — `v12MigrateSupplySchema` допишет шапку до 12 колонок; при желании — установка wrap/ширины колонки «Проекты» |
| `_local_tests/v12_supply_schema_test.js` | Обновить ожидаемые `HEADERS.SUPPLY.length` (12), индексы колонок; добавить проверку текста «Проекты» и сортировки |

## Ключевые существующие функции, которые переиспользуются

- `v12ExtractBomProjectCode(bomName)` — `v12_utils.js`: код проекта = часть имени BOM до `[\s\-_]`.
- `v12PickingDeliveryDate(r, bomCreatedDate)` — `v12_projections.js`: «дата поставки» позиции (приоритет факт/ожидаемая/дата создания BOM).
- `v12FormatDateOnly(value)` — `v12_projections.js`: формат `dd.MM.yyyy`.
- `v12ToDate(value)` — `v12_utils.js`: нормализатор даты (Date/число-серийный/`dd.MM.yyyy`/ISO).
- `v12BuildRevisionDateMap()` — `v12_projections.js`: `{ bomId: дата создания }` из `BOM_REVISION`.
- `v12BuildMaterialKey({code,name,model,unit})` — `v12_utils.js`: ключ агрегации.

## Важное предупреждение

Колонку `DEFICIT_SUMMARY` («Сводка дефицитов») трогать не нужно — там строка уже привязана к одной позиции/одному BOM.
