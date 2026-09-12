> ⚠️ **Я в Explore Mode** — режим исследования кодовой базы, изменения НЕ вносятся. Ваш запрос — это **задача на изменение кода**: чтобы реализовать её, переключитесь в **Act Mode** (селектор режимов внизу чата) — все находки ниже перенесутся туда как контекст. Ниже — точный разбор текущего устройства дашборда и карта изменений.

# BOM CONTROL SYSTEM V12 — Разбор задачи: редизайн листа «Dashboard»

**Основание:** код `v12_projections.js`, `v12_config.js`, `v12_sheet_service.js`, `v12_trigger.js`; архитектура — `project_info__41.md`/`__42.md`/`__43.md`.

---

## 1. Краткий вывод

Задача — **презентационная** (меняет вид листа **Dashboard**), но затрагивает **два неочевидных контракта**, которые легко сломать:

1. **Текст в ячейке «Статус» читается обратно кодом.** `v12HandleDashboardEdit` (`v12_trigger.js`) сверяет `sheet.getRange(row, D.STATUS).getValue() !== BOM_STATUS.READY`, чтобы запретить отметку «Выполнено» до готовности BOM. Если заменить статус на **процент** («45%»), проверка перестанет совпадать → **чекбокс «Выполнено» сломается**. Гейт надо перевычислять из агрегата.
2. **Текст статуса дублируется в hover-подсказке.** `v12SetupDashboardNotes` берёт значение из колонки `MISSING_ITEMS`. Новый формат недостач надо формировать **один раз** и класть и в колонку, и в нотс.

Остальное — локальные правки `v12AggregateBomStates` / `v12ComputeBomStatus` / `v12RefreshDashboard` в `v12_projections.js`, плюс согласование схемы (`v12_config.js`) и форматирования (`v12_sheet_service.js`). «BOM ID» физически убирать **нельзя** — только **скрыть** (движку он нужен для идентификации строки).

**Хорошая новость:** агрегат уже собирает почти всё (total, collected, `missing` с code/name/reason). Не хватает в `missing` **количества дефицита, модели, ожидаемого срока**; процент сборки уже вычисляется (`progress = round(collected/total*100)`), но пишется в отдельную колонку.

---

## 2. Как устроен Dashboard СЕЙЧАС

### 2.1. Схема листа (`v12_config.js`, `COLUMN_COUNT.DASHBOARD = 11`)

| Кол. | Константа | Заголовок | Роль | Читается обратно? |
|---|---|---|---|---|
| 1 | `DONE` | «Выполнено» | чекбокс → EXCLUDED_BOMS | **Да** |
| 2 | `BOM_ID` | «BOM ID» | идентификатор BOM | **Да** (для `v12SetBomDone`) |
| 3 | `BOM_NAME` | «BOM» | имя проекта | Нет |
| 4 | `STATUS` | «Статус» | текстовый BOM-статус (К2) | **Да** (гейт + нотс) |
| 5 | `TOTAL_POSITIONS` | «Позиций» | всего позиций | Нет |
| 6 | `COLLECTED_POSITIONS` | «Собрано» | переданных производству | Нет |
| 7 | `PROGRESS` | «Прогресс» | % сборки | Нет → **убрать** |
| 8 | `DATE_CREATED` | «Дата создания» | из BOM_REVISION | Нет |
| 9 | `DEADLINE` | «Крайний срок» | мин. срок позиций | Нет |
| 10 | `MISSING_ITEMS` | «Недостающие позиции» | текст недостач | **Да** (источник нотса) |
| 11 | `UPDATED_AT` | «Обновлено» | `new Date()` | Нет → **убрать** |

### 2.2. Путь сборки

```
v12RefreshProjections()                       [v12_projections.js]
  ├─ v12ReadSheet("POSITION_STATE")           (один раз)
  ├─ v12BuildRevisionDateMap()  → {bomId: date}
  ├─ v12BuildExcludedMap()      → {bomId: true}
  └─ v12RefreshDashboard(posData, revDates, excluded)
        ├─ v12AggregateBomStates(posData)  → {bomId: agg={total,collected,…,missing,minDeadline}}
        ├─ строка = [done, bomId, bomName, status, total, collected,
        │            progress, revDates[bomId], agg.minDeadline, missingText, new Date()]
        ├─ v12ClearBody("DASHBOARD") → v12WriteRows(...,2,rows)
        ├─ v12InstallDashboardCheckboxes(rows.length)
        ├─ v12ApplyDashboardColors()   (усл. формат кол.4)
        └─ v12SetupDashboardNotes(rows) (ноты кол.4)
```

### 2.3. Агрегация и статус

**`v12AggregateBomStates`**: ключ `normalizeMaterialId(BOM_ID)`; пропускает только `LIFECYCLE_STATE === REMOVED` (**ARCHIVED учитывается** → переданные позиции остаются в `total` и попадают в `collected`); `VALIDATION_STATUS === ERROR` → `errors++` + `missing{…"Ошибка данных"}`; `PRODUCTION_STATE === RECEIVED` → **`collected++`** (это и есть «собрано»); иначе по `SUPPLY_STATE`: `NOT_ORDERED`/`PARTIALLY_ORDERED`/`PARTIALLY_DELIVERED` → в `missing`, `ORDERED` → `late`/`onTime` (**в `missing` НЕ попадает**).

**`v12ComputeBomStatus`** (по приоритету): ERROR → READY (=collected==total>0) → NOT_PROCESSED → PARTIAL_SELECTED → WAITING_LATE → WAITING_ON_TIME.

### 2.4. Раскраска и подсказки

- **`v12ApplyDashboardColors`** — условное форматирование кол. `STATUS` правилами `whenTextContains(label)` по `BOM_STATUS_COLOR` (RED #F4CCCC → ORANGE #F4B183 → YELLOW #FFF2CC → READY #D9EAD3, ERROR — GRAY). Кэш по `_v12ProjectionUiState.dashboardColorRows`.
- **`v12SetupDashboardNotes`** — `setNotes` на кол. `STATUS`: нота = `"Недостающие позиции:\n" + MISSING_ITEMS`.

### 2.5. Правка (чекбокс)

`v12OnEdit` (лист Dashboard actionable, только одиночная ячейка) → `v12WithEditLock` → **`v12HandleDashboardEdit`**: `bomId = ячейка BOM_ID`, `status = ячейка STATUS`; если checked и `status !== READY` → откат; иначе `v12SetBomDone(bomId, checked)` → пишет `EXCLUDED_BOMS`, аудит, `v12RefreshDashboard()`.

---

## 3. Форматирование (`v12_sheet_service.js`)

- `V12_ALIGN_CENTER_COLUMNS.DASHBOARD = [1,4,5,6,7,8,9,11]` — по центру; остальные (2,3,10) — **слева**; вертикаль **middle** уже у всех. Ставится при инициализации (`v12ApplyTableAlignment`).
- **Перенос текста** сейчас только у СНАБЖЕНИЯ (`v12FormatSupplySheet`: `setWrapStrategy(WRAP)`). Для «Недостающие материалы» переноса нет — добавить.
- **Миграции схемы дашборда НЕТ** (есть лишь Picking/Position/Supply). Для смены колонок/заголовка нужна новая миграция по образцу `v12MigrateSupplySchema`.

---

## 4. Карта «требование → где менять»

- **«Собрано»** = `agg.collected` — **менять не нужно** (уже число позиций `RECEIVED`).
- **«Крайний срок» только дата** → `v12RefreshDashboard`: обернуть `v12FormatDateOnly(agg.minDeadline)`. Заодно решить про `DATE_CREATED`.
- **«Статус» = %** → писать в кол. `STATUS` **число** + `setNumberFormat('0"%"')` (для числовых правил). **Обязательно** переписать `v12HandleDashboardEdit` — гейт считать из `v12AggregateBomStates` → `v12ComputeBomStatus`, а не читать текст ячейки.
- **Красный→зелёный** → `v12ApplyDashboardColors`: заменить `whenTextContains` на числовые правила-пороги (`whenNumberBetween`).
- **Прогрессбар** → нативных data bar в Apps Script **нет**: либо `SPARKLINE`-формула, либо текстовые блоки `█████░░ 45%`, либо отдельная цветовая колонка.
- **Hover = «кол-во - модель - ожидаемый срок», сорт. длинный→ранний** → обогатить `missing` элементами `{deficitQty, model, expectedDate}` в `v12AggregateBomStates`; сортировать по ожидаемому сроку по убыванию; сформировать `missingText`.
- **Столбец «Недостающие материалы»** → та же строка, но `.join("\n")` вместо `"; "`; колонка уже слева и по центру верт.; добавить `setWrapStrategy(WRAP)`.
- **«Обновлено»/«Прогресс»** → логикой не читаются; удаление требует перенумерации констант (PROGRESS в середине сдвинет индексы). Безопаснее **скрыть**.
- **«BOM ID»** → **скрыть** (`sheet.hideColumns`); физическое удаление ломает `v12HandleDashboardEdit` (нет чем идентифицировать строку для `v12SetBomDone`). Скрытые колонки сохраняют значения — `getValue()` читает.

---

## 5. Неочевидные поведения / инварианты

1. Статусная ячейка — «вход» для гейта готовности (**самый опасный пункт**).
2. Нотас привязан к значению `MISSING_ITEMS` — менять формат в **одном месте**.
3. `v12SetBomDone` вызывает `v12RefreshDashboard()` (не все проекции) — частичный пересчёт.
4. `STATUS` связана с **тремя** функциями (раскраска, нотс, гейт) — менять смысл согласованно.
5. Условное форматирование кэшируется по числу строк; в Apps Script глобалы не переживают запуски.
6. `clearBody` **не** сбрасывает формат/валидации — выравнивание/перенос ставятся отдельно, один раз.
7. Заголовок дашборда нигде не мигрируется.
8. ARCHIVED ≠ удалённый → «Собрано» включает переданные.
9. `missing` и `ORDERED`/`in-transit` — **разные** множества; уточнить, что считать «недостающим».
10. Строки дашборда не сортируются (`Object.keys`).
11. `MISSING_ITEMS` сейчас `join("; ")` — многострочность требует `"\n"` + включённый WRAP.

---

## 6. Файлы

| Файл | Роль |
|---|---|
| `v12_config.js` | `DASHBOARD_COLUMNS`, `HEADERS.DASHBOARD`, `COLUMN_COUNT.DASHBOARD`, `BOM_STATUS`, `BOM_STATUS_COLOR`, `COLORS` |
| `v12_projections.js` | `v12AggregateBomStates`, `v12ComputeBomStatus`, `v12RefreshDashboard`, `v12ApplyDashboardColors`, `v12SetupDashboardNotes`, `v12FormatDateOnly` |
| `v12_trigger.js` | `v12HandleDashboardEdit` (пересчитать гейт), `v12SetBomDone` |
| `v12_sheet_service.js` | `V12_ALIGN_CENTER_COLUMNS`, `v12ApplyTableAlignment`, `v12FormatSupplySheet` (образец WRAP), `v12Migrate*Schema` |
| `sheet_service.js` | `writeValues`, `clearBody`/`clearRange`, `batchWrite` |
| `_local_tests/v12_audit_fixes_test.js` | трогает `v12AggregateBomStates`/`v12ComputeBomStatus` — проверить на регрессию |
| `_tmp_run.js` | регистрация тестов и `node --check` (22 файла) |

> Теста схемы Dashboard сейчас **нет** — стоит завести `v12_dashboard_test.js`.

---

## 7. Открытые вопросы к Act Mode

1. **Прогрессбар** — какой вариант (нет нативных data bar)? От этого зависит, «Статус» — число или текст.
2. **«Собрано»** — число позиций или сумма `RECEIVED_BY_PRODUCTION_QTY`?
3. Сортировка «длинный→ранний» — по **`EXPECTED_DATE`** или по **`DEADLINE`**? Куда класть позиции без даты?
4. Включать ли в «недостающие» заказанные «в пути» (`ORDERED`)?
5. «Дата создания» — тоже только дата?
6. Убрать или скрыть «Обновлено»/«Прогресс» (по умолчанию — скрыть, без правок схемы)?
7. Пороги красный→зелёный?
8. Нужно ли поле `reason` в новом формате «кол-во - модель - срок»?

---

## 8. Рекомендуемый порядок чтения (Act Mode)

1. `v12_config.js` — схема и палитра.
2. `v12_projections.js` — агрегат/статус/сборка/цвета/нотс.
3. `v12_trigger.js` — `v12HandleDashboardEdit` + `v12SetBomDone` (критичный контракт).
4. `v12_sheet_service.js` — выравнивание, WRAP, миграции.
5. `sheet_service.js` — `clearBody`/`writeValues`.
6. `_local_tests/v12_audit_fixes_test.js` + `_tmp_run.js` — регрессия и регистрация тестов.

---

**Резюме одной фразой:** редизайн Dashboard локализован в `v12_projections.js` (формат дедлайна, процент в «Статус», `\n`-перенос, обогащение `missing`, числовой градиент) + `v12_config.js` (удаление/скрытие колонок) + `v12_sheet_service.js` (WRAP/скрытие) — **но обязательна правка `v12HandleDashboardEdit`**, а «BOM ID» нужно **скрыть**, не удалять.

*Полный разбор сохранён в `project_info__46.md` в корне проекта.*

> **Для реализации переключитесь в Act Mode** (селектор режимов внизу чата) — находки перенесутся туда как контекст.