# BOM CONTROL SYSTEM V12 — Дашборд: колонка «Статус» и связанные изменения

> **Режим: Explore Mode.** Этот документ — результат исследования кодовой базы. Он описывает,
> как сейчас устроен лист **Dashboard**, где именно живёт логика статуса/прогрессбара, какие
> данные доступны в `POSITION_STATE`, и **какие конкретно файлы и функции нужно изменить**,
> чтобы реализовать запрошенное поведение. Реализация (правки кода) выполняется в **Act Mode**.

> **Текущая задача (запрос пользователя):** вернуть в Dashboard колонку статуса вместо
> прогрессбара (текстовые состояния + цвет), добавить колонку «На складе» после «Позиций»,
> и в колонке «Недостающие материалы» при полной комплектации писать
> «Скомплектовано — <дата и время последней отметки "получено">».

---

## 1. Кратко о задаче и текущем состоянии

Запрос описывает **5 новых статусов BOM** и **2 новых поля вывода**. Сейчас дашборд
показывает вместо текстового статуса **процент сборки + прогрессбар** (`45% █████░░░░░`)
с плавной заливкой «красный → жёлтый → зелёный» по проценту. Историческая текстовая
логика статуса (enum `V12_CONFIG.BOM_STATUS` + `BOM_STATUS_COLOR`) **сохранилась в коде**,
но **больше не используется для отображения статуса** (её применяет только гейт чекбокса
«Выполнено»). То есть «вернуть колонку статуса» = восстановить/переработать
`v12ComputeBomStatus` → текст + сделать заливку по статусу, как было в прежних версиях,
но с новым набором состояний.

### Запрошенные статусы (из ТЗ-запроса)

| № | Условие | Текст статуса | Цвет |
|---|---------|---------------|------|
| 1 | Хотя бы одна позиция не заказана ИЛИ не указана ожидаемая дата хотя бы у одной позиции | **Есть незаказанные компоненты** | красный (`COLORS.RED` `#F4CCCC`) |
| 2 | Все заказаны, но хотя бы одна поставка ПОЗЖЕ крайнего срока | **Ожидается поставка (Опаздывает)** | оранжевый (`COLORS.ORANGE` `#F4B183`) — предполагается по аналогии |
| 3 | Все заказаны, срок поставки всех ≤ крайнего срока | **Ожидается поставка (В срок)** | жёлтый (`COLORS.YELLOW` `#FFF2CC`) |
| 4 | Все компоненты на складе, но не все отобраны/переданы в производство | **На складе, ждет отборки** | голубой (`COLORS.STOCK` `#9FC5E8`) |
| 5 | Все компоненты отмечены как полученные производством | **Скомплектован, готов к работе** | зелёный (`COLORS.GREEN`/`READY` `#D9EAD3`) |

### Новые поля вывода
- **Колонка «На складе»** — сразу после «Позиций» (`TOTAL_POSITIONS`, кол. 5). Считает
  количество позиций BOM, которые лежат на складе и готовы к отборке, но ещё не переданы
  производству (в модели — позиции в состоянии `PRODUCTION_STATE.READY_FOR_HANDOFF`).
- **«Недостающие материалы»** — если ВСЕ позиции BOM получены производством, вместо списка
  недостач выводить строку `Скомплектовано - <дата и время отметки "получено" последней позиции>`.
  Дата/время берётся из `POSITION_STATE.RECEIVED_BY_PRODUCTION_AT`, формат — `dd.MM.yyyy HH:mm`
  (`V12_CONFIG.SETTINGS.DATE_FORMAT`).

---

## 2. Текущая схема листа Dashboard

Схема задана в `v12_config.js` — `V12_CONFIG.DASHBOARD_COLUMNS` и `HEADERS.DASHBOARD`.
Сейчас **9 колонок** (`COLUMN_COUNT.DASHBOARD = 9`):

| Кол. | Ключ | Заголовок | Примечание |
|------|------|-----------|------------|
| 1 | `DONE` | Выполнено | чекбокс, активен только при готовности BOM |
| 2 | `BOM_ID` | BOM ID | **скрыта** визуально (`hideColumns`), нужна движку для идентификации строки |
| 3 | `BOM_NAME` | BOM | имя BOM |
| 4 | `STATUS` | Статус | **сейчас**: `"45% █████░░░░░"` + заливка по проценту |
| 5 | `TOTAL_POSITIONS` | Позиций | всего позиций BOM |
| 6 | `COLLECTED_POSITIONS` | Собрано | число переданных производству |
| 7 | `DATE_CREATED` | Дата создания | самая ранняя ревизия из `BOM_REVISION` |
| 8 | `DEADLINE` | Крайний срок | минимальный (самый ранний) `DEADLINE` позиций |
| 9 | `MISSING_ITEMS` | Недостающие материалы | многострочный список `кол-во - модель - срок` |

> Комментарий в конфиге прямо фиксирует: «*Колонки «Прогресс» и «Обновлено» убраны… «Статус»
> теперь показывает процент сборки + прогрессбар, а не текст статуса*». Именно это и нужно
> откатить, добавив новые состояния.

### Формирование строки дашборда — `v12RefreshDashboard` (`v12_projections.js`)
```js
const progress = a.total > 0 ? Math.round((a.collected / a.total) * 100) : 0;
const missingText = v12BuildMissingItemsText(a.missing);
rows.push([
  done, bomId, a.bomName,
  v12DashboardStatusText(progress),   // <-- ЗДЕСЬ был текст статуса
  a.total, a.collected,
  v12FormatDateOnly(revDates[bomId]),
  v12FormatDateOnly(a.minDeadline),
  missingText
]);
statusColors.push(v12DashboardPercentColor(progress));  // <-- заливка «по проценту»
```
Далее: `v12ClearBody("DASHBOARD")` → `v12WriteRows` → `v12InstallDashboardCheckboxes` →
`v12ApplyDashboardStatusColors(statusColors)` → `v12SetupDashboardNotes(rows)`.

### Прочие функции дашборда (`v12_projections.js`)
- `v12DashboardStatusText(percent)` — текст `"% █/░"` (10 сегментов, `\u2588` / `\u2591`).
- `v12DashboardPercentColor(percent)` — интерполяция `PROGRESS_LOW → PROGRESS_MID → PROGRESS_HIGH`.
- `v12InterpolateColor`, `v12HexToRgb`, `v12RgbToHex` — вспомогательные (могут стать не нужны).
- `v12ApplyDashboardStatusColors(colors)` — заливка колонки `STATUS` (по строке на BOM).
- `v12SetupDashboardNotes(rows)` — hover-ноты на `STATUS` = текст недостач.

---

## 3. Агрегация по BOM — `v12AggregateBomStates(posData)` (`v12_projections.js`)

Строит `Map<bomId, { bomName, total, collected, notOrdered, partial, late, onTime, errors, missing[], minDeadline }>`.
Правила подсчёта (важны для новых статусов):

- Пропускаются только позиции с `LIFECYCLE_STATE === REMOVED`. **ARCHIVED НЕ пропускается** —
  позиции, уже переданные производству, остаются в агрегате (и учитываются как `collected`).
- `total` — все позиции BOM.
- `validation === ERROR` → `errors++`, позиция уходит в `missing`.
- `production === RECEIVED` → `collected++` (**это и есть «получено производством»**).
- Далее по `SUPPLY_STATE`:
  - `NOT_ORDERED` → `notOrdered++`
  - `PARTIALLY_ORDERED`, `PARTIALLY_DELIVERED` → `partial++`
  - `ORDERED` → если `EXPECTED_DATE > DEADLINE` → `late++`, иначе `onTime++`
  - `default` (в т.ч. `RESERVED`, `NO_REQUIREMENT`, `DELIVERED`) → `onTime++`
- `minDeadline` — минимальный `DEADLINE` среди позиций BOM.
- `missing` — позиции с `DEFICIT_QTY > 0` и не переданные производству (формат записи —
  `v12BuildMissingEntry`: `{ qty, model, expectedDate, code, name }`).

> **Важно:** агрегат сейчас НЕ считает:
> - количество позиций «на складе, ждёт отборки» (`PRODUCTION_STATE.READY_FOR_HANDOFF` и `!received`);
> - наличие позиций без ожидаемой даты (для статуса «Есть незаказанные компоненты»
>   недостаточно `ordered<=0` — нужно ЕЩЁ и «нет `EXPECTED_DATE`»);
> - максимальный `RECEIVED_BY_PRODUCTION_AT` (для «Скомплектовано — дата/время»).
> Эти счётчики нужно добавить в агрегат.

---

## 4. Определение статуса BOM — `v12ComputeBomStatus(agg)` (`v12_projections.js`)

Текущая (устаревшая для отображения, но **живая для гейта**) логика:
```js
if (agg.errors > 0)                                 return BS.ERROR;            // «Ошибка данных»
if (agg.collected === agg.total && agg.total > 0)   return BS.READY;            // «Готов к производству»
if (agg.notOrdered === agg.total)                   return BS.NOT_PROCESSED;    // «Не обработан»
if (agg.notOrdered > 0 || agg.partial > 0)          return BS.PARTIAL_SELECTED; // «Частично отобран»
if (agg.late > 0)                                   return BS.WAITING_LATE;     // «Ожидание поставки (опаздывает)»
return BS.WAITING_ON_TIME;                                                       // «Ожидание поставки (в срок)»
```

### КРИТИЧНЫЙ ИНВАРИАНТ — гейт чекбокса «Выполнено»
`v12ComputeBomStatus` **используется** (не мёртвый код!) в `v12_trigger.js`:
```js
function v12IsBomReadyForDone(bomId) {
  const a = v12AggregateBomStates()[id];
  return !!a && v12ComputeBomStatus(a) === V12_CONFIG.BOM_STATUS.READY;
}
```
`v12HandleDashboardEdit` разрешает поставить галочку «Выполнено» только когда BOM «готов»
(все позиции переданы производству). Любая переработка `v12ComputeBomStatus`/`BOM_STATUS`
**обязана сохранить этот гейт логически корректным** (или заменить проверку на новое
состояние «Скомплектован»). Иначе сломается установка/снятие галочки «Выполнено».

### Enum статусов и цвета
- `V12_CONFIG.BOM_STATUS` — строки: `NOT_PROCESSED`, `PARTIAL_SELECTED`, `WAITING_ON_TIME`,
  `WAITING_LATE`, `READY`, `ERROR` (значения — русские подписи).
- `V12_CONFIG.BOM_STATUS_COLOR` — map подпись→ключ цвета (`RED/ORANGE/YELLOW/READY/GRAY`).
  **Сейчас для заливки не используется** (заливка — по проценту), но это готовый шаблон
  для «возврата цветовой раскраски»: достаточно применить его вместо `v12DashboardPercentColor`.
- `V12_CONFIG.COLORS` — палитра: `RED #F4CCCC`, `ORANGE #F4B183`, `YELLOW #FFF2CC`,
  `GREEN/READY #D9EAD3`, `STOCK #9FC5E8`, `GRAY #D9D9D9`, `WHITE`, а также служебные
  `PROGRESS_LOW/MID/HIGH` (для прогрессбара — станут не нужны).

---

## 5. Текст «Недостающие материалы» — `v12BuildMissingItemsText(missing)`

Формирует многострочную ячейку: `"<qty> - <model> - <dd.MM.yyyy>"`, по строке на позицию,
сортировка по `expectedDate` **по убыванию** (самый поздний сверху), позиции без даты — в конце.
Пример: `"2 - B - 01.12.2026\n1 - A - 01.10.2026\n3 - C"`.

**Что нужно изменить:** если `collected === total` (все получены производством), возвращать не
список, а `"Скомплектовано - dd.MM.yyyy HH:mm"`, где время — максимум `RECEIVED_BY_PRODUCTION_AT`
среди позиций BOM. Придётся хранить это время в агрегате (`maxReceivedAt`) и добавить форматтер
даты-со-временем (сейчас есть только `v12FormatDateOnly`, дата без времени).

---

## 6. Миграция и форматирование листа Dashboard

Всё в `v12_sheet_service.js`.

- **`v12MigrateDashboardSchema()`** — вызывается из `v12EnsureAllSheets()`. Что делает сейчас:
  - удаляет legacy-колонки `["Прогресс", "Обновлено"]` (`V12_DASHBOARD_LEGACY_HEADERS`);
  - перезаписывает строку заголовков каноном `HEADERS.DASHBOARD`;
  - скрывает колонку `BOM_ID` (сначала `showColumns`, потом `hideColumns(BOM_ID)`);
  - сбрасывает условное форматирование (`setConditionalFormatRules([])`).
  > **Для новой колонки «На складе»:** миграция должна **вставить физическую колонку** в нужную
  > позицию (после «Позиций»). Сейчас миграция умеет только удалять колонки; понадобится
  > `sheet.insertColumnBefore(n)` (или `insertColumnsAfter`), иначе сдвиг индексов вправо
  > (сейчас там только перезапись заголовка).
- **`v12ApplyTableAlignment()`** — карта `V12_ALIGN_CENTER_COLUMNS.DASHBOARD = [1,4,5,6,7,8]`.
  **При добавлении колонки индексы нужно пересчитать** (статус остаётся в центре; новый столбец
  «На складе» — по центру как количество).
- **`v12FormatDashboardSheet()`** — задаёт перенос текста и ширину колонки `MISSING_ITEMS`
  (`V12_DASHBOARD_MISSING_COL_WIDTH = 320`). Возможно, понадобится ширина/выравнивание и для
  новой колонки.
- **`v12InstallDashboardCheckboxes`** — валидация чекбокса `DONE` по всей высоте листа.

---

## 7. Источники данных: что доступно в `POSITION_STATE`

Схема — `V12_CONFIG.POSITION_COLUMNS` (31 колонка). Для новых статусов релевантны:

| Кол. | Ключ | Что даёт |
|------|------|----------|
| 12 | `ORDERED_QTY` | заказанное количество |
| 14 | `EXPECTED_DATE` | ожидаемая дата поставки (может быть пустой) |
| 15 | `DEADLINE` | крайний срок |
| 16-19 | `RECEIVED_BY_PRODUCTION_QTY / _BY_PRODUCTION / _AT / _USER` | отметка «получено производством» и **дата/время** (`_AT`) |
| 20 | `VALIDATION_STATUS` | `VALID`/`ERROR` |
| 21 | `LIFECYCLE_STATE` | `ACTIVE`/`ARCHIVED`/`REMOVED` |
| 22 | `SUPPLY_STATE` | `NO_REQUIREMENT/RESERVED/NOT_ORDERED/PARTIALLY_ORDERED/ORDERED/PARTIALLY_DELIVERED/DELIVERED` |
| 23 | `PRODUCTION_STATE` | `NOT_AVAILABLE/PARTIALLY_AVAILABLE/READY_FOR_HANDOFF/RECEIVED` |
| 24 | `DEFICIT_QTY` | дефицит |
| 28 | `AVAILABLE_FOR_PRODUCTION` | `reserved + realDelivery` |
| 31 | `REAL_DELIVERY_DATE` | дата фактической поставки |

`SUPPLY_STATE` и `PRODUCTION_STATE` вычисляются в `v12_calculate.js`
(`v12CalculatePositionState`) — это **чистая функция без I/O**, единый расчётный движок:
- `productionState = RECEIVED` если `receivedByProduction == true`;
- иначе `READY_FOR_HANDOFF` если `availableForProduction >= required && valid && !received`;
- иначе `PARTIALLY_AVAILABLE`/`NOT_AVAILABLE`.

Отметка «получено производством» (`v12MarkReceivedByProduction`, `v12_handoff.js`) пишет
`RECEIVED_BY_PRODUCTION=true`, `RECEIVED_BY_PRODUCTION_QTY=required`,
`RECEIVED_BY_PRODUCTION_AT=new Date()`, `RECEIVED_BY_PRODUCTION_USER=actor`, затем
**архивирует позицию** (`LIFECYCLE_STATE = ARCHIVED`). При возврате из архива
(`v12ReturnFromArchive`) поле `_AT` **сбрасывается в `""`**.

> **Вывод для «Скомплектовано»:** т.к. `ARCHIVED`-позиции остаются в агрегате, `RECEIVED_BY_PRODUCTION_AT`
> доступен для подсчёта максимума. Но при возврате хотя бы одной позиции из архива «Скомплектовано»
> должно исчезнуть (условие `collected === total` снова не выполняется) — это корректно.

---

## 8. Точки изменения (карта правок для Act Mode)

| Файл | Функция / константа | Что менять |
|------|---------------------|-----------|
| `v12_config.js` | `DASHBOARD_COLUMNS` | вставить колонку «На складе» после `TOTAL_POSITIONS` (сдвиг последующих индексов) |
| `v12_config.js` | `HEADERS.DASHBOARD`, `COLUMN_COUNT.DASHBOARD` | добавить заголовок «На складе», число колонок 9→10 |
| `v12_config.js` | `BOM_STATUS` | новые подписи (5 состояний) |
| `v12_config.js` | `BOM_STATUS_COLOR` | новые цвета (red/orange/yellow/stock/green); опц. `COLORS` дополнить |
| `v12_projections.js` | `v12AggregateBomStates` | добавить счётчики: `onShelf` (READY_FOR_HANDOFF & !received), `notOrderedOrNoDate`, `maxReceivedAt` |
| `v12_projections.js` | `v12ComputeBomStatus` | переписать под 5 новых состояний (сохранив гейт READY для «Выполнено») |
| `v12_projections.js` | `v12RefreshDashboard` | формат строки: новый столбец «На складе», текст статуса, заливка по статусу |
| `v12_projections.js` | `v12DashboardStatusText`/`v12DashboardPercentColor` | заменить/вывести из использования (прогрессбар убирается) |
| `v12_projections.js` | `v12BuildMissingItemsText` | ветка «Скомплектовано - dd.MM.yyyy HH:mm» + новый форматтер с временем |
| `v12_sheet_service.js` | `v12MigrateDashboardSchema` | вставить физическую колонку, обновить legacy-список |
| `v12_sheet_service.js` | `v12ApplyTableAlignment` | пересчитать `DASHBOARD: [..]` под новое число/сдвиг колонок |
| `v12_sheet_service.js` | `v12FormatDashboardSheet` | при необходимости ширина/перенос для новой колонки |
| `v12_trigger.js` | `v12IsBomReadyForDone` | синхронизировать с новым определением «Скомплектован» (= `READY`) |
| `_local_tests/v12_dashboard_test.js` | тесты D–I | обновить ожидания (схема, тексты статусов, цвета) |

---

## 9. Неочевидные моменты и подводные камни

1. **`v12ComputeBomStatus` нельзя просто удалить** — от него зависит гейт чекбокса «Выполнено»
   (`v12IsBomReadyForDone`). Ломать его ≙ сломать установку галочки «Выполнено».
2. **Скрытая колонка `BOM_ID` (кол. 2)** — визуально спрятана, но нужна движку для обработчика
   «Выполнено» (`v12HandleDashboardEdit` читает `sheet.getRange(row, D.BOM_ID)`). При вставке
   колонки порядок сдвигается, но `BOM_ID` остаётся на позиции 2 — главное, чтобы миграция
   вставляла новый столбец ПОСЛЕ неё и корректно обновила все индексы.
3. **ARCHIVED ≠ REMOVED**: агрегат дашборда игнорирует только `REMOVED`; переданные производству
   позиции (`ARCHIVED`) продолжают считаться. Это и позволяет считать `collected` и «Скомплектовано».
4. **Порядок приоритетов статусов** — в ТЗ состояния перечислены, но без явной таблицы
   приоритетов. Логичный (и ожидаемый) порядок проверки: сначала «Скомплектован» (все получены),
   затем «На складе, ждет отборки» (все на складе), затем «Есть незаказанные компоненты»
   (red), затем «(Опаздывает)» (orange), иначе «(В срок)» (yellow). Это неочевидно и требует
   согласования — особенно пересечение состояний «На складе» и «Опаздывает».
5. **Статус «Ошибка данных»** в новом списке отсутствует, но в коде есть проверка
   `VALIDATION_STATUS.ERROR` и в агрегат собирается `errors`. Нужно решить: сохранять ли
   отдельный серый статус для невалидных BOM (риск: «поломка» отображения для BOM с ошибками)
   или вливать их в «Есть незаказанные компоненты».
6. **«На складе» = не «Собрано»**: `collected` (передано производству) и `onShelf`
   (готово к передаче, но ещё не передано) — РАЗНЫЕ величины. Колонка «Собрано» уже есть
   (кол. 6); новая «На складе» — дополняющая.
7. **Формат даты-со-временем**: `v12FormatDateOnly` возвращает `dd.MM.yyyy` без времени; для
   «Скомплектовано» нужен новый форматтер, использующий `V12_CONFIG.SETTINGS.DATE_FORMAT`
   (`"dd.MM.yyyy HH:mm"`).
8. **Тесты — контракт**: `_local_tests/v12_dashboard_test.js` жёстко проверяет текущее поведение
   (9 колонок, текст `"50% █████..."`, цвет по проценту, отсутствие ключей `PROGRESS`/`UPDATED_AT`).
   Эти тесты придётся обновить — они описывают старое (прогрессбарное) поведение.
9. **Модель V3 «Применить»**: дашборд пересобирается целиком (`v12RefreshDashboard`) только по
   кнопке «Применить», из `v12RunFullSync` и из действующих немедленно обработчиков (чекбокс
   «Выполнено», склад). Никакой фоновой пересборки нет — учёт этого важен, чтобы не ждать
   мгновенного отражения правок из `PENDING_EDITS` до нажатия «Применить».

---

## 10. Порядок чтения для разработчика

1. `v12_config.js` — `DASHBOARD_COLUMNS`, `HEADERS.DASHBOARD`, `BOM_STATUS`, `BOM_STATUS_COLOR`,
   `COLORS` (схема и цвета — с чего начинается изменение).
2. `v12_projections.js` — `v12AggregateBomStates` → `v12ComputeBomStatus` → `v12RefreshDashboard`
   → `v12BuildMissingItemsText` (вся логика дашборда в одном файле).
3. `v12_calculate.js` — `v12CalculatePositionState` (как выводятся `SUPPLY_STATE` / `PRODUCTION_STATE`).
4. `v12_handoff.js` — `v12MarkReceivedByProduction` / `v12ReturnFromArchive` (отметка «получено»,
   `RECEIVED_BY_PRODUCTION_AT`, архивация).
5. `v12_sheet_service.js` — `v12MigrateDashboardSchema`, `v12ApplyTableAlignment`,
   `v12FormatDashboardSheet` (миграция схемы и форматирование).
6. `v12_trigger.js` — `v12IsBomReadyForDone`, `v12HandleDashboardEdit` (гейт «Выполнено»).
7. `_local_tests/v12_dashboard_test.js` — как проверяется дашборд (обновить под новое поведение).

---

## 11. Что дальше (реализация — в Act Mode)

Я в **Explore Mode** — могу только анализировать и документировать, но не менять код.
Чтобы реализовать описанное выше (вернуть текстовый статус с цветами, добавить колонку
«На складе», вывод «Скомплектовано — дата/время»), переключитесь в **Act Mode** через
селектор режимов внизу чата. Все находки этого документа перенесутся как контекст.
