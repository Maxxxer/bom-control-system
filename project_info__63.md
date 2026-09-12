# BOM CONTROL SYSTEM V12 — Дашборд: колонка «Статус» и связанные изменения

Сохранил подробный отчёт в **`project_info__62.md`** (корень проекта). Ниже — те же находки.

> **Режим: Explore Mode.** Это результат исследования кодовой базы: как сейчас устроен лист
> **Dashboard**, где живёт логика статуса/прогрессбара, какие данные доступны, и **что конкретно
> нужно изменить**. Правки кода выполняются в **Act Mode**.

> **Задача:** вернуть в Dashboard текстовую колонку статуса вместо прогрессбара (состояния + цвет),
> добавить колонку «На складе» после «Позиций», и в «Недостающие материалы» при полной комплектации
> писать «Скомплектовано — <дата и время последней отметки "получено">».

---

## 1. Кратко о задаче и текущем состоянии

Запрос описывает **5 новых статусов BOM** и **2 новых поля вывода**. Сейчас вместо текста дашборд
показывает **процент сборки + прогрессбар** (`45% █████░░░░░`) с плавной заливкой
«красный → жёлтый → зелёный» по проценту. Текстовая логика статуса (`V12_CONFIG.BOM_STATUS` +
`BOM_STATUS_COLOR`) **сохранилась в коде**, но **больше не используется для отображения** — её
применяет только гейт чекбокса «Выполнено». То есть «вернуть колонку статуса» = переработать
`v12ComputeBomStatus` → текст и вернуть заливку по статусу, но уже с новым набором состояний.

### Запрошенные статусы

| № | Условие | Текст статуса | Цвет |
|---|---------|---------------|------|
| 1 | Хотя бы одна позиция не заказана ИЛИ не указана ожидаемая дата хотя бы у одной | **Есть незаказанные компоненты** | красный `#F4CCCC` |
| 2 | Все заказаны, но хотя бы одна поставка ПОЗЖЕ крайнего срока | **Ожидается поставка (Опаздывает)** | оранжевый `#F4B183` (по аналогии) |
| 3 | Все заказаны, срок всех ≤ крайнего срока | **Ожидается поставка (В срок)** | жёлтый `#FFF2CC` |
| 4 | Все на складе, но не все переданы в производство | **На складе, ждет отборки** | голубой `#9FC5E8` (`STOCK`) |
| 5 | Все получены производством | **Скомплектован, готов к работе** | зелёный `#D9EAD3` |

### Новые поля
- **«На складе»** — сразу после «Позиций» (кол. 5): количество позиций BOM в состоянии
  `PRODUCTION_STATE.READY_FOR_HANDOFF` (готово к отборке, но ещё не передано производству).
- **«Недостающие материалы»** — если ВСЕ позиции получены производством, вместо списка недостач
  выводить `Скомплектовано - <дата и время последней отметки «получено»>`; время из
  `POSITION_STATE.RECEIVED_BY_PRODUCTION_AT`, формат `dd.MM.yyyy HH:mm`.

---

## 2. Текущая схема листа Dashboard

Задана в `v12_config.js` (`DASHBOARD_COLUMNS`, `HEADERS.DASHBOARD`). Сейчас **9 колонок**:

| Кол. | Ключ | Заголовок |
|------|------|-----------|
| 1 | `DONE` | Выполнено (чекбокс, активен только при готовности) |
| 2 | `BOM_ID` | BOM ID (**скрыта**, нужна движку) |
| 3 | `BOM_NAME` | BOM |
| 4 | `STATUS` | Статус — **сейчас** `"45% █████░░░░░"` + заливка по проценту |
| 5 | `TOTAL_POSITIONS` | Позиций |
| 6 | `COLLECTED_POSITIONS` | Собрано |
| 7 | `DATE_CREATED` | Дата создания |
| 8 | `DEADLINE` | Крайний срок |
| 9 | `MISSING_ITEMS` | Недостающие материалы |

Формирование строки — `v12RefreshDashboard` (`v12_projections.js`):
```js
rows.push([ done, bomId, a.bomName,
  v12DashboardStatusText(progress),        // <-- тут был текст статуса
  a.total, a.collected,
  v12FormatDateOnly(revDates[bomId]),
  v12FormatDateOnly(a.minDeadline),
  missingText ]);
statusColors.push(v12DashboardPercentColor(progress));  // <-- заливка «по проценту»
```
Сопутствующие: `v12DashboardStatusText`, `v12DashboardPercentColor`, `v12InterpolateColor`,
`v12ApplyDashboardStatusColors`, `v12SetupDashboardNotes`.

---

## 3. Агрегация — `v12AggregateBomStates(posData)`

Считает по BOM: `total`, `collected` (переданные производству), `notOrdered`, `partial`, `late`,
`onTime`, `errors`, `missing[]`, `minDeadline`. Ключевые детали:
- игнорируется только `LIFECYCLE_STATE === REMOVED`; **ARCHIVED учитывается** (поэтому переданные
  позиции остаются в агрегате и попадают в `collected`);
- `production === RECEIVED` → `collected++`;
- `ORDERED` и `EXPECTED_DATE > DEADLINE` → `late++`, иначе `onTime++`.

**Не хватает для новой задачи:** счётчика «на складе, ждёт отборки» (`READY_FOR_HANDOFF` и `!received`),
признака «есть позиция без ожидаемой даты», и максимума `RECEIVED_BY_PRODUCTION_AT`.

---

## 4. Статус BOM — `v12ComputeBomStatus(agg)`

Текущая логика (для отображения больше не используется, но **жива для гейта**):
```js
errors>0 → ERROR; collected==total → READY;
notOrdered==total → NOT_PROCESSED; notOrdered>0||partial>0 → PARTIAL_SELECTED;
late>0 → WAITING_LATE; иначе WAITING_ON_TIME;
```

### КРИТИЧНЫЙ ИНВАРИАНТ
`v12ComputeBomStatus` используется в `v12_trigger.js`:
```js
function v12IsBomReadyForDone(bomId) {
  const a = v12AggregateBomStates()[id];
  return !!a && v12ComputeBomStatus(a) === V12_CONFIG.BOM_STATUS.READY;
}
```
Галочку «Выполнено» (`v12HandleDashboardEdit`) можно поставить только когда BOM «готов». Переработка
`v12ComputeBomStatus`/`BOM_STATUS` **обязана сохранить этот гейт** (или заменить на новое состояние
«Скомплектован»), иначе сломается отметка «Выполнено».

Цвета: `BOM_STATUS_COLOR` (подпись→ключ цвета) уже есть и **сейчас не применяется** — готовый шаблон
для «возврата цветовой раскраски». Палитра — `V12_CONFIG.COLORS` (`RED/ORANGE/YELLOW/GREEN/STOCK/GRAY/WHITE`,
а `PROGRESS_LOW/MID/HIGH` станут не нужны).

---

## 5. «Недостающие материалы» — `v12BuildMissingItemsText(missing)`

Сейчас: строки `"<qty> - <model> - <dd.MM.yyyy>"`, сортировка по ожидаемой дате по убыванию.
**Нужно:** если `collected === total` — возвращать `"Скомплектовано - dd.MM.yyyy HH:mm"` (максимум
`RECEIVED_BY_PRODUCTION_AT`). Понадобится новый форматтер с временем (сейчас есть только
`v12FormatDateOnly` — без времени).

---

## 6. Миграция и форматирование — `v12_sheet_service.js`

- `v12MigrateDashboardSchema()` — удаляет legacy-колонки `["Прогресс","Обновлено"]`, пишет канон
  заголовков, скрывает `BOM_ID`, сбрасывает условное форматирование.
  **Для новой колонки нужно физически вставить столбец** (`insertColumnBefore`/`insertColumnsAfter`) —
  сейчас миграция умеет только удалять.
- `v12ApplyTableAlignment()` — `DASHBOARD: [1,4,5,6,7,8]` — **индексы придётся пересчитать**.
- `v12FormatDashboardSheet()` — ширина/перенос `MISSING_ITEMS` (возможно, задать и для новой колонки).

---

## 7. Источники данных (`POSITION_STATE`, 31 колонка)

Релевантны: `ORDERED_QTY`(12), `EXPECTED_DATE`(14), `DEADLINE`(15), `RECEIVED_BY_PRODUCTION_*`(16-19,
включая `_AT`), `VALIDATION_STATUS`(20), `LIFECYCLE_STATE`(21), `SUPPLY_STATE`(22),
`PRODUCTION_STATE`(23), `DEFICIT_QTY`(24), `AVAILABLE_FOR_PRODUCTION`(28), `REAL_DELIVERY_DATE`(31).

`SUPPLY_STATE`/`PRODUCTION_STATE` выводятся чистой функцией `v12CalculatePositionState`
(`v12_calculate.js`). Отметка «получено» (`v12MarkReceivedByProduction`, `v12_handoff.js`) пишет
`RECEIVED_BY_PRODUCTION_AT = new Date()` и **архивирует** позицию; при возврате из архива `_AT`
**сбрасывается**. Архивные позиции остаются в агрегате → максимум `_AT` вычислим.

---

## 8. Карта правок (для Act Mode)

| Файл | Что менять |
|------|-----------|
| `v12_config.js` | `DASHBOARD_COLUMNS` (вставить «На складе» после `TOTAL_POSITIONS`, сдвиг), `HEADERS.DASHBOARD`, `COLUMN_COUNT.DASHBOARD` (9→10), `BOM_STATUS` (5 подписей), `BOM_STATUS_COLOR` (цвета) |
| `v12_projections.js` | `v12AggregateBomStates` (счётчики `onShelf`, `notOrderedOrNoDate`, `maxReceivedAt`); `v12ComputeBomStatus` (новая логика, сохранить гейт); `v12RefreshDashboard` (строка/статус/цвет); `v12DashboardStatusText/PercentColor` (вывести из использования); `v12BuildMissingItemsText` (ветка «Скомплектовано» + форматтер с временем) |
| `v12_sheet_service.js` | `v12MigrateDashboardSchema` (вставка колонки), `v12ApplyTableAlignment` (пересчёт), `v12FormatDashboardSheet` |
| `v12_trigger.js` | `v12IsBomReadyForDone` (синхронизировать с новым «Скомплектован») |
| `_local_tests/v12_dashboard_test.js` | обновить ожидания (схема, тексты, цвета) |

---

## 9. Подводные камни

1. `v12ComputeBomStatus` **нельзя удалять** — от него зависит гейт «Выполнено».
2. Скрытая `BOM_ID` (кол. 2) нужна обработчику «Выполнено» — новая колонка должна вставляться ПОСЛЕ неё.
3. `ARCHIVED ≠ REMOVED`: только `REMOVED` выпадает из агрегата, переданные позиции продолжают считаться.
4. **Порядок приоритетов статусов** в задаче не задан явно — ожидаемый: «Скомплектован» → «На складе»
   → «Есть незаказанные» → «(Опаздывает)» → «(В срок)». Требует согласования (пересечение «На складе» и «Опаздывает»).
5. Статус «Ошибка данных» в новом списке отсутствует, хотя `errors` считается — нужно решить, сохранять ли серый статус.
6. «На складе» ≠ «Собрано»: `onShelf` (готово к передаче) и `collected` (уже передано) — разные величины.
7. Нужен форматтер даты-со-временем (`SETTINGS.DATE_FORMAT = "dd.MM.yyyy HH:mm"`).
8. `_local_tests/v12_dashboard_test.js` жёстко фиксирует старое поведение — обновить.
9. Модель V3 «Применить»: дашборд пересобирается только по кнопке/синку/немедленным обработчикам — фоновой пересборки нет.

---

## 10. Порядок чтения

1. `v12_config.js` → 2. `v12_projections.js` → 3. `v12_calculate.js` → 4. `v12_handoff.js` →
5. `v12_sheet_service.js` → 6. `v12_trigger.js` → 7. `_local_tests/v12_dashboard_test.js`.

---

## 11. Что дальше

Я в **Explore Mode** — только анализ и документация, менять код не могу. Чтобы реализовать описанное
(вернуть текстовый статус с цветами, добавить колонку «На складе», вывод «Скомплектовано — дата/время»),
переключитесь в **Act Mode** через селектор режимов внизу чата. Все находки этого отчёта
(и файл `project_info__62.md`) перенесутся как контекст.