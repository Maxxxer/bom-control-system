# BOM CONTROL SYSTEM — массовый ввод данных: как устроена правка сейчас и как сделать ввод диапазоном

> Отчёт исследовательского режима. Задача: предложить механизм, при котором даты, чекбоксы и
> количества можно вводить **массово** (выделил диапазон — вставил из Excel), а не по одной ячейке.
> Отчёт отвечает на три вопроса: (1) как правка данных устроена сегодня, (2) какие ограничения
> текущей архитектуры определяют решение, (3) какой вариант решения предлагается — с конкретными
> файлами, потоком данных и инвариантами.

---

## Summary

`BOM CONTROL SYSTEM` — веб-приложение (Fastify + TypeScript + PGlite/PostgreSQL на сервере, React + Vite
в интерфейсе) для управления обеспечением сборочного производства: спецификации, дефициты, снабжение,
склад, отборка, WORKING BOM, дашборд, архив передач, пользователи и журнал действий.

Ключевая особенность, определяющая всю архитектуру: **весь расчёт живёт на сервере**, интерфейс только
показывает пришедшее и отправляет изменения. Правка данных выполняется **по одной ячейке** — каждый
`Editable*` компонент отправляет один HTTP-запрос и после ответа перезагружает весь экран. Массового
ввода (диапазон + вставка из Excel) в системе нет ни на клиенте, ни в API — **единственное исключение:
передача материала производству** (`POST /api/handoff`), которая уже принимает список позиций, работает
в одной транзакции и возвращает результат по каждой строке. Этот прецедент и берётся за образец.

---

## 1. Как правка данных устроена сейчас

### 1.1 Четыре клиентских поля правки

Все ячейки, которые можно менять, сделаны четырьмя компонентами в `bom-web/web/src/ui/`:

| Компонент | CSS-класс | Значение | Поведение |
| --- | --- | --- | --- |
| `EditableNumber.tsx` | `input.cell-input` | `number` | Пусто → `0`; `,` → `.`; проверка `/^\d+(\.\d+)?$/`; текст ошибки «Введите неотрицательное число, например 10 или 2,5»; выравнивание вправо, моноширинный шрифт |
| `EditableDate.tsx` | `input.cell-date` | `string \| null` (`ГГГГ-ММ-ДД`) | Разбор через `parseDateInput` (`ДД.ММ.ГГГГ`, `ГГГГ-ММ-ДД`, разделители `.` `,` `/`); `allowEmpty` — можно снять дату |
| `EditableText.tsx` | `input.cell-text` | `string` | `label` для текста ошибки, `allowEmpty`, `placeholder`; при пустом обязательном поле не сохраняет |
| `EditableCheckbox.tsx` | нативный `input[type=checkbox]` | `boolean` | Переключается **сразу**, при отказе сервера возвращается в исходное состояние |

Общий контракт, повторяющийся во всех четырёх:

- проп `onSave(next) => Promise<boolean>` — `true`, если данные действительно изменились;
- `Enter` или уход из поля (`onBlur`) — сохранить, `Escape` — отменить;
- на фокусе значение **выделяется целиком** (`event.currentTarget.select()`) — иначе первый символ
  дописывался бы к прежнему значению (`0` + `5` = `50`, `30.09.2026` + `1` = `130.09.2026`);
- `useEffect(() => { if (!editing) setText(...) })` — **вне редактирования поле всегда показывает
  состояние сервера**. Это и есть механизм «после ответа показываем то, что в базе»;
- внутренний `busy` блокирует само поле на время запроса.

### 1.2 Общая таблица — `ui/DataTable.tsx`

`DataTable<Row>` — единственная таблица на все рабочие экраны. Всё, что нужно знать для диапазонного
выделения, сосредоточено здесь:

- `Column<Row>`: `key`, `title`, `sortValue?`, `render(row)`, `numeric?`, `width?`, `sticky?`;
- **сортировка выполняется на клиенте** в `useMemo` и результат живёт **внутри** компонента
  (`sortedRows`). Наружу отдаётся только `rows` — то есть **страница не знает видимый порядок строк**;
- липкие колонки (`sticky: true`) считаются только для ведущих колонок подряд; смещение вычисляется из
  `width` **в пикселях** (`widthInPixels`), а жёсткая раскладка (`table.fixed`) включается только если
  пиксельные ширины заданы у **всех** колонок (`declaredWidthOf`);
- в `<td>` нет ни `tabIndex`, ни идентификатора ячейки, ни обработчиков клавиатуры; фокус получают
  вложенные `<input>` в порядке документа;
- подсветка строки — через `rowBackground(row)`, а не класс.

### 1.3 Пять экранов, где данные правятся

| Экран | Файл | Поля, доступные правке | Право |
| --- | --- | --- | --- |
| Сводка дефицитов | `pages/DeficitPage.tsx` | «Заказано», «Ожидаемая поставка», «Поставлено» (чекбокс), «Крайний срок» | `ORDERED_QTY`, `EXPECTED_DATE`, `REAL_DELIVERY`, `DEADLINE` |
| Карточка спецификации | `pages/BomCardPanel.tsx` + `pages/bomCardColumns.tsx` | `№`, `Наименование`, `Модель`, `Артикул`, `Производитель`, `Ед.изм`, `Нужно`, `Резерв`, `Крайний срок` — 9 полей | `SOURCE_BOM_WRITE` |
| Склад | `pages/WarehousePage.tsx` | «Остаток» | `WAREHOUSE_QTY` |
| Отборка | `pages/PickingPage.tsx` | **выбор строк чекбоксами** + «Отметить готовые» + передача списком | `PICKING_CHECKBOX` |
| WORKING BOM / Дашборд | `WorkingBomPage.tsx`, `DashboardPage.tsx` | передача по одной строке / кнопка «Готово» | `WORKING_BOM_CHECKBOX`, `DASHBOARD_CHECKBOX` |

На каждом экране действует общий шаблон сохранения (`DeficitPage.apply`, `BomCardPanel.saveField`):

```ts
const reply = await run(action);            // useAction.run: ловит сетевую ошибку + тост
if (reply.status === 'blocked') { toast.error(reply.reason); return false; }
if (reply.status === 'already') { toast.info('Значение уже такое — изменений нет'); return false; }
toast.success('Изменение сохранено');
reload();                                   // useLoader: перечитать ВСЁ
return true;
```

### 1.4 Три клиентских хука, определяющих поведение

- `app/useAction.ts` — `{ busy, run }`. `run` возвращает `undefined` при сетевой ошибке и показывает
  тост. **`busy` — один флаг на всю страницу**, и страницы передают его как `disabled` во **все** поля:
  `disabled={!canOrder || busy}`. То есть одна правка замораживает всю таблицу.
- `app/useLoader.ts` — `{ data, loading, error, reload }`. Ключ (`deficit|${project}`) определяет, когда
  данные перечитываются; `reload()` увеличивает счётчик попыток и запускает **полную** перезагрузку.
- `api/client.ts` — `postOperation()`: ответ **409** не бросает исключение, а возвращается как обычный
  результат. Это позволяет показывать причину отказа рядом со строкой. Здесь же `encodeId` — идентификаторы
  позиций содержат `:`, `#`, `|` и кириллицу.

### 1.5 Серверные операции: шаблон «проверил → применил → записал»

`server/src/services/positionService.ts` — шесть операций (`setOrderedQty`, `setExpectedDate`,
`setRealDeliveryQty`, `setRealDeliveryChecked`, `setDeadline`, `setSpecField`), все построены одинаково:

1. `requirePermission(ctx.role, '...')` — бросает `PermissionDeniedError` → HTTP 403;
2. `loadPosition(db, positionId)` — нет позиции или `lifecycle === 'REMOVED'` → `{ status: 'blocked' }`;
3. сравнение с текущим значением → `{ status: 'already' }` **без записи в журнал** (иначе журнал
   засорялся бы повторными щелчками);
4. `db.transaction(tx => { updateOperatingFields | updatePositionSpec; recordChanges(tx, ctx, [...]) })`;
5. `finish()` — перечитать позицию и вернуть её актуальное состояние.

Вспомогательные слои:

- `repositories/positions.ts` — `updateOperatingFields` собирает `SET` динамически и делает
  `version = version + 1`, `updated_at = now()`. **Никто `version` не читает** — конфликты записи сейчас
  разрешаются «последний победил» молча. `insertPositions` вставляет порциями по 200
  (`INSERT_CHUNK_SIZE`); `deletePositionsByPositionIds` использует `position_id = any($1::text[])`.
- `services/operationLog.ts` — `OperationContext { actor, role, operationId }`, где `operationId` —
  `randomUUID()` на одну команду. `recordChanges(tx, ctx, changes[])` пишет **одним INSERT** и в
  `audit_log`, и в `position_history`. Это готовый механизм «одна команда = одна операция в журнале».
- `http/operationReply.ts` — `sendOperation`: `blocked` → HTTP 409 с `{status, reason, notice, position}`,
  иначе 200.
- `domain/values.ts` — нормализация «грязных» значений: `toNumber` понимает `1,234.56` и `1.234,56`;
  `toQty` отсекает отрицательные; `isChecked` понимает `true/1/yes/истина/да`; `toDate` понимает
  **серийные даты Excel** (номер дня от 1899-12-30) и строки `ДД.ММ.ГГГГ`, `ГГГГ-ММ-ДД`, ISO.
- `domain/specFields.ts` — `EDITABLE_SPEC_FIELDS` (9 полей), `normalizeSpecField` (по полю: `rowNo > 0`,
  `requiredQty > 0`, `reservedQty >= 0`, `deadline` обязателен, `name/model/unit` непусты, `code/manufacturer`
  необязательны) и `describeKeyNote` → `notice`: **ключ материала не пересчитывается**, чтобы не отвязать
  склад, архив и историю.

### 1.6 Готовый прецедент массовой операции — передача производству

`server/src/services/handoffService.ts` (`markReceivedByProduction`) — это уже **массовая операция**, и её
устройство надо повторить:

- принимает `positionIds: readonly string[]`;
- дедупликация через `Set<string> acknowledged`;
- **одна** `db.transaction` на всю команду;
- по каждой позиции **свой** результат `{ status: 'handoff' | 'already' | 'blocked', reason? }` —
  одна заблокированная строка **не отменяет** остальные;
- агрегаты `{ handedOff, returned, skipped, blocked }`;
- один `ctx.operationId` и **один** `recordChanges(tx, ctx, allChanges)` на всю команду;
- маршрут (`handoffRoutes.ts`) отвечает 409, только если **ничего** не применилось и что-то заблокировано.

На клиенте `PickingPage.tsx` уже реализует привычный пользователю сценарий: `Set<string> selected`,
кнопка «Отметить готовые (N)», «Снять выбор», одна кнопка «Передать производству». Это ровно та
UX-модель, которую нужно распространить на ввод значений.

---

## 2. Ограничения, которые определяют решение

1. **Один запрос на одну ячейку.** Вставка 40 × 4 = 160 ячеек «в лоб» даст 160 запросов, 160 транзакций и
   160 записей в журнале с **разными** `operation_id` — журнал перестанет показывать, что это одно действие.
2. **`busy` — глобальный.** Во время вставки вся таблица станет нередактируемой и «мигнёт» 160 раз.
3. **`reload()` после каждой ячейки.** `apply()` в `DeficitPage` вызывает `reload()` на каждое сохранение —
   при массовой вставке это полная перезагрузка витрины десятки раз.
4. **`DataTable` не знает видимый порядок строк.** Сортировка внутри компонента. Для «вставить блок как в
   Excel» странице нужен **тот же порядок**, что видит пользователь.
5. **Клиентская валидация беднее серверной.** `EditableNumber.validate` принимает только
   `/^\d+(\.\d+)?$/` после замены одной запятой на точку, а серверный `toNumber` умеет `1 234,56`,
   `1,234.56`, NBSP и серийные даты Excel. При вставке из Excel клиентская проверка будет отвергать то,
   что сервер бы принял.
6. **Права проверяются броском исключения** (`requirePermission` → 403), а массовая операция, по аналогии
   с передачей, должна уметь «частичный успех».
7. **Строки отфильтрованы на клиенте** (`matchesSearch`, фильтр проекта). Вставка должна работать по
   видимым строкам — но это надо явно проговорить, иначе «вставил 40, изменилось 12» будет выглядеть
   как ошибка.
8. **`PGlite` — встроенная однопоточная БД.** Очень большая транзакция держит блокировку, поэтому
   неограниченный размер вставки недопустим (нужен лимит).

---

## 3. Вариант решения

Идея: **сетка выделения поверх существующей `DataTable` + один массовый эндпоинт, повторяющий устройство
передачи производству.** Расчёт и правила остаются на сервере; клиент лишь раскладывает блок из буфера
обмена в набор изменений.

### Уровень A — модель выделения диапазона (только клиент)

Новый модуль `bom-web/web/src/ui/gridSelection.ts`:

- **чистые функции** (тестируются без React): `CellAddress {row, col}`, `GridRange {top,left,bottom,right}`,
  `rangeOf(anchor, focus)`, `normalizeRange(range)`, `rangeContains(range, cell)`, `rangeSize(range)`,
  `nextCell(cell, key, bounds)`;
- **хук** `useGridSelection({ rows, columns, anchor })` → `{ range, isSelected(cell), setAnchor, extendTo,
  clear, selectAll, moveFocus }`; обработка `mousedown` / `mouseenter` (протяжка) / `mouseup` / `Shift+Click`
  / стрелок / `Shift+стрелка` / `Ctrl+стрелка` / `Escape`.

Изменения в `ui/DataTable.tsx`:

- **вынести сортировку наружу**: экспортировать `useTableSort(columns, rows)` (тот же `useMemo`, который
  сейчас внутри), а `DataTable` сделать презентационным — тогда порядок строк известен странице и
  индекс в массиве = индекс на экране. Это минимальная и самая предсказуемая правка;
- добавить проп `selection` (`useGridSelection`) и `onPaste(text, range)`;
- в `Column<Row>` добавить **необязательные** метаданные ячейки: `cellId?: string` (имя поля для сервера),
  `editable?: boolean`, `toText?: (row) => string` (что положить в буфер при копировании),
  `parse?: (raw: string) => unknown` (как прочитать вставленное);
- в `<td>` проставить `data-cell={column.cellId}` и `aria-selected`, добавить классы `.cell-selected`
  (диапазон), `.cell-anchor` (якорь), `.cell-invalid` (не прошло проверку).

Стили — в `web/src/styles/components.css`, на существующих токенах брендбука
(`--mair-orange-tint`, `--mair-navy`, `--line-strong`), рядом с правилами `input.cell-input` /
`input.cell-date` / `input.cell-text`.

Важное решение по фокусу, которое надо принять сознательно: сегодня клик по ячейке **сразу** ставит фокус
в `<input>` и выделяет текст. В режиме сетки это мешает — 200 полей будут перехватывать стрелки. Поэтому
предлагается **два режима, как в Excel**: фокус на контейнере таблицы (roving `tabIndex`), стрелки
двигают выделение; вход в правку — `Enter`, `F2` или двойной щелчок. Это изменение привычки пользователя,
и его нужно проговорить с заказчиком.

### Уровень B — буфер обмена (TSV, как у Excel/Google Sheets)

Новый модуль `bom-web/web/src/ui/clipboardGrid.ts`:

- `parseClipboard(text): string[][]` — нормализовать `\r\n` → `\n`, обрезать хвостовую пустую строку,
  разбить по `\t` (и, как запасной вариант, по `;` — в русской локали Excel иногда так и копирует);
- `serializeRange(rows, columns, range, toText): string` — собрать TSV для `Ctrl+C`;
- `toCheckboxValue(raw): boolean` — повторить семантику серверного `isChecked` (`1`, `да`, `true`, `yes`,
  `истина`, `+`, `✓`);
- `toDateCell(raw): string | null` — переиспользовать `parseDateInput` из `web/src/format.ts`; **серийные
  даты Excel и форматы с разделителями оставить серверу** (он их уже понимает — `toDate`).

Поведение вставки (`onPaste` на контейнере таблицы) — как в Excel:

| Буфер | Выделение | Что делаем |
| --- | --- | --- |
| 1 × 1 | одна ячейка | вставить в неё |
| M × N | ровно M × N | ячейка в ячейку |
| M × N | одна ячейка | развернуть блок вниз и вправо от якоря |
| 1 × N или M × 1 | больше буфера | «заполнить» весь выделенный диапазон (по столбцу/строке) |
| любой | выходит за пределы видимых строк | отказ с понятным текстом |

Копирование — `Ctrl+C` по выделению (чекбоксы в буфере как `да`/`нет`). **`Ctrl+X` (вырезание) не
делаем:** массовая очистка полей снабженца — слишком опасная операция без запроса на подтверждение.

### Уровень C — один массовый запрос и одна транзакция

Ключевая часть: **`POST /api/positions/bulk`** с **разнородными** изменениями в одном запросе — иначе
нельзя вставить блок, покрывающий сразу «Заказано» + «Ожидаемая поставка» + «Крайний срок».

Запрос:

```jsonc
{
  "changes": [
    { "positionId": "1234.АБВ:AB-12|Bosch#2", "field": "orderedQty",   "value": "120" },
    { "positionId": "1234.АБВ:AB-12|Bosch#2", "field": "expectedDate", "value": "20.09.2026" },
    { "positionId": "1234.АБВ:CD-34|Siemens#1","field": "deadline",    "value": null },
    { "positionId": "1234.АБВ:CD-34|Siemens#1","field": "spec.model",  "value": "R-1" }
  ]
}
```

Ответ — тот же по духу, что у передачи производству:

```jsonc
{
  "results": [
    { "positionId": "…", "field": "orderedQty", "status": "applied", "reason": "", "notice": "" },
    { "positionId": "…", "field": "expectedDate", "status": "already", "reason": "" },
    { "positionId": "…", "field": "deadline", "status": "blocked",
      "reason": "Крайний срок обязателен: укажите дату в формате ДД.ММ.ГГГГ" }
  ],
  "applied": 2, "already": 1, "blocked": 1,
  "operationId": "…",
  "positions": [ /* обновлённые позиции — чтобы клиент перерисовал без полного reload */ ]
}
```

Серверная реализация (три новых/изменённых места):

1. `server/src/domain/bulkFields.ts` (**новый, чистый**) — `BulkField` = операционные поля
   (`orderedQty`, `expectedDate`, `realDeliveryQty`, `realDeliveryChecked`, `deadline`) + поля
   спецификации (`spec.rowNo`, `spec.code`, … `spec.reservedQty`); `isBulkField`;
   `bulkPermission(field): PermissionAction` (таблица «поле → право»);
   `normalizeBulkValue(field, value)` — для полей спецификации делегирует в `normalizeSpecField`, для
   операционных — в `toQty` / `toIsoDate` / `isChecked`. Чистые правила ⇒ тестируются без базы
   (как `specFields.test.ts`).
2. `server/src/services/bulkService.ts` (**новый**) — `applyBulkChanges(db, ctx, { changes })`:
   - дедупликация `positionId|field`, «последнее побеждает» (как `acknowledged` в `handoffService`);
   - `MAX_BULK_CHANGES` (предлагается `2000` в `domain/constants.ts`, рядом с `LIMITS`) → `ValidationError`;
   - **одна** `db.transaction` на всю пасту;
   - по каждому изменению: `loadPosition` → сравнение с текущим (`already`) → `updateOperatingFields` или
     `updatePositionSpec` → накопление `ChangeRecord`; отказы (`blocked`) собираются, но не бросают;
   - **один** `recordChanges(tx, ctx, allChanges)` в конце — одна операция в журнале на всю вставку и одна
     пачка INSERT'ов вместо N (инфраструктура уже готова: `insertAudit` и `insertHistory` делают
     многострочную вставку);
   - для `realDeliveryQty` — `adjustWarehouseQty(tx, materialKey, ±delta)`: несколько позиций одного
     материала должны дать **суммарную** дельту склада (⚠ при реализации проверить, что
     `repositories/materials.ts::adjustWarehouseQty` суммирует дельты, а не перезаписывает остаток).
3. `server/src/http/routes/positionRoutes.ts` — маршрут `POST /api/positions/bulk`, новый
   `sendBulkReply` рядом с `sendOperation` в `http/operationReply.ts` (структура ответа другая — одну
   функцию на оба случая делать не надо). Код 409 — только если `applied === 0` и что-то `blocked`
   (как в `handoffRoutes`).
4. `server/src/repositories/positions.ts` — добавить `listPositionsByPositionIds(db, ids)` с
   `where p.position_id = any($1::text[])`: один запрос вместо N при сборке ответа.

**Права при массовой операции.** `requirePermission` бросает 403 и отменяет всё. Для вставки нужен
частичный успех, поэтому предлагается: проверять право **по каждому изменению** и возвращать
`status: 'blocked'`, `reason: 'Ваша роль не меняет это поле'`, применяя остальные. Это сознательное
отличие от одиночных операций, и его надо зафиксировать в документации и тесте. Как страховка на клиенте
колонки, недоступные роли, вообще не участвуют в выделении (`editable: false`).

### Уровень D — удобства, которые доводят механизм до уровня Excel

- **Заполнить вниз / вправо**: `Ctrl+D` / `Ctrl+R` — значение верхней (левой) ячейки диапазона
  раскладывается по остальным. Самый частый сценарий снабженца: «одна дата поставки на 30 строк».
- **Массовые чекбоксы**: выделить диапазон в колонке «Поставлено» и нажать `Space` (или `Ctrl+D`) —
  отметить все; отдельные пункты «Отметить все / Снять все» в панели действий. Реализуется через те же
  `realDeliveryChecked` / `handoff`, то есть без новых серверных операций.
- **Подтверждение крупной вставки**: если ячеек больше порога (предлагается 25), показать модальное окно
  (переиспользовать `ui/ConfirmDialog.tsx`): «Будет изменено N позиций, полей M. Продолжить?».
- **Одна перерисовка вместо N**: после ответа либо смёржить `positions` в локальное состояние, либо
  вызвать `reload()` **один раз** на пасту (сейчас `apply()` перезагружает экран на каждую ячейку).
- **Локальная занятость вместо глобальной**: заменить `useAction.busy` (один флаг на страницу) на
  множество `Set<string>` из `positionId|field` — чтобы вставка не блокировала остальную таблицу.
- **Необязательно, но почти бесплатно**: откат операции по `operation_id`. Данные для него уже есть —
  `listAuditByOperation(db, operationId)` в `repositories/auditLog.ts` и `old_value` в журнале. Это
  отдельная задача, но её не нужно «изобретать» заново.

---

## 4. Поток данных массовой вставки (пошагово)

1. Снабженец выделяет в Excel 40 строк в двух колонках и нажимает `Ctrl+C` → в буфере TSV.
2. В `/deficit` выделяет ячейку в «Заказано» первой строки и нажимает `Ctrl+V`.
3. `onPaste` на `.table-scroll` → `parseClipboard(text)` → `string[40][2]`.
4. `useGridSelection` разворачивает диапазон от якоря; если ячеек больше порога — `ConfirmDialog`.
5. Страница строит `changes`: для каждой ячейки — `columns[col].cellId` → поле, `row.positionId` → позиция,
   `columns[col].parse(raw)` → значение. `parse` при массовой вставке по возможности **отдаёт сырую
   строку серверу** (сервер умеет `1 234,56`, `1.234,56`, серийные даты Excel), а клиентская проверка
   используется только для подсветки «явно не то».
6. `api.applyBulkChanges(changes, ...)` → `POST /api/positions/bulk`
   (тип `BulkReply` в `web/src/api/types.ts`, функция в `web/src/api/endpoints.ts`).
7. Сервер: `authenticateWithContext` (сессия + роль) → `applyBulkChanges` → **одна транзакция**:
   `loadPosition` → сравнение → `updateOperatingFields` / `updatePositionSpec` → накопление `ChangeRecord`;
   для «Поставлено» — `adjustWarehouseQty(±delta)`; в конце **один** `recordChanges` (одна операция →
   один `operation_id` во всём журнале).
8. Ответ: `results[]` + `applied/already/blocked` + обновлённые `positions`.
9. Клиент: `applied` → зелёный тост «Изменено 40 из 160»; `already` → info «без изменений: 3»;
   `blocked` → красный тост с причинами (первые 3 и «и ещё N»); **один** `reload()` (или merge).

---

## 5. Что правится по файлам

### Интерфейс (`bom-web/web/src/`)

| Файл | Изменение |
| --- | --- |
| `ui/gridSelection.ts` | **новый**: чистая модель диапазона + хук `useGridSelection` |
| `ui/clipboardGrid.ts` | **новый**: `parseClipboard`, `serializeRange`, `toCheckboxValue`, `toDateCell` |
| `ui/DataTable.tsx` | вынести сортировку в `useTableSort`; пропы `selection`, `onPaste`; метаданные ячейки в `Column` (`cellId`, `editable`, `toText`, `parse`); `data-cell` / `aria-selected` в `<td>`; обработчики клавиатуры на контейнере |
| `ui/EditableNumber.tsx`, `EditableDate.tsx`, `EditableText.tsx`, `EditableCheckbox.tsx` | добавить необязательные `cellId`, `toText`, `parse` — чтобы формат ячейки описывался **в одном месте**; логика одиночного ввода не меняется |
| `styles/components.css` | `.cell-selected`, `.cell-anchor`, `.cell-invalid` (+ индикатор «идёт вставка»), рядом с `input.cell-*` |
| `api/types.ts` | `BulkField`, `BulkChange`, `BulkItemResult`, `BulkReply` |
| `api/endpoints.ts` | `applyBulkChanges(changes): Promise<BulkReply>` через `postOperation` (409 — нормальный исход) |
| `app/useAction.ts` | `runBatch` с построчным результатом и **без** глобального `busy` |
| `pages/DeficitPage.tsx` | сбор `changes` из диапазона → один bulk-запрос → один `reload()` |
| `pages/bomCardColumns.tsx`, `pages/BomCardPanel.tsx` | то же для 9 полей спецификации |
| `pages/WarehousePage.tsx` | то же для «Остатка» (ключ — `materialKey`, а не `positionId` — это надо учесть в контракте) |

### Сервер (`bom-web/server/src/`)

| Файл | Изменение |
| --- | --- |
| `domain/bulkFields.ts` | **новый**: `BulkField`, `isBulkField`, `bulkPermission`, `normalizeBulkValue` — чистые правила |
| `services/bulkService.ts` | **новый**: `applyBulkChanges` — дедупликация, лимит, одна транзакция, один `recordChanges`, агрегаты |
| `http/routes/positionRoutes.ts` | `POST /api/positions/bulk` |
| `http/operationReply.ts` | `sendBulkReply` (отдельно от `sendOperation`) |
| `repositories/positions.ts` | `listPositionsByPositionIds` (`= any($1::text[])`) |
| `domain/constants.ts` | `LIMITS.MAX_BULK_CHANGES` |
| `test/bulkFields.test.ts`, `test/bulk.test.ts` | **новые** тесты |

---

## 6. Инварианты, которые нельзя нарушить

1. **Сервер — источник истины.** После ответа поле показывает значение из базы (существующий `useEffect`
   в `Editable*`). Массовая вставка не должна оставлять «оптимистичные» значения в UI.
2. **Одна команда — один `operation_id`.** Вся паста получает один идентификатор: по журналу должно быть
   видно, что строки изменены вместе (это уже принцип `recordChanges`).
3. **`already` не пишется в журнал.** Повторная вставка того же блока не должна раздувать журнал.
4. **Права проверяются на сервере по каждому полю.** Скрытая или нередактируемая ячейка права не даёт.
5. **Ключ материала не пересчитывается** при правке описания (`describeKeyNote` → `notice`).
6. **Позиция в `REMOVED` не редактируется** (`loadPosition` → `blocked`).
7. **Даты календарные, без часовых поясов** (`isoFromDate` собирает дату в локальном времени).
   Вставка «как из Excel» (в том числе серийными числами) должна идти через серверный `toDate`.
8. **Пустая ячейка буфера**: для количеств — `0`; для `expectedDate` — «снять дату»; для `deadline` —
   отказ (правило уже есть в `normalizeSpecField`).
9. **Лимит размера** (`MAX_BULK_CHANGES`) обязателен: `PGlite` однопоточная, транзакция держит блокировку.

---

## 7. Крайние случаи, которые надо решить заранее

- **Вставка по видимым строкам.** Фильтр проекта и поиск (`matchesSearch`) отсекают строки; вставка
  работает по видимым. Нужно сообщать: «Изменено 12 строк из 40 ячеек — часть строк скрыта фильтром».
- **Сортировка.** Пользователь отсортировал таблицу по «Крайний срок» и вставляет блок: смысл вставки
  зависит от порядка. После `reload()` порядок может измениться — предупредить, а лучше сохранить
  текущую сортировку (она локальная, `DataTable` её не сбрасывает).
- **Дубли `positionId`** в одном запросе (одна строка в нескольких вставках) — дедупликация,
  «последнее побеждает».
- **Несколько позиций одного материала в `realDeliveryQty`** — суммарная дельта склада.
- **Массовая правка полей, входящих в ключ материала** (`Наименование`, `Модель`, `Артикул`,
  `Производитель`, `Ед.изм`): сервер вернёт `notice` на каждую строку. 300 одинаковых предупреждений —
  плохой UX; нужно показать одно сводное.
- **Серийные даты Excel** (`45123`) уже понимаются сервером (`toDate`) — это плюс, но тест нужен.
- **Ограничение размера тела запроса** в `http/server.ts` — `bodyLimit: 16 МБ`. 20 000 позиций × 5 полей
  формально влезут, но лимит `MAX_BULK_CHANGES` всё равно нужен (транзакция, журнал).

---

## 8. Порядок внедрения

| Этап | Содержание | Файлы | Оценка |
| --- | --- | --- | --- |
| 1 | Выделение диапазона мышью и стрелками, `Ctrl+C`, подсветка. **API не меняется** — проверяется без риска для данных | `gridSelection.ts`, `DataTable.tsx`, `components.css` | 1–2 дня |
| 2 | `Ctrl+V` по одной ячейке (раскладка блока по существующим одиночным эндпоинтам), один `reload()` на пасту | `clipboardGrid.ts`, страницы | 1 день |
| 3 | `POST /api/positions/bulk` + чистые правила + одна транзакция + один `operationId` + тесты | `bulkFields.ts`, `bulkService.ts`, `positionRoutes.ts`, `positions.ts`, `test/bulk*.ts` | 2–3 дня |
| 4 | `Ctrl+D` / `Ctrl+R`, массовые чекбоксы, подтверждение крупных вставок, локальная занятость, merge вместо полного reload | страницы, `DataTable.tsx`, `useAction.ts` | 1–2 дня |
| 5 | Откат операции по `operation_id` (данные уже есть: `listAuditByOperation` + `old_value`) | `auditLog.ts`, новый экран/панель | отдельная задача |

Этап 1 ценен сам по себе: он даёт выделение и копирование (в Excel и из Excel), ничего не меняя в API.

---

## 9. Тесты

- `server/test/bulkFields.test.ts` — чистые правила: соответствие «поле → право», нормализация значений
  (числа с разделителями тысяч, серийные даты Excel, чекбоксы в виде «да»/«1»/«истина»), лимит.
- `server/test/bulk.test.ts` — на **реальном** приложении (как остальные тесты: `buildServer` + PGlite):
  - 40 изменений → все записи `audit_log` с **одним** `operation_id`;
  - `already` не пишет в журнал;
  - `blocked` (позиция `REMOVED`, нет права на поле, пустой `deadline`) **не отменяет** остальные;
  - `realDeliveryQty` меняет склад на суммарную дельту по материалу;
  - превышение `MAX_BULK_CHANGES` → `ValidationError`;
  - массовая правка `spec.model` возвращает `notice` и **не** меняет `material_key`.
- `_local_tests/` — сценарная проверка UI-вставки: в проекте уже есть практика таких тестов
  (`_local_tests/v12_*_test.js`).

---

## 10. Вопросы к заказчику (без ответов на них реализацию начинать нельзя)

1. **Частичный успех или «всё или ничего»?** Рекомендация — частичный, как при передаче производству.
2. **Нужна ли очистка диапазона** (`Delete`)? Это массовое удаление данных снабженца; по умолчанию
   предлагается не делать.
3. **Порог подтверждения** — сколько ячеек считать «крупной вставкой» (предлагается 25).
4. **Нужен ли откат операции** из журнала.
5. **Режим фокуса.** Готовы ли пользователи к тому, что клик по ячейке выделяет её, а для правки нужен
   `Enter` / двойной щелчок (как в Excel)? Альтернатива — оставить нынешнее «клик = правка» и добавить
   выделение только `Shift`-ом.
6. **Вставка в карточке спецификации.** Массовая правка описательных полей не пересчитывает ключ
   материала (`describeKeyNote`) — нужно ли об этом предупреждать один раз на всю пасту?

---

## Module Reference (только то, что участвует в правке данных)

| Файл | Назначение |
| --- | --- |
| `web/src/ui/DataTable.tsx` | Общая таблица: колонки, клиентская сортировка, липкие первые колонки, раскраска строк. Сюда добавляется выделение диапазона |
| `web/src/ui/EditableNumber.tsx` | Числовое поле в строке: проверка «неотрицательное число», пусто → 0 |
| `web/src/ui/EditableDate.tsx` | Поле даты: `ДД.ММ.ГГГГ`, разбор, пустая дата = «не задана» |
| `web/src/ui/EditableText.tsx` | Текстовое поле строки (поля спецификации) с `allowEmpty`/`placeholder` |
| `web/src/ui/EditableCheckbox.tsx` | Галочка с немедленным применением и откатом при отказе сервера |
| `web/src/ui/Cells.tsx` | Недоступные правке ячейки материала и спецификации (одна строка + подсказка) |
| `web/src/ui/ConfirmDialog.tsx` | Готовый диалог подтверждения — для «крупной вставки» |
| `web/src/app/useAction.ts` | `{ busy, run }`: показ ошибок и состояние запроса. Источник глобальной блокировки полей |
| `web/src/app/useLoader.ts` | `{ data, loading, error, reload }` — полная перезагрузка витрины по ключу |
| `web/src/api/client.ts` | HTTP-клиент: cookie-сессия, `postOperation` (409 — нормальный исход), `encodeId` |
| `web/src/api/endpoints.ts` | Все обращения к серверу: `setOrderedQty`, `setExpectedDate`, `setRealDelivery*`, `setDeadline`, `setSpecField`, `setWarehouseQty`, `handoff` |
| `web/src/api/types.ts` | Контракт данных: `OperationReply`, `PositionDto`, строки витрин |
| `web/src/format.ts` | `formatQty`, `formatDate`, `parseDateInput` — форматы значений и дат |
| `pages/DeficitPage.tsx`, `pages/bomCardColumns.tsx`, `pages/BomCardPanel.tsx`, `pages/WarehousePage.tsx` | Экраны с правкой в строке — точки внедрения массового ввода |
| `pages/PickingPage.tsx` | **Прецедент**: выбор строк `Set<string>`, «Отметить готовые», передача списком |
| `server/src/services/positionService.ts` | Операции по позиции: права → `loadPosition` → `already` → транзакция → `recordChanges` |
| `server/src/services/handoffService.ts` | **Образец массовой операции**: список позиций, одна транзакция, результат по каждой строке, один `operationId` |
| `server/src/services/operationLog.ts` | `OperationContext`, `recordChanges` — журнал + история одним INSERT, один `operationId` на команду |
| `server/src/domain/specFields.ts` | 9 правимых полей спецификации, проверка значений, `notice` про ключ материала |
| `server/src/domain/values.ts` | `toNumber` / `toQty` / `isChecked` / `toDate` / `toIsoDate` — устойчивый разбор «грязных» значений и серийных дат Excel |
| `server/src/repositories/positions.ts` | `updateOperatingFields` (динамический SET, `version + 1`), `updatePositionSpec`, `= any($1::text[])` |
| `server/src/http/operationReply.ts` | `sendOperation`: единый формат ответа, `blocked` → 409 |
| `server/src/http/routes/positionRoutes.ts` | Маршруты операций по позиции — сюда добавляется `/bulk` |

## Suggested Reading Order

1. `bom-web/README.md` — что это за система, кто роли, что где лежит (общая карта за 10 минут).
2. `bom-web/server/src/services/handoffService.ts` — **главный файл для этой задачи**: здесь уже
   реализована массовая операция с частичным успехом и одним `operationId`. Предлагаемый bulk-сервис —
   его близнец.
3. `bom-web/server/src/services/positionService.ts` — шаблон одиночной правки (права → `already` →
   транзакция → `recordChanges`); из него берутся правила для каждого поля.
4. `bom-web/web/src/ui/DataTable.tsx` — где живёт таблица, сортировка и липкие колонки; сюда добавляется
   выделение диапазона и **отсюда же выносится `useTableSort`**.
5. `bom-web/web/src/ui/EditableNumber.tsx` + `EditableDate.tsx` — контракт `onSave(next) => Promise<boolean>`
   и приём «сервер — источник истины»; на него опирается вся массовая вставка.
6. `bom-web/web/src/pages/DeficitPage.tsx` — как страница собирает колонки, права и сохранение; здесь
   массовый ввод заработает первым.

---

## Ограничения этого отчёта

- `search_files` в этой сессии недоступен (в окружении нет `ripgrep`), поэтому поиск вёлся чтением
  файлов, а не регулярками. Полнота охвата подтверждена чтением всех файлов слоя правки.
- `server/src/repositories/materials.ts` (`adjustWarehouseQty`) не читался: при реализации массовой
  правки «Поставлено» нужно **проверить**, что функция суммирует дельты по материалу, а не перезаписывает
  остаток — иначе несколько позиций одного материала в одной вставке дадут неверный склад.
- Механизм **не реализовывался**: это проектный документ. Реализация — задача режима Act.
