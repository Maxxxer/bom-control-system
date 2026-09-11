# Колонка «Проекты» в листе СНАБЖЕНИЕ — как реализовать

## Контекст

Запрос: в сводке снабжения (лист `СНАБЖЕНИЕ` / `SUPPLY`) добавить колонку **«Проекты»**, в ячейке которой перечислены проекты, использующие данный материал, в формате:

```
1234.АБВ - 05.09.2026
5678.ГДЕ - 20.09.2026
```

— по строке на проект, отсортировано по «крайней дате поставки» (самый ранний проект сверху).

**Уточнение по листу:** это именно `СНАБЖЕНИЕ` (`V12_CONFIG.SHEETS.SUPPLY`), т.к. её строки агрегированы по `materialKey`, и один материал встречается в нескольких BOM/проектах. Лист `DEFICIT_SUMMARY` («Сводка дефицитов») — построчный (одна позиция = один BOM), там колонка «Проекты» смысла не имеет.

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
- В `SUPPLY_COLUMNS` добавить `PROJECTS` и сдвинуть `UPDATED_AT` (рекомендую вставить `PROJECTS` перед `UPDATED_AT`).
- В `HEADERS.SUPPLY` добавить заголовок `"Проекты"` в ту же позицию.

Рекомендуемый вариант:

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

Текущая функция агрегирует по `materialKey` и собирает строку позиционно:

```js
const rows = Object.keys(agg).map(function (key) {
  const a = agg[key];
  return [key, a.code, a.name, a.model, a.unit,
    a.deficit, a.ordered, a.realDelivery,
    a.uncovered, a.bomCount, new Date()];
});
```

Что добавить:

1. В накопителе `agg[key]` завести карту проектов `projects: {}` (ключ = код проекта), значение = `{ project, date }`.
2. При обходе каждой позиции вычислять код проекта и «дату поставки» и обновлять карту (хранить **максимальную** — «крайнюю» — дату).

Черновой вид (иллюстрация, не финальный код):

```js
const project = v12ExtractBomProjectCode(r[P.BOM_NAME - 1]);
if (project) {
  const deliveryDate = v12PickingDeliveryDate(r, bomCreatedDates[normalizeMaterialId(r[P.BOM_ID - 1])]);
  const prev = a.projects[project];
  if (!prev || v12DateValue(prev.date) === "" || v12DateValue(deliveryDate) > v12DateValue(prev.date)) {
    a.projects[project] = { project: project, date: deliveryDate };
  }
}
```

Хелпер сборки текста (сортировка по возрастанию + переносы строк):

```js
/**
 * Текст колонки «Проекты»: по строке на проект «<код> - <дата>»,
 * сортировка по дате поставки по возрастанию (самый ранний сверху).
 * Проекты без распознанной даты — в конце, с пустой датой.
 */
function v12BuildSupplyProjectsText(projectsMap) {
  const list = Object.keys(projectsMap).map(function (k) { return projectsMap[k]; });
  list.sort(function (a, b) {
    const da = v12ToDate(a.date), db = v12ToDate(b.date);
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

### 3. Прокинуть даты создания BOM

`v12PickingDeliveryDate(r, bomCreatedDate)` (уже есть) определяет «дату поставки» позиции по приоритету:
1. `reserved >= required` и есть дата создания BOM → дата создания BOM;
2. иначе `productionState === READY_FOR_HANDOFF` → `REAL_DELIVERY_DATE`;
3. иначе → `EXPECTED_DATE`.

`v12RefreshProjections()` уже читает `revDates = v12BuildRevisionDateMap()`. Логично **передать её и в `v12RefreshSupply(posData, revDates)`**, чтобы не читать `BOM_REVISION` повторно (в проекте прямо боролись с повторными чтениями — P-7 отчёта №33):

```js
v12RefreshSupply(posData, revDates);   // сигнатура: function v12RefreshSupply(posData, revDates)
```

### 4. `v12_sheet_service.js` — расширение шапки

`v12MigrateSupplySchema()` уже приводит строку заголовков к канону `HEADERS.SUPPLY` безусловно. После расширения `HEADERS.SUPPLY` до 12 она **допишет** «Проекты» сама при следующем `v12EnsureAllSheets()`. Отдельная миграция для *добавления* колонки не нужна (физически удалять надо только при удалении колонок, что миграция и делает).

### 5. Отображение многострочной ячейки

Перевод строки (`"\n"`) в Google Sheets виден как несколько строк **только при включённом «Переносить текст» (Wrap)**. Сейчас в V12 форматирования ширины/wrap нет — `v12FormatAllSheets()` делает лишь `setFrozenRows(1)` и `setFontWeight("bold")`.

Нужно добавить (один раз, не на каждом пересчёте):
```js
sheet.getRange(2, S.PROJECTS, sheet.getMaxRows() - 1, 1)
     .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
sheet.setColumnWidth(S.PROJECTS, 220); // ориентировочно
```

---

## Открытые вопросы (нужно решить до реализации)

1. **Что такое «крайняя дата поставки»?** Такой функции в коде нет. Кандидаты:
   - **`v12PickingDeliveryDate`** — уже семантически «дата поставки» (факт/ожидаемая/дата создания BOM), используется в ОТБОРКЕ. **Рекомендуется.**
   - `EXPECTED_DATE` (Ожидаемая поставка) — только ожидаемая.
   - `DEADLINE` (Крайний срок) — срок, к которому материал нужен, а не дата поставки.
2. **Агрегация внутри проекта.** Если материал в одном проекте встречается в нескольких BOM/позициях — брать **максимум** («крайняя», самая поздняя) или минимум дат? Формулировка «крайняя» → максимум; сортировка «самый ранний сверху» — по возрастанию этого значения.
3. **Что показывать как «Номер проекта».** `v12ExtractBomProjectCode()` = часть имени BOM до первого разделителя (`«1234.АБВ-5678 Щит» → «1234.АБВ»`). Альтернатива — полное `BOM_NAME`.
4. **Учитывать ли переданные производству.** `v12RefreshSupply` сейчас исключает только `ARCHIVED`/`REMOVED`, но не `RECEIVED_BY_PRODUCTION`.
5. **Проекты без даты** — показывать только код или `код - —`; в сортировку — в конец.
6. **«BOM (кол-во)» (`BOM_COUNT`)** считает позиции, а не проекты — оставить или добавить «Проектов (шт.)».
7. **Производительность.** Асимптотика не меняется (O(positions)); главное — не читать `BOM_REVISION` повторно (см. п.3).

---

## Сводка затрагиваемых файлов

| Файл | Изменение |
|------|-----------|
| `v12_config.js` | `COLUMN_COUNT.SUPPLY` 11→12; в `SUPPLY_COLUMNS` — `PROJECTS: 11`, `UPDATED_AT: 12`; в `HEADERS.SUPPLY` — `"Проекты"` перед `"Обновлено"` |
| `v12_projections.js` | `v12RefreshSupply`: накапливать проекты; хелпер `v12BuildSupplyProjectsText` (сортировка + `\n`); прокинуть `revDates`; в `v12RefreshProjections` — `v12RefreshSupply(posData, revDates)` |
| `v12_sheet_service.js` | Обязательного нет — `v12MigrateSupplySchema` допишет шапку; при желании — wrap/ширина колонки «Проекты» |
| `_local_tests/v12_supply_schema_test.js` | Обновить ожидаемую длину `HEADERS.SUPPLY` (12) и индексы; добавить проверку текста «Проекты» и сортировки |

## Переиспользуемые функции

- `v12ExtractBomProjectCode(bomName)` — `v12_utils.js`: код проекта = часть имени BOM до `[\s\-_]`.
- `v12PickingDeliveryDate(r, bomCreatedDate)` — `v12_projections.js`: «дата поставки» позиции.
- `v12FormatDateOnly(value)` — `v12_projections.js`: формат `dd.MM.yyyy`.
- `v12ToDate(value)` — `v12_utils.js`: нормализатор даты (Date / серийный номер Sheets / `dd.MM.yyyy` / ISO).
- `v12BuildRevisionDateMap()` — `v12_projections.js`: `{ bomId: дата создания }`.
- `v12BuildMaterialKey({code,name,model,unit})` — `v12_utils.js`: ключ агрегации.

**Важно:** колонку `DEFICIT_SUMMARY` («Сводка дефицитов») трогать не нужно — там строка уже привязана к одной позиции/одному BOM.

---

Это план реализации — я в **Explore Mode** и не вношу изменения в код. Чтобы реализовать, переключитесь в **Act Mode**; найденное (номера колонок, функции, точки правок) сохранится как контекст.

Полный отчёт сохранён в файл `project_info__36.md` в корне проекта.