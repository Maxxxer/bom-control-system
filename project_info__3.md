# BOM CONTROL SYSTEM V11.2 — Сравнение текущей архитектуры с ТЗ и план доработок

## 0. Резюме (Abstract)

Текущая система — Google Apps Script (V8) для учёта BOM: импорт из Drive, расчёт дефицитов/статусов, сводка дефицитов, BOM_STATE, дашборд, архив. Она **уже реализует ~60–70%** требований ТЗ (наличие листов, дефицита, статусов, сводки, дашборда, архива, логирования, импорта/экспорта).

Однако между текущей реализацией и ТЗ есть **фундаментальные расхождения**, а не просто отсутствующие «мелочи»:

1. **Формула дефицита неверна по ТЗ.** Сейчас `дефицит = required − reserved − ordered`. По ТЗ `дефицит = required − reserved` (заказанное не вычитается; оно участвует в сравнении статуса отдельно).
2. **Сравнение заказа с `required`, а не с `deficit`.** ТЗ требует: «заказанный материал ≥ дефициту → проверяем дату». Код сравнивает `ordered` с `required`.
3. **Нет системы ролей** (экономист / снабженец / кладовщик / менеджер). Сейчас любой пользователь с доступом к листу может править что угодно (кроме MATERIAL_STATE).
4. **Нет валидации BOM-позиций с серой подсветкой** (порядковый номер, код, ед.изм, требуемое кол-во, крайний срок — обязательны).
5. **Дашборд не соответствует ТЗ:** нет чекбокса «Выполнено», нет hover-подсказки «недостающие позиции», нет статуса «Не обработан», нет исключения BOM из сканирования.
6. **BOM-файлы не подкрашиваются** по статусам (экспорт пишет только значения, не цвета).
7. **Терминология статусов не совпадает** с ТЗ («Заказано (в срок)» вместо «Ожидаем (в срок)» и т.д.).

Рекомендация: **не переписывать с нуля**, а провести **целевой рефакторинг ядра (логика статусов + роли + дашборд + валидация)**, сохранив проверенную архитектуру листов и engine-модулей. Ниже — детальный gap-анализ и пошаговый план.

---

## 1. Что представляет собой система сейчас

### 1.1. Тип проекта
- **Google Apps Script (V8)** для Google Sheets.
- **Нет UI-фронтенда** — всё происходит в таблице Google (меню, листы, чекбоксы, условное форматирование).
- Хранилище — **9 листов** в одной рабочей книге: `MATERIAL_STATE`, `Сводка дефицитов`, `Dashboard`, `BOM_STATE`, `MATERIAL_HISTORY`, `EVENT_LOG`, `Архив`, `BOM_REVISION`, `SYSTEM_LOG`.
- Данные циркулируют между «памятью» (индексы-`Map`) и листами через обёртки `sheet_service.js`.

### 1.2. Основные потоки данных

**Импорт BOM:**
```
Drive (папка V11_CONFIG.DRIVE.FOLDER_ID) → getAllBOMFiles() → parseBOMFile()
→ importBOM() → createBOMVersion() + addMaterialFromBOM() (по каждой строке)
→ validateBOMMaterial() → refreshAfterChange()
```

**Полное обновление (`runFullUpdate`):**
```
saveDeficitChanges() → recalculateMaterials() → archiveReceivedMaterials()
→ updateDeficitSummary() → recalculateBOMState() → applyStatusColors()
→ updateDashboard() → syncV11()
```

**Пересчёт статусов (`status_engine`):**
```
recalculateMaterials() → 1 чтение MATERIAL_STATE → computeMaterialStatus(row)
→ батч-запись DEFICIT / STATUS / STATE / UPDATED → (если статус/состояние изменились)
  → appendEventRows() + appendHistoryRows()
```

### 1.3. Ключевые листы и их схемы (текущие)

| Лист | Колонок | Назначение |
|------|---------|-----------|
| `MATERIAL_STATE` | 21 | Центральная таблица материалов: MaterialID, BOM, BOM_VERSION, BOM_ROW, CODE, NAME, UNIT, REQUIRED, RESERVED, ORDERED, DEFICIT, EXPECTED_DATE, DEADLINE_DATE, REAL_DELIVERY, REAL_DELIVERY_DATE, RECEIVED, RECEIVED_DATE, RECEIVED_USER, STATUS, STATE, UPDATED |
| `Сводка дефицитов` | 12 | RECEIVED, MaterialID, BOM, CODE, NAME, REQUIRED, ORDERED, DEFICIT, EXPECTED_DATE, DEADLINE_DATE, REAL_DELIVERY, STATUS |
| `BOM_STATE` | 11 | BOM, VERSION, DATE_CREATED, TOTAL_MATERIALS, DEFICIT, NOT_ORDERED, LAST_DELIVERY, DEADLINE, STATUS, READY, UPDATED |
| `Dashboard` | 9 | BOM, STATUS, DATE_CREATED, TOTAL_MATERIALS, DEFICIT, NOT_ORDERED, LAST_DELIVERY, DEADLINE, READY |
| `Архив` | 11 | Дата, BOM, Версия, Код, Наименование, Кол-во, Дата поставки, Дата получения, Кто отметил, Состояние, История |
| `MATERIAL_HISTORY` | 7 | Дата, MaterialID, Событие, Старое, Новое, Пользователь, Комментарий |
| `EVENT_LOG` | 7 | Дата, Event ID, Тип, MaterialID, BOM, Пользователь, Данные |
| `SYSTEM_LOG` | 5 | Дата, Функция, Сообщение, Уровень, Данные |
| `BOM_REVISION` | 4 | Дата, BOM, Версия, Создал |

---

## 2. Разбор ключевых абстракций (текущее состояние)

### 2.1. `computeMaterialStatus(row)` — **критично для ТЗ**
- **Файл:** `status_engine.js`
- **Текущая логика (соответствие ТЗ):**

```js
const deficit = Math.max(required - reserved - ordered, 0);  // ← НЕВЕРНО по ТЗ

if (required <= 0)                  → NO_REQUIREMENT
else if (received)                  → RECEIVED
else if (stock)                     → STOCK
else if (ordered <= 0)              → NOT_ORDERED
else if (!expected)                 → DATE_UNKNOWN
else if (ordered < required)        → PARTIAL_ORDER    // ← сравнение с required, а не deficit
else                                → ORDERED_ON_TIME / ORDERED_LATE
```

- **Что не так:**
  1. `deficit` учитывает `ordered`. По ТЗ дефицит — это только `required − reserved`.
  2. `ordered < required` — сравнение с номиналом «Требуется», а ТЗ требует сравнение с **дефицитом**.
  3. Статус «Заказано частично» появляется при `ordered < required`, но по ТЗ «частично» следует определять по `ordered < deficit` (заказано меньше дефицита).
  4. Статусные названия не соответствуют ТЗ («Заказано (в срок)» vs «Ожидаем (в срок)»).

### 2.2. `saveDeficitChanges()` — перенос ручных правок снабженца
- **Файл:** `deficit_engine.js`
- Переносит из сводки в MATERIAL_STATE: `ORDERED`, `EXPECTED_DATE`, `DEADLINE_DATE`.
- **Проблема:** вызывается для любого пользователя (нет роли); не проверяет, какое поле изменил снабженец (разрешено менять только эти три + чекбокс реальной поставки). Также не даёт возможности снабженцу редактировать **только** заказ/дату/чекбокс — доступны и другие колонки.

### 2.3. `recalculateBOMState()` — агрегация по BOM
- **Файл:** `bom_state_engine.js`
- Собирает по каждому BOM: total, received, stock, notOrdered, partial, late, waiting, maxExpected, maxDeadline.
- Статусы BOM:
  - `GREEN (🟢 Готов к производству)` — `received === total`
  - `RED (🔴 Есть незаказанные материалы)` — `notOrdered > 0`
  - `PARTIAL (🟠 Частично заказан)` — `partial > 0`
  - `ORANGE (🟠 Просрочка поставки)` — `late > 0`
  - `YELLOW (🟡 Ожидается поставка)` — `waiting > 0`
- **Проблемы по ТЗ:**
  - Нет статуса **«Не обработан»** (все позиции не заказаны) — сейчас это просто RED.
  - «Частично» считается по `ordered < required`, а не по `ordered < deficit`.
  - Статус «Ожидается поставка» не различает «в срок/с опозданием» при **частично** заказанном BOM (сейчас «late» считается только если `ordered >= required`).
  - Нет учёта **ошибочных позиций** (серый) в агрегате.
- **Важно:** агрегированные поля `DEFICIT = notOrdered + partial` и `NOT_ORDERED = notOrdered` не соответствуют ТЗ-полю «общее количество позиций» на дашборде (для подсказки «недостающие позиции»).

### 2.4. `updateDashboard()` — дашборд
- **Файл:** `dashboard_engine.js`
- Копирует из BOM_STATE 9 колонок (без чекбокса, без tooltip).
- `applyDashboardColors()` — условное форматирование по BOM_STATUS.
- `setupDashboardFilter()` — пересоздаёт фильтр.
- **Проблемы по ТЗ:**
  1. **Нет чекбокса «Выполнено»** в левом столбце.
  2. **Нет кликабельной hover-подсказки** «недостающие позиции и их количество».
  3. Нет фильтрации «выполненных» BOM (исключение из отображения).
  4. Нет защиты: «вручную можно только отмечать чекбоксы» — фильтр/сортировка пользователь может менять.
  5. Даты «ожидаемого срока поставки последней позиции» и «крайнего срока» есть (`LAST_DELIVERY`, `DEADLINE`), но «дата создания BOM» берётся из `UPDATED` (последнее обновление), а не из `DATE_CREATED`.

### 2.5. `exportBOMFile()` — запись изменений в BOM-файлы
- **Файл:** `export_engine.js`
- Пишет в BOM-файлы (Google Spreadsheet) колонки: reserved, ordered, deadline, expected, realDelivery, status.
- **Проблемы по ТЗ:**
  1. **НЕ подкрашивает позиции** в BOM-файлах (только `setValue`).
  2. Нет записи «серого» цвета для ошибочных позиций.
  3. Нет обратной связи по статусу (запись только в колонку «Статус», цвет не передаётся).
  4. `flush()` вызывается один раз, но запись идёт по ячейкам `setValue` — медленно при большом количестве позиций.

### 2.6. `archiveReceivedMaterials()` / `confirmMaterialReceived()`
- **Файл:** `archive_engine.js`, `material_actions.js`
- `confirmMaterialReceived()` ставит `RECEIVED=true`, `RECEIVED_DATE=now`, `RECEIVED_USER=currentUser`.
- `archiveReceivedMaterials()` ищет RECEIVED-позиции и архивирует их.
- **Проблема по ТЗ:** подтверждение «Получено» должно делать **кладовщик**, сейчас — любой пользователь (нет проверки роли).

### 2.7. Роли и права
- **Нет файла ролей** (например `roles.js` / `access_control.js`).
- `v11OnEdit` проверяет **только лист и колонку**, не проверяет пользователя.
- `protectMaterialStateSheet()` защищает лист, но не роли. Сводка/дашборд не защищены по ролям.

---

## 3. Data Flow (текущий) — «как данные движутся сейчас»

1. **Экономист заполняет BOM** → файл в Drive → `runBOMImport()` / `syncAllBOM()` → `parseBOMFile()` → `importBOM()` → `addMaterialFromBOM()` → `refreshAfterChange()`.
2. **`refreshAfterChange()`** → `saveDeficitChanges()` → `recalculateMaterials()` → `recalculateBOMState()` → `updateDeficitSummary()` → `updateDashboard()` → `applyStatusColors()`.
3. **Снабженец вносит заказ/дату** в «Сводке дефицитов» → `v11OnEdit` (DEFICIT_SUMMARY) → `processSummaryCheckbox()` / `eventDeliveryDateChanged()` / `eventDeadlineDateChanged()` / `eventMaterialOrdered()` → `refreshAfterChange()` → перенос в MATERIAL_STATE.
4. **Кладовщик отмечает «Получено»** → `processSummaryReceived()` → `confirmMaterialReceived()` → `archiveMaterial()` → материал уходит в «Архив».
5. **Менеджер** — сейчас отдельной роли нет; фактически любые правки сводки доступны всем.
6. **Экспорт в BOM-файлы** → `v11ScheduledUpdate()` (ежечасно) → `exportBOMMaterialsToDrive()` → запись значений в файлы.
---

## 4. Gap-анализ: ТЗ vs Текущая реализация

### 4.1. Сводка дефицитов — какие данные должна содержать

**Требование ТЗ:** в сводку должны попадать: наименования, код материала, **порядковый номер**, единица измерения, крайний срок.

| Поле | ТЗ | Текущее | Статус |
|------|----|---------|--------|
| Наименование | ✅ | `NAME` (кол. 5) | ✅ Есть |
| Код материала | ✅ | `CODE` (кол. 4) | ✅ Есть |
| **Порядковый номер** | ✅ обязательно | **отсутствует** | ❌ НЕТ |
| **Единица измерения** | ✅ обязательно | **отсутствует** | ❌ НЕТ |
| Требуемое количество | ✅ | `REQUIRED` (кол. 6) | ✅ Есть |
| Крайний срок | ✅ | `DEADLINE_DATE` (кол. 10) | ✅ Есть |
| Дефицит | ✅ | `DEFICIT` (кол. 8) | ⚠️ формула неверна |
| Заказано | ✅ | `ORDERED` (кол. 7) | ✅ Есть |
| Ожидаемая поставка | ✅ | `EXPECTED_DATE` (кол. 9) | ✅ Есть |
| Чекбокс «Реальная поставка» | ✅ | `REAL_DELIVERY` (кол. 11) | ✅ Есть |
| Чекбокс «Получено» | ✅ | `RECEIVED` (кол. 1) | ✅ Есть |
| Статус | ✅ | `STATUS` (кол. 12) | ⚠️ названия/логика не совпадают |

**Вывод:** сводка почти готова, но **не хватает колонок «Ед.изм» и «Строка» (порядковый номер BOM)**. Это надо добавить в `V11_CONFIG.DEFICIT_COLUMNS` и в `updateDeficitSummary()`.

---

### 4.2. Валидация BOM-позиций (серый цвет для ошибок)

**Требование ТЗ:** каждая позиция должна иметь порядковый номер в BOM, код материала, ед.изм, требуемое кол-во, крайний срок. Если что-то не заполнено → **серый цвет** + «ошибочная».

| Поле | Как сейчас | Что нужно |
|------|-----------|-----------|
| `BOM_ROW` (порядковый номер) | Не валидируется в `validateBOMMaterial` | Обязательный |
| `CODE` (код материала) | Не валидируется | Обязательный |
| `UNIT` (ед.изм) | Не валидируется | Обязательный |
| `REQUIRED` (кол-во) | Не валидируется (только требует `name`, `bom`, `row`) | Обязательный (должен быть > 0) |
| `DEADLINE_DATE` (крайний срок) | Не валидируется | Обязательный |
| Серый цвет | `getStatusColor()` не имеет серого | Добавить `COLORS.GRAY = "#D9D9D9"` и статус `ERROR` |
| Название статуса | — | «Ошибка данных» / «Не заполнены обязательные поля» |

`validateBOMMaterial()` сейчас требует только: `bom`, `row`, `name`. **Нужно расширить** до проверки `code`, `unit`, `required > 0`, `deadline`.

---

### 4.3. Формула дефицита и статус материала

**ТЗ (дословно):** «дефицит, это разность между потребность и количеством зарезервированного материала» → `deficit = required − reserved`.

Текущее:
```js
const deficit = Math.max(required - reserved - ordered, 0);
```

**Несоответствие:** при `required=10, reserved=3, ordered=10`:
- По ТЗ: `deficit = 7` (заказ покрывает дефицит, всё ок).
- Сейчас: `deficit = max(10-3-10, 0) = 0`.

**Логика статуса по ТЗ:**
```
IF  ordered == 0                 → «Не заказано» + красный
ELSE IF ordered < deficit        → «Частично отобран» (заказано меньше дефицита)
ELSE IF no expected_date         → «Не указана дата поставки» + красный
ELSE IF expected <= deadline     → «Ожидаем (в срок)» + жёлтый
ELSE IF expected > deadline      → «Ожидаем (опаздывает)» + оранжевый
IF  real_delivery checkbox       → «На складе» + голубой + фиксировать дату/время
IF  received checkbox            → «Получено производством» + убрать из сводки + архив
```

**Текущий статус сравнения** — с `required`, а не с `deficit`. Это ключевое расхождение.

---

### 4.4. Статусы дашборда по BOM

**ТЗ:**

| Статус | Условие |
|--------|---------|
| Не обработан | ни один элемент не заказан |
| Частично отобран | часть позиций без кол-ва заказа, или заказано < дефицита, или нет ожидаемых сроков |
| Ожидание поставки (в срок) | все позиции заказаны в достаточном кол-ве; все даты ≤ крайнего срока |
| Ожидание поставки (опаздывает) | все позиции заказаны; хотя бы одна дата > крайнего срока |
| Готов к производству | все позиции получены производством |

**Текущее:**

| Статус | Условие |
|--------|---------|
| 🔴 Есть незаказанные материалы | `notOrdered > 0` |
| 🟠 Частично заказан | `partial > 0` |
| 🟠 Просрочка поставки | `late > 0` (только при `ordered >= required`) |
| 🟡 Ожидается поставка | `waiting > 0` |
| 🟢 Готов к производству | `received === total` |

**Несоответствия:**
1. Нет «Не обработан» — сейчас при всех не заказанных `RED`.
2. «Частично заказан» вычисляется по `ordered < required`, а не по `ordered < deficit` + «нет ожидаемых сроков».
3. «Просрочка поставки» вычисляется только при полном заказе; если часть заказа есть и часть просрочена — статус будет «Частично заказан», хотя по ТЗ должен быть «Ожидание поставки (опаздывает)» при условии «все заказаны».
4. «Ожидается поставка» не различает «в срок/опаздывает» при наличии незаказанных позиций.
5. Нет учёта ошибок (серый) при частично заполненном BOM — дашборд не знает об «ошибочных» позициях.

---

### 4.5. Дашборд: чекбокс «Выполнено»

**ТЗ:**
- Левый крайний столбец — чекбокс «Выполнено».
- Опция активна **только** после статуса «Готов к производству».
- При нажатии — BOM убирается из дашборда; файл BOM исключается из дальнейшего сканирования; сам файл НЕ изменяется.
- Вручную в дашборде можно только отмечать чекбоксы.

**Текущее:** чекбокса нет вообще. `updateDashboard()` пересоздаёт данные и фильтр, но не хранит признак «выполнено». BOM-файлы сканируются всегда из `V11_CONFIG.DRIVE.FOLDER_ID`.

**Что нужно:**
- Добавить столбец `DONE` (чекбокс) в `DASHBOARD_COLUMNS`.
- Добавить лист/регистр исключённых BOM (например `EXCLUDED_BOMS` или в BOM_STATE поле `EXCLUDED=true`).
- В `getAllBOMFiles()` фильтровать исключённые BOM.
- В `v11OnEdit` для DASHBOARD — разрешить только чекбокс `DONE`, и только если статус BOM = «Готов к производству».

---

### 4.6. Data Validation / hover-подсказка «недостающие позиции»

**ТЗ:** при наведении на статус дашборда должно всплывать окно с указанием недостающих позиций и их количества.

**Текущее:** ничего нет — только условное форматирование `applyDashboardColors()`.

**Вариант реализации в Apps Script:**
- Нет нативного hover-тултипа, но можно:
  1. Использовать `Range.setNote()` — текст, показываемый при наведении на ячейку. Это самый близкий аналог.
  2. Записать в столбец «Недостающие позиции» текст (например «Не заказано: А, Б (по 10 шт)»), а `setNote()` для более длинного описания.
- Надо агрегировать из `recalculateBOMState()` список позиций с `ordered < deficit` или вовсе без заказа.

---

### 4.7. Роли и права пользователей

**ТЗ:**
- Экономист — заполняет BOM (первичная подготовка).
- Снабженец — вносит кол-во заказа, ожидаемую дату, чекбокс реальной поставки; **только эти** поля.
- Менеджер — может менять ожидаемую дату, количество, переключать чекбокс реальной поставки.
- Кладовщик — подтверждает получение («Получено»).
- Корректировать статусы вручную — нельзя.

**Текущее:** нет ролей; `v11OnEdit` проверяет только лист/колонку. Любой редактор листа может менять всё.

**Что нужно:**
- Создать `roles.js` / `access_control.js` с маппингом email → роль.
- Написать `getUserRole(email)`.
- В `v11OnEdit` для DEFICIT_SUMMARY:
  - Снабженец/менеджер: разрешить `ORDERED`, `EXPECTED_DATE`, `REAL_DELIVERY`.
  - Кладовщик: разрешить `RECEIVED`.
  - Запретить `DEADLINE_DATE` (только экономист), `MATERIAL_ID`, `CODE`, `NAME`, `REQUIRED`, `DEFICIT`.
- В `v11OnEdit` для DASHBOARD: разрешить только `DONE` (и только при «Готов к производству»).
- Защитить листы и выборочно колонки через `protect()` по ролям (если возможно).

---

### 4.8. BOM-файлы: подкраска позиций

**ТЗ:** изменения статусов передаются в BOM-файлы; позиции подкрашиваются согласно статусам; корректировать статусы вручную нельзя.

**Текущее:** `exportBOMFile()` пишет значения (reserved/ordered/status/...) но **не красит**.

**Что нужно:**
- В `exportBOMFile()` после записи статуса проставлять `setBackgrounds` по той же карте `getStatusColor()`.
- Добавить серый цвет для ошибочных позиций.
- Учесть производительность: писать `setBackgrounds` массивами (по диапазону), а не по ячейкам.
- Защитить BOM-файлы от ручного редактирования статусов (например, через защиту листа).

---

### 4.9. Логирование

**ТЗ:** все действия логируются: учётная запись, время, дата отметок.

**Текущее:** есть `EVENT_LOG`, `MATERIAL_HISTORY`, `SYSTEM_LOG` — с `getCurrentUser()`. Но:
- Нет единого события для «переключателя чекбокса выключено» при редактировании даты/количества (часть действий пишется через `addSystemEvent`, часть через `createEvent` — разная семантика).
- Нет записи «кто именно изменил поле и с какого на какое» в `saveDeficitChanges()` в едином формате (есть в `addMaterialHistory()`, но не в `EVENT_LOG`).
- Нет логирования **отметки времени** чекбокса «Реальная поставка» отдельным событием с точной датой/временем (в `confirmRealDelivery` кладётся `REAL_DELIVERY_DATE`, но не пишется событие «Реальная поставка подтверждена» в EVENT_LOG — вместо этого `createEvent(REAL_DELIVERY_CONFIRMED)` вызывается только через `processSummaryCheckbox`, а прямой вызов `confirmRealDelivery` не пишет EVENT_LOG).

---

### 4.10. Архитектурные / производительные проблемы (из project_info__1.md)

Уже задокументированные узкие места (в отчёте `project_info__1.md`) сохраняются и важны при переделке:
1. `syncV11()` — `Utilities.sleep(500)` × несколько = секунды простоя (в `runFullUpdate` теперь `syncV11()` без sleep, но в `refreshDeficitStatus()` остался `Utilities.sleep(500)`).
2. `batchWrite` уже оптимизирован (пишет диапазонами по строкам) — сохранить.
3. N+1 чтения в `saveDeficitChanges()` / `archiveReceivedMaterials()` — частично исправлены (есть `index`), но `saveDeficitChanges` использует `getMaterialById` с общим индексом — ок.
4. `updateDeficitSummary()` переписывает весь лист — при больших объёмах дорого; но это допустимо, если объёмы ~сотни строк.
5. `applyStatusColors()` читает листы целиком и красит весь лист — для 1000 позиций это приемлемо, но при добавлении серых/ошибочных строк может стать тяжелее.

---

## 5. Предложение: доработать или переписать?

### 5.1. Вердикт

**Рекомендуется доработка, а не полная перепись с нуля.** Основание:
- Архитектура (engine-модули + `sheet_service` + `config.js` как единый источник правды + `event_engine` + `trigger_engine`) уже **правильная** для этого класса задач и переиспользуема.
- Листы, импорт/экспорт, архив, история, логирование — всё уже есть и работает.
- Основные дефекты — **логические**: формула дефицита, сравнение с `required` вместо `deficit`, отсутствие ролей, отсутствие валидации с серым цветом, отсутствие чекбокса «Выполнено» и hover-подсказки.
- Эти дефекты **не требуют переписывания ядра**, а требуют **точечного изменения** `computeMaterialStatus`, `recalculateBOMState`, `updateDeficitSummary`, `updateDashboard`, `exportBOMFile` + добавления `roles.js` + расширения `config.js`.

### 5.2. Что переписать целиком (полностью)

Целесообразно заменить **логику** в этих функциях (полностью переписав их тела), но **не модули**:

| Файл / функция | Что делаем |
|----------------|-----------|
| `status_engine.js` → `computeMaterialStatus()` | Полностью новая логика статусов по ТЗ |
| `bom_state_engine.js` → `recalculateBOMState()` | Новая агрегация по ТЗ-статусам + список недостающих позиций |
| `deficit_engine.js` → `updateDeficitSummary()` | Добавить колонки «Ед.изм» и «Строка», серый цвет, новый статус |
| `dashboard_engine.js` → `updateDashboard()` | Добавить чекбокс «Выполнено», набор недостающих позиций, статус «Не обработан» |
| `export_engine.js` → `exportBOMFile()` | Добавить раскраску позиций по статусам |
| `config.js` | Новые статусы, цвета, колонки, роли, «исключённые» BOM |

### 5.3. Что добавить (новые файлы)

| Файл | Назначение |
|------|-----------|
| `roles.js` / `access_control.js` | Маппинг email → роль (экономист/снабженец/кладовщик/менеджер), функции `getUserRole()`, `canEditField()` |
| `validation_engine.js` | Проверка обязательных полей BOM-позиций, построение «ошибочных» записей |
| `exclusion_registry.js` | Реестр исключённых BOM (лист + функции `isBOMExcluded()`, `excludeBOM()`, `isBOMDone()`) — для чекбокса «Выполнено» |

### 5.4. Ожидаемые изменения в `config.js`

- `COLORS.GRAY = "#D9D9D9"` (ошибочные позиции).
- Новые статусы:
  - `MATERIAL_STATUS.ERROR = "Ошибка данных"` (серый).
  - `MATERIAL_STATUS.WAITING_ON_TIME = "Ожидаем (в срок)"` (вместо `ORDERED_ON_TIME`).
  - `MATERIAL_STATUS.WAITING_LATE = "Ожидаем (опаздывает)"` (вместо `ORDERED_LATE`).
  - `MATERIAL_STATUS.DATE_UNKNOWN = "Не указана дата поставки"` (вместо `Дата поставки неизвестна`).
- Новые BOM-статусы:
  - `BOM_STATUS.NOT_PROCESSED = "Не обработан"`.
  - `BOM_STATUS.PARTIAL_SELECTED = "Частично отобран"`.
  - `BOM_STATUS.WAITING_ON_TIME = "Ожидание поставки (в срок)"`.
  - `BOM_STATUS.WAITING_LATE = "Ожидание поставки (опаздывает)"`.
- Новые колонки `DEFICIT_SUMMARY`: `UNIT`, `ROW`.
- Новые колонки `DASHBOARD`: `DONE`, `MISSING_ITEMS` (или note).
- Новый лист `EXCLUDED_BOMS` (или поле в `BOM_STATE`).

### 5.5. Соответствие ТЗ для ролей и чекбокса «Выполнено»

Необходимо:
1. Создать `roles.js` и определить роли.
2. Проверять роли в `v11OnEdit`.
3. Добавить лист/регистр исключённых BOM.
4. Модифицировать `getAllBOMFiles()` — исключать BOM, отмеченные как «Выполнено».
5. Модифицировать `updateDashboard()` — добавлять чекбокс `DONE`.
6. Разрешить в `v11OnEdit` для DASHBOARD только колонку `DONE`, и только если BOM «Готов к производству».
---

## 6. Конкретный план доработок (для Act Mode)

> ⚠️ Это рекомендации для реализации. В Explore Mode изменения не вносятся. Чтобы реализовать, переключитесь в **Act Mode**.

### 6.1. Шаг 0 — Обновить `config.js`

Добавить/изменить:

```js
COLORS: {
  ...V11_CONFIG.COLORS,           // существующие
  GRAY: "#D9D9D9"                 // ошибка/неполные данные
},

MATERIAL_STATUS: {
  ...,
  ERROR: "Ошибка данных",
  ORDERED_ON_TIME: "Ожидаем (в срок)",      // переименован
  ORDERED_LATE: "Ожидаем (опаздывает)",     // переименован
  DATE_UNKNOWN: "Не указана дата поставки"  // переименован
},

BOM_STATUS: {
  NOT_PROCESSED: "Не обработан",
  PARTIAL_SELECTED: "Частично отобран",
  WAITING_ON_TIME: "Ожидание поставки (в срок)",
  WAITING_LATE: "Ожидание поставки (опаздывает)",
  READY: "Готов к производству"
},

DEFICIT_COLUMNS: {
  ...,
  UNIT: 13,   // добавить «Ед.изм» (или сдвинуть всю схему)
  ROW: 14     // добавить «Строка BOM»
},

DASHBOARD_COLUMNS: {
  ...,
  DONE: 10,
  MISSING_ITEMS: 11
},

SHEETS: {
  ...,
  EXCLUDED_BOMS: "EXCLUDED_BOMS"
}
```

**Примечание:** проще изменить `DEFICIT_COLUMNS` так, чтобы порядок соответствовал ТЗ: `ROW`, `CODE`, `NAME`, `UNIT`, `REQUIRED`, `ORDERED`, `DEFICIT`, `EXPECTED_DATE`, `DEADLINE_DATE`, `REAL_DELIVERY`, `RECEIVED`, `STATUS`. Это потребует согласованного обновления `updateDeficitSummary()`, `saveDeficitChanges()`, `createDeliveryCheckboxes()`, `colorDeficitSummaryRows()` и `v11OnEdit`.

---

### 6.2. Шаг 1 — Новая формула дефицита и статус (status_engine.js)

**Полностью переписать `computeMaterialStatus(row)`:**

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

  // Валидация обязательных полей BOM (серый цвет / ошибка)
  const missingRow = !row[C.BOM_ROW - 1];
  const missingCode = !String(row[C.MATERIAL_CODE - 1] || "").trim();
  const missingUnit = !String(row[C.UNIT - 1] || "").trim();
  const missingQty = required <= 0;
  const missingDeadline = !deadline;
  const hasError = missingRow || missingCode || missingUnit || missingQty || missingDeadline;

  // ДЕФИЦИТ ПО ТЗ: required − reserved  (НЕ вычитаем ordered!)
  const deficit = Math.max(required - reserved, 0);

  const MS = V11_CONFIG.MATERIAL_STATUS;
  const MST = V11_CONFIG.MATERIAL_STATE;

  let status, state;

  if (oldStatus === MS.ARCHIVED) { status = MS.ARCHIVED; state = MST.ARCHIVED; }
  else if (oldStatus === MS.REMOVED) { status = MS.REMOVED; state = MST.REMOVED; }
  else if (hasError) { status = MS.ERROR; state = MST.ERROR; }       // ← серый
  else if (received) { status = MS.RECEIVED; state = MST.RECEIVED; }
  else if (stock) { status = MS.STOCK; state = MST.STOCK; }
  else if (ordered <= 0) { status = MS.NOT_ORDERED; state = MST.DEFICIT; }
  else if (!expected) { status = MS.DATE_UNKNOWN; state = MST.WAITING; }   // «Не указана дата поставки»
  else if (ordered < deficit) { status = MS.PARTIAL_ORDER; state = MST.PARTIAL_ORDER; }
  else {
    const late = expected && deadline && new Date(expected) > new Date(deadline);
    status = late ? MS.ORDERED_LATE : MS.ORDERED_ON_TIME;   // «Ожидаем (опаздывает)» / «Ожидаем (в срок)»
    state = late ? MST.WAITING_LATE : MST.WAITING;
  }

  return { status, state, deficit, oldStatus, oldState, hasError, missing: { missingRow, missingCode, missingUnit, missingQty, missingDeadline } };
}
```

**Ключевые отличия от текущего:**
- `deficit = max(required − reserved, 0)` — без `ordered`.
- Сравнение `ordered < deficit` (а не `ordered < required`).
- Валидация обязательных полей → статус `ERROR` (серый).
- «Дата поставки неизвестна» переименована в «Не указана дата поставки».

---

### 6.3. Шаг 2 — Новая агрегация BOM (bom_state_engine.js)

**Переписать `recalculateBOMState()`** с расчётом недостающих позиций и новых статусов:

```js
function recalculateBOMState() {
  // ... чтение MATERIAL_STATE, группировка по BOM ...

  Object.keys(bomMap).forEach((bom) => {
    const item = bomMap[bom];

    // Кол-во ошибочных (серых) позиций
    const errorCount = item.errors;

    // «Не обработан»: ни один элемент не заказан
    const allNotOrdered = item.total > 0 && item.notOrdered === item.total;

    // «Частично отобран»: есть позиции без заказа / заказ < дефицита / нет сроков
    const partialConditions =
      item.partial > 0 || item.noExpectedDate > 0;

    // «Готов к производству»: все получены
    const allReceived = item.received === item.total && item.total > 0;

    // «Ожидание поставки (в срок)»: все заказаны достаточно, все даты ≤ крайних
    const allOrderedEnough = item.fullyOrdered === item.total;

    let status;
    if (allReceived) {
      status = V11_CONFIG.BOM_STATUS.READY;
    } else if (errorCount > 0) {
      status = "Ошибка данных";        // новый (или учитывать в дашборде как «Частично»)
    } else if (allNotOrdered) {
      status = V11_CONFIG.BOM_STATUS.NOT_PROCESSED;
    } else if (partialConditions) {
      status = V11_CONFIG.BOM_STATUS.PARTIAL_SELECTED;
    } else if (item.late > 0) {
      status = V11_CONFIG.BOM_STATUS.WAITING_LATE;
    } else if (allOrderedEnough) {
      status = V11_CONFIG.BOM_STATUS.WAITING_ON_TIME;
    } else {
      status = V11_CONFIG.BOM_STATUS.PARTIAL_SELECTED;
    }

    // Недостающие позиции для hover-подсказки
    const missingItems = item.missingItems;  // [{name, code, deficit, ordered}]
    output.push([
      bom, item.version, item.created || "", item.total,
      item.notOrdered + item.partial + item.noExpectedDate,
      item.notOrdered,
      item.maxExpected || "", item.maxDeadline || "",
      status,
      readyCount,
      new Date(),
      JSON.stringify(missingItems)   // для setNote / отдельной колонки
    ]);
  });
}
```

**Ключевое:** собирать `missingItems` — список позиций, где `ordered < deficit` или `ordered === 0` или нет даты — для подсказки на дашборде.

---

### 6.4. Шаг 3 — Дашборд с чекбоксом «Выполнено» (dashboard_engine.js)

**Переписать `updateDashboard()`:**
- Добавить чекбокс `DONE` (колонка 1), сдвинуть остальные.
- Для каждой строки: `DONE` брать из реестра исключённых BOM (или BOM_STATE).
- `MISSING_ITEMS` (колонка 11) — текст для подсказки; `Range.setNote()` для hover.

**Пример:**
```js
function updateDashboard() {
  // ...
  rows = data.slice(1).map((r) => {
    const bom = r[0];
    const done = isBOMDone(bom);               // из реестра исключённых
    const status = r[8];
    return [done, bom, status, r[2], r[3], r[4], r[5], r[6], r[7], r[9], r[11]];
  });

  writeValues(dashboard, 2, 1, rows);

  // Чекбоксы в колонке 1
  dashboard.getRange(2, 1, rows.length, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  // Hover-подсказки (ноты) на статус (колонка 3)
  rows.forEach((r, i) => {
    const cell = dashboard.getRange(i + 2, 3);
    if (r[10]) cell.setNote(r[10]);
    else cell.setNote("");
  });
}
```

**Защита:** в `v11OnEdit` для DASHBOARD разрешить только колонку `DONE`, и только если статус BOM = READY.

---

### 6.5. Шаг 4 — Роли (новый файл `roles.js`)

```js
const ROLE_ECONOMIST = "economist";
const ROLE_PROCURER = "procurement";   // снабженец
const ROLE_MANAGER = "manager";
const ROLE_STOREKEEPER = "storekeeper"; // кладовщик

const ROLE_MAP = {
  "email@example.com": ROLE_ECONOMIST,
  "procurement@example.com": ROLE_PROCURER,
  "manager@example.com": ROLE_MANAGER,
  "store@example.com": ROLE_STOREKEEPER
};

function getUserRole(email) {
  return ROLE_MAP[email] || null;
}

function canEditField(role, field) {
  const allowed = {
    [ROLE_PROCURER]: ["ORDERED", "EXPECTED_DATE", "REAL_DELIVERY"],
    [ROLE_MANAGER]: ["ORDERED", "EXPECTED_DATE", "DEADLINE_DATE", "REAL_DELIVERY"],
    [ROLE_STOREKEEPER]: ["RECEIVED"],
    [ROLE_ECONOMIST]: ["BOM_ROW", "CODE", "NAME", "UNIT", "REQUIRED", "DEADLINE_DATE", "EXPECTED_DATE"]
  };
  return (allowed[role] || []).indexOf(field) !== -1;
}
```

**Интеграция в `v11OnEdit`:**
```js
const user = getCurrentUser();
const role = getUserRole(user);
if (!role) { logSystem("v11OnEdit", "Неизвестная роль: " + user, "WARNING"); return; }

// Для DEFICIT_SUMMARY — разрешённые поля
if (name === V11_CONFIG.SHEETS.DEFICIT_SUMMARY) {
  const fieldName = getDeficitFieldName(column);  // маппинг колонка → имя поля
  if (!canEditField(role, fieldName)) {
    e.range.setValue(/* старое значение */);
    logSystem("v11OnEdit", "Запрещено поле для роли " + role + ": " + fieldName, "WARNING");
    return;
  }
  // ... обработка чекбоксов/дат/заказа
}
```

---

### 6.6. Шаг 5 — Архивация и «Получено» по ролям

- `processSummaryReceived()` вызывается только если роль = `storekeeper` (кладовщик).
- `confirmMaterialReceived()` внутр. проверяет `getUserRole()` и выкидывает ошибку для остальных.
- Добавить `cancelMaterialReceived` в код (уже есть) — разрешить только кладовщику.

---

### 6.7. Шаг 6 — Подкраска BOM-файлов (export_engine.js)

В `exportBOMFile()` после записи статуса:

```js
// Собрать цвета по строкам, записать одним setBackgrounds
const colors = [];
for (let i = 1; i < data.length; i++) {
  // ... найти материал, определить статус/цвет
  colors.push(new Array(lastColumnCount).fill(statusColor));
}
sheet.getRange(2, 1, colors.length, lastColumnCount).setBackgrounds(colors);
```

Добавить `getStatusColor(MS.ERROR)` → `COLORS.GRAY`.

---

### 6.8. Шаг 7 — Реестр исключённых BOM (exclusion_registry.js)

```js
function isBOMDone(bom) {
  const sheet = getSheetByKey("EXCLUDED_BOMS");
  const data = readSheetValues(sheet);
  for (let i = 1; i < data.length; i++) {
    if (normalizeMaterialId(data[i][0]) === normalizeMaterialId(bom) && data[i][1] === true) {
      return true;
    }
  }
  return false;
}

function setBOMDone(bom, done) {
  // добавить/обновить строку в EXCLUDED_BOMS
}

// В getAllBOMFiles() — фильтровать исключённые
function getAllBOMFiles() {
  // ... после сбора файлов:
  return result.filter((file) => !isBOMDone(file.getName().replace(/\.[^/.]+$/, "")));
}
```

---

## 7. Module Reference (обновлённый, после доработок)

| Файл | Роль | Ключевое изменение |
|------|------|-------------------|
| `config.js` | Единый источник правды | Новые статусы, цвета, колонки, лист EXCLUDED_BOMS |
| `status_engine.js` | Расчёт дефицита/статуса | Новая формула `required−reserved`, сравнение с `deficit`, статус ERROR |
| `bom_state_engine.js` | Агрегация по BOM | Новые BOM-статусы, список missingItems |
| `deficit_engine.js` | Сводка дефицитов | Добавить UNIT/ROW, серый цвет, новый статус |
| `dashboard_engine.js` | Дашборд | Чекбокс DONE, hover-подсказки, статус «Не обработан» |
| `export_engine.js` | Экспорт в BOM-файлы | Раскраска позиций по статусам |
| `roles.js` (новый) | Роли и права | `getUserRole()`, `canEditField()` |
| `validation_engine.js` (новый) | Валидация BOM-позиций | Обязательные поля, ошибочные записи |
| `exclusion_registry.js` (новый) | Исключённые BOM | `isBOMDone()`, `setBOMDone()` |
| `trigger_engine.js` | onEdit / планировщик | Проверка ролей, обработка DONE, фильтрация BOM |
| `material_actions.js` | Действия с материалом | Проверка ролей |
| `archive_engine.js` | Архив | Без изменений (проверка ролей в вызывающем коде) |
| `sheet_service.js` | Обёртки листов | Без изменений |
| `event_engine.js` | События | Без изменений (или добавить событие REAL_DELIVERY) |
| `logger.js` | Логирование | Без изменений |
| `utils.js` | Утилиты | Без изменений |
| `lock.js` | Блокировки | Без изменений |
| `controller.js` | Меню, runFullUpdate | Без изменений логики (убрать лишние sleep) |

---

## 8. Suggested Reading Order (для инженера, который будет дорабатывать)

1. `config.js` — понять все колонки/статусы/цвета (база).
2. `status_engine.js` — `computeMaterialStatus()` (главная логика, которую меняем).
3. `deficit_engine.js` — `updateDeficitSummary()` + `saveDeficitChanges()` (сводка и перенос изменений).
4. `bom_state_engine.js` — `recalculateBOMState()` (агрегация по BOM, новые статусы).
5. `dashboard_engine.js` — `updateDashboard()` (чекбокс DONE, hover-подсказки).
6. `trigger_engine.js` — `v11OnEdit` (роли, запреты, обработка чекбоксов).
7. `export_engine.js` — `exportBOMFile()` (раскраска BOM-файлов).
8. `material_actions.js` + `archive_engine.js` — действия снабженца/кладовщика, архив.

---

## 9. Риски и подводные камни

1. **Миграция колонок DEFICIT_SUMMARY** (добавление UNIT/ROW) сломает `saveDeficitChanges()`, `createDeliveryCheckboxes()`, `colorDeficitSummaryRows()`, `v11OnEdit` — нужно обновлять все одновременно.
2. **Переименование статусов** сломает `getStatusColor()` (switch по строкам) и условное форматирование дашборда — обновить карту цветов.
3. **Смена формулы дефицита** повлияет на `saveDeficitChanges()` (он переносит `ORDERED`, но не пересчитывает deficit) — необходимо пересчитывать через `recalculateMaterials()` после переноса.
4. **Роли** — если email неизвестен системе, надо решить: блокировать или разрешить по умолчанию (рекомендация — блокировать + логировать).
5. **«Выполнено»** — исключение BOM из сканирования не должно удалять файл; просто фильтровать в `getAllBOMFiles()`.
6. **Hover-подсказка** — `Range.setNote()` — это нативная фича Sheets; но при пересоздании `updateDashboard()` ноты нужно перезаписывать (иначе остаются от старых строк).
7. **Производительность** — при добавлении раскраски в BOM-файлы и серых строк в сводку количество API-вызовов вырастет; нужно батчить (уже есть `batchWrite`).

---

## 10. Заключение

**Итог:** система уже имеет правильный каркас (листы, импорт/экспорт, логирование, архив, дашборд), но **логика статусов и дефицита не соответствует ТЗ**, отсутствуют **роли**, **валидация с серым цветом**, **чекбокс «Выполнено»** и **hover-подсказки**.

Рекомендуемый путь — **не переписывать с нуля**, а провести **целевой рефакторинг**:
1. Исправить формулу дефицита и статусы (status_engine.js).
2. Добавить роли (roles.js) и проверки в v11OnEdit.
3. Добавить валидацию обязательных полей + серый цвет.
4. Перестроить дашборд (чекбокс DONE + hover-подсказки + «Не обработан»).
5. Добавить раскраску BOM-файлов.
6. Обновить config.js (новые статусы/цвета/колонки).

Это позволит привести систему в соответствие с ТЗ без потери уже работающих компонентов.

---

**Важно:** Я сейчас в **Explore Mode** — только анализирую и документирую, изменения не вношу. Чтобы я реализовал эти доработки, переключитесь в **Act Mode** (переключатель Plan/Act внизу чата). Найденные расхождения и план сохранены в контексте и будут перенесены в Act Mode.
