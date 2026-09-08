# BOM CONTROL SYSTEM V11.2 — Сравнение текущей архитектуры с ТЗ и план доработок

Полный отчёт сохранён в **`project_info__3.md`** в корне проекта. Ниже — ключевые выводы.

---

## 0. Резюме

Текущая система — Google Apps Script (V8) для учёта BOM: импорт из Drive, расчёт дефицитов/статусов, сводка дефицитов, BOM_STATE, дашборд, архив. Она **уже реализует ~60–70%** требований ТЗ. Но есть **фундаментальные расхождения**, а не просто отсутствующие «мелочи»:

1. **Формула дефицита неверна по ТЗ.** Сейчас `дефицит = required − reserved − ordered`. По ТЗ `дефицит = required − reserved` (заказанное не вычитается; оно участвует в сравнении статуса отдельно).
2. **Сравнение заказа с `required`, а не с `deficit`.** ТЗ требует: «заказанный материал ≥ дефициту → проверяем дату». Код сравнивает `ordered` с `required`.
3. **Нет системы ролей** (экономист / снабженец / кладовщик / менеджер). Сейчас любой пользователь с доступом к листу может править что угодно (кроме MATERIAL_STATE).
4. **Нет валидации BOM-позиций с серой подсветкой** (порядковый номер, код, ед.изм, требуемое кол-во, крайний срок — обязательны).
5. **Дашборд не соответствует ТЗ:** нет чекбокса «Выполнено», нет hover-подсказки «недостающие позиции», нет статуса «Не обработан», нет исключения BOM из сканирования.
6. **BOM-файлы не подкрашиваются** по статусам (экспорт пишет только значения, не цвета).
7. **Терминология статусов не совпадает** с ТЗ («Заказано (в срок)» вместо «Ожидаем (в срок)» и т.д.).

**Рекомендация: не переписывать с нуля**, а провести **целевой рефакторинг ядра** — сохранив проверенную архитектуру листов и engine-модулей.

---

## 1. Что уже есть (хорошо)

- 9 листов: `MATERIAL_STATE`, `Сводка дефицитов`, `Dashboard`, `BOM_STATE`, `MATERIAL_HISTORY`, `EVENT_LOG`, `Архив`, `BOM_REVISION`, `SYSTEM_LOG`.
- Импорт BOM из Drive (Google Spreadsheet + CSV) с парсингом и сравнением изменений.
- Расчёт дефицита/статуса, сводка, агрегация BOM, дашборд, архив, логирование (EVENT_LOG + MATERIAL_HISTORY + SYSTEM_LOG), экспорт в BOM-файлы.
- `config.js` — единый источник правды (листы, колонки, статусы, цвета, события).
- `sheet_service.js` — обёртки над SpreadsheetApp, `batchWrite` уже оптимизирован (пишет диапазонами по строкам).
- `lock.js` — реентрантный ScriptLock.
- `trigger_engine.js` — onEdit + плановый триггер.

---

## 2. Главные несоответствия ТЗ (детально)

### 2.1. Формула дефицита
**ТЗ:** «дефицит = потребность − зарезервированный материал» → `deficit = required − reserved`.

**Сейчас:** `const deficit = Math.max(required - reserved - ordered, 0);` — **вычитает ещё и заказ**.

Последствие при `required=10, reserved=3, ordered=10`:
- По ТЗ: `deficit = 7` (заказ покрывает дефицит — всё ок).
- Сейчас: `deficit = max(10-3-10, 0) = 0`.

### 2.2. Логика статуса материала
**ТЗ:**
```
IF  ordered == 0            → «Не заказано» + красный
ELSE IF ordered < deficit   → «Частично» (заказано меньше дефицита)
ELSE IF no expected_date    → «Не указана дата поставки» + красный
ELSE IF expected <= deadline→ «Ожидаем (в срок)» + жёлтый
ELSE IF expected > deadline → «Ожидаем (опаздывает)» + оранжевый
IF  real_delivery checkbox  → «На складе» + голубой + фиксировать дату/время
IF  received checkbox       → «Получено производством» → убрать из сводки + архив
```

**Сейчас:** `ordered < required` — сравнение с номиналом, а не с **дефицитом**. Это ключевое расхождение.

### 2.3. Валидация BOM-позиций (серый цвет)
**ТЗ:** обязательны — порядковый номер в BOM, код материала, ед.изм, требуемое кол-во, крайний срок. Незаполненные → **серый цвет** + «ошибочная».

**Сейчас:** `validateBOMMaterial()` требует только `bom`, `row`, `name`. Нет проверки `code`, `unit`, `required > 0`, `deadline`. Нет серого цвета.

### 2.4. Сводка дефицитов
**ТЗ:** должны тянуться наименования, код материала, **порядковый номер**, **единица измерения**, крайний срок.

**Сейчас:** в `DEFICIT_COLUMNS` (12 колонок) **отсутствуют** `UNIT` и `ROW` (порядковый номер). Остальные данные есть.

### 2.5. Статусы дашборда
**ТЗ:** «Не обработан» / «Частично отобран» / «Ожидание поставки (в срок)» / «Ожидание поставки (опаздывает)» / «Готов к производству».

**Сейчас:** «🔴 Есть незаказанные материалы» / «🟠 Частично заказан» / «🟠 Просрочка поставки» / «🟡 Ожидается поставка» / «🟢 Готов к производству».

Несоответствия:
- Нет «Не обработан» (при всех не заказанных — сейчас просто RED).
- «Частично» считается по `ordered < required`, а не по `ordered < deficit`.
- «Просрочка» считается только при полном заказе (`ordered >= required`), а не при «все позиции заказаны, но хотя бы одна позже срока».
- Нет учёта ошибочных позиций.

### 2.6. Дашборд: чекбокс «Выполнено» и hover-подсказка
**ТЗ:**
- Левый крайний столбец — чекбокс «Выполнено».
- Активен **только** после «Готов к производству».
- При нажатии — BOM убирается из дашборда, файл исключается из сканирования, файл не изменяется.
- При наведении на статус — окно с недостающими позициями и их количеством.
- Вручную можно только отмечать чекбоксы.

**Сейчас:** чекбокса нет; hover-подсказки нет; BOM-файлы сканируются всегда; любые правки дашборда возможны.

### 2.7. Роли
**ТЗ:** экономист (заполняет BOM), снабженец (заказ/дата/чекбокс реальной поставки — только эти), менеджер (дата/количество/чекбокс), кладовщик («Получено»). Корректировать статусы вручную нельзя.

**Сейчас:** нет ролей; `v11OnEdit` проверяет только лист/колонку.

### 2.8. BOM-файлы
**ТЗ:** изменения статусов передаются в BOM-файлы; **позиции подкрашиваются** согласно статусам; корректировка вручную запрещена.

**Сейчас:** `exportBOMFile()` пишет значения (reserved/ordered/status/...), но **не красит**.

### 2.9. Логирование
Через `EVENT_LOG` / `MATERIAL_HISTORY` / `SYSTEM_LOG` с `getCurrentUser()` — есть. Но:
- Нет единого события при выключении чекбокса реальной поставки (Разная семантика `addSystemEvent` vs `createEvent`).
- Нет записи «кто → какое поле → с какого на какое» в едином формате для `saveDeficitChanges()`.
- Прямой вызов `confirmRealDelivery()` не пишет «Реальная поставка подтверждена» в EVENT_LOG.

---

## 3. Рекомендация: доработать, а не переписывать

Каркас правильный. Нужно **точечно** изменить логику в этих функциях:

| Файл / функция | Что делаем |
|----------------|-----------|
| `status_engine.js` → `computeMaterialStatus()` | Новая формула `required−reserved`, сравнение с `deficit`, статус ERROR (серый) |
| `bom_state_engine.js` → `recalculateBOMState()` | Новые статусы + список `missingItems` |
| `deficit_engine.js` → `updateDeficitSummary()` | Добавить UNIT/ROW, серый цвет |
| `dashboard_engine.js` → `updateDashboard()` | Чекбокс DONE, hover-подсказки, «Не обработан» |
| `export_engine.js` → `exportBOMFile()` | Раскраска позиций по статусам |
| `config.js` | Новые статусы, цвета, колонки, лист EXCLUDED_BOMS |

**Добавить новые файлы:**
- `roles.js` / `access_control.js` — маппинг email → роль, `getUserRole()`, `canEditField()`.
- `validation_engine.js` — проверка обязательных полей BOM-позиций.
- `exclusion_registry.js` — реестр исключённых BOM (`isBOMDone()`, `setBOMDone()`).

---

## 4. Ключевые изменения в `config.js`

```js
COLORS.GRAY = "#D9D9D9"                       // ошибка/неполные данные

MATERIAL_STATUS:
  ERROR: "Ошибка данных"
  ORDERED_ON_TIME: "Ожидаем (в срок)"        // переименован
  ORDERED_LATE: "Ожидаем (опаздывает)"       // переименован
  DATE_UNKNOWN: "Не указана дата поставки"   // переименован

BOM_STATUS:
  NOT_PROCESSED: "Не обработан"
  PARTIAL_SELECTED: "Частично отобран"
  WAITING_ON_TIME: "Ожидание поставки (в срок)"
  WAITING_LATE: "Ожидание поставки (опаздывает)"
  READY: "Готов к производству"

DEFICIT_COLUMNS: + UNIT, + ROW
DASHBOARD_COLUMNS: + DONE, + MISSING_ITEMS
SHEETS: + EXCLUDED_BOMS
```

---

## 5. Пример новой логики `computeMaterialStatus()`

```js
function computeMaterialStatus(row) {
  const C = V11_CONFIG.MATERIAL_COLUMNS;
  const required = toNumber(row[C.REQUIRED - 1]);
  const reserved = toNumber(row[C.RESERVED - 1]);
  const ordered = toNumber(row[C.ORDERED - 1]);
  const received = row[C.RECEIVED - 1] === true;
  const stock = row[C.REAL_DELIVERY - 1] === true;
  const expected = row[C.EXPECTED_DATE - 1];
  const deadline = row[C.DEADLINE_DATE - 1];

  // Валидация обязательных полей (серый цвет)
  const hasError =
    !row[C.BOM_ROW - 1] ||
    !String(row[C.MATERIAL_CODE - 1] || "").trim() ||
    !String(row[C.UNIT - 1] || "").trim() ||
    required <= 0 ||
    !deadline;

  // ДЕФИЦИТ ПО ТЗ: required − reserved (НЕ вычитаем ordered!)
  const deficit = Math.max(required - reserved, 0);

  if (oldStatus === MS.ARCHIVED) { ... }
  else if (oldStatus === MS.REMOVED) { ... }
  else if (hasError)          { status = MS.ERROR; state = MST.ERROR; }
  else if (received)          { status = MS.RECEIVED; state = MST.RECEIVED; }
  else if (stock)             { status = MS.STOCK; state = MST.STOCK; }
  else if (ordered <= 0)      { status = MS.NOT_ORDERED; state = MST.DEFICIT; }
  else if (!expected)         { status = MS.DATE_UNKNOWN; state = MST.WAITING; }
  else if (ordered < deficit) { status = MS.PARTIAL_ORDER; state = MST.PARTIAL_ORDER; }
  else {
    const late = expected && deadline && new Date(expected) > new Date(deadline);
    status = late ? MS.ORDERED_LATE : MS.ORDERED_ON_TIME;
    state = late ? MST.WAITING_LATE : MST.WAITING;
  }
  return { status, state, deficit, ... };
}
```

---

## 6. Риски

1. **Миграция колонок DEFICIT_SUMMARY** (добавление UNIT/ROW) сломает `saveDeficitChanges()`, `createDeliveryCheckboxes()`, `colorDeficitSummaryRows()`, `v11OnEdit` — обновлять всё одновременно.
2. **Переименование статусов** сломает `getStatusColor()` (switch по строкам) и условное форматирование дашборда.
3. **Смена формулы дефицита** требует пересчёта через `recalculateMaterials()` после `saveDeficitChanges()`.
4. **Роли** — если email неизвестен, надо решить: блокировать или разрешить (рекомендую блокировать + логировать).
5. **«Выполнено»** — не удалять файл, только фильтровать в `getAllBOMFiles()`.
6. **Hover-подсказка** — `Range.setNote()`; перезаписывать ноты при пересоздании дашборда.
7. **Производительность** — батчить раскраску BOM-файлов (использовать `setBackgrounds` массивами).

---

## 7. Suggested Reading Order для доработки

1. `config.js` — колонки/статусы/цвета (база).
2. `status_engine.js` — `computeMaterialStatus()` (главная логика).
3. `deficit_engine.js` — `updateDeficitSummary()` + `saveDeficitChanges()`.
4. `bom_state_engine.js` — `recalculateBOMState()`.
5. `dashboard_engine.js` — `updateDashboard()`.
6. `trigger_engine.js` — `v11OnEdit()` (роли, запреты).
7. `export_engine.js` — `exportBOMFile()` (раскраска).
8. `material_actions.js` + `archive_engine.js` — действия снабженца/кладовщика.

---

**Важно:** Я сейчас в **Explore Mode** — только анализирую и документирую, изменения не вношу. Чтобы я реализовал эти доработки, переключитесь в **Act Mode** (переключатель Plan/Act внизу чата). Найденные расхождения и детальный план сохранены в **`project_info__3.md`** и в контексте — они будут перенесены в Act Mode.