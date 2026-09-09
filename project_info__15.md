Отчёт сохранён в `project_info__14.md`. Ниже — скорректированный анализ по вашим комментариям (я в **Explore Mode** — только чтение; чтобы внести правки, нужен **Act Mode**).

---

# BOM CONTROL SYSTEM V12 — Корректировка модели и решений (Конфликты 2, 3, 4, 6)

## Уточнённая целевая модель (по вашим комментариям)

1. **«Сводка дефицитов» (DEFICIT_SUMMARY) содержит ВСЕ материалы из BOM** — вне зависимости от наличия/отсутствия дефицита. Отсечение по `deficit > 0` НЕ нужно (мой предыдущий вариант S1 **отменяется**).
2. **Признак «приехало/на складе»** = `availableForProduction >= required`, где `availableForProduction = reserved + realDelivery` (уже реализовано в `v12_calculate.js`, К1). Условие: `required <= reserved + realDelivery`.
3. **Статус «на складе»** = `supplyState = RESERVED`. В интерфейсе все статусы — только по-русски.
4. **Отборка (PICKING)**: позиции с ошибками данных → статус «Некорректные данные», чекбокс «Получено» НЕ активен до устранения ошибок. В шаблоне BOM должна быть валидация полноты/корректности.
5. **Контроль складских остатков — вне зоны ответственности.** Приложение лишь сверяет «пришло ли достаточно»: `reserved + realDelivery >= required`. Если да → дефицит закрыт.

## Исправленные конфликты и решения

### Конфликт 1 — (снят)
Попадание дефицит-0 позиций в «Сводку дефицитов» — **правильное** поведение (сводка = все BOM-позиции). Ничего фильтровать не надо.

### Конфликт 2 — Предикат «приехало» = `availableForProduction >= required`
**Решение:** единый признак готовности/«на складе» — `availableForProduction >= required`. `deficit` остаётся справочной колонкой (потребность в заказе), но «закрытие» определяется через `available`.

Пример `required=10, reserved=3, realDelivery=7` → `available=10 >= required` → статус «На складе» (приехало), хотя `deficit=7`. Это соответствует вашему комментарию: «когда приезжает недостающий материал… ставится галочка Реальная поставка. Если required ≤ reserved + realDelivery, тогда считается, что материал приехал».

**Правки:**
- В `v12RefreshDeficitSummary` статус-колонка: `if (validation === ERROR) → "Некорректные данные"`; `else if (available >= required) → "На складе"`; `else → v12SupplyStatusDisplay(supplyState)`.
- Чекбоксы «Получено»/«Реальная поставка» в сводке: активны, когда есть смысл (для «Реальной поставки» — когда `deficit > 0`, т.е. есть что довозить; для «Получено» в отборке — когда `available >= required`).
- В `v12RefreshPicking` чекбокс «Получено» (кол. 13) — только когда `available >= required && valid` (см. Конфликт 4).

### Конфликт 3 — Статус «на складе» = RESERVED; интерфейс — только по-русски
**Решение:** внутри держать английские константы (`SUPPLY_STATE.RESERVED` и т.д.), а **русские отображаемые значения** подставлять в колонки проекций (не менять значения в `POSITION_STATE` — иначе сломается логика сравнения).

**Маппинг SUPPLY_STATE (колонки SUPPLY_STATE/STATUS):**
| Англ. | Русский |
|-------|---------|
| `NO_REQUIREMENT` | Нет потребности |
| `RESERVED` | **На складе** (было «Зарезервировано») |
| `NOT_ORDERED` | Не заказано |
| `PARTIALLY_ORDERED` | Заказано частично |
| `ORDERED` | Заказано |
| `PARTIALLY_DELIVERED` | Поставлено частично |
| `DELIVERED` | Поставлено |

**Маппинг PRODUCTION_STATE (колонки PRODUCTION_STATE в Отборке и WORKING BOM):**
| Англ. | Русский |
|-------|---------|
| `NOT_AVAILABLE` | Нет в наличии |
| `PARTIALLY_AVAILABLE` | Частично доступно |
| `READY_FOR_HANDOFF` | Готово к передаче |
| `RECEIVED` | Передано |

**Куда применить:** `v12RefreshPicking` (кол. PRODUCTION_STATE), `v12RefreshWorkingBOM` (кол. PRODUCTION_STATE), `v12RefreshDeficitSummary` (кол. SUPPLY_STATE и STATUS). Добавить маппер `v12ProductionStatusDisplay` и поменять в `v12SupplyStatusDisplay` `RESERVED → "На складе"`.

### Конфликт 4 — Ошибки данных в Отборке + валидация шаблона BOM
**Решение:**
- В `v12RefreshPicking` строки с `VALIDATION_STATUS === ERROR` → колонка статуса/`PRODUCTION_STATE` = **«Некорректные данные»**, чекбокс «Получено» НЕ ставится (не создаём data-validation или блокируем в обработчике). `v12MarkReceivedByProduction` уже возвращает `blocked` при невалидности — оставить как защиту.
- **Валидация шаблона BOM:** `v12ValidatePosition` уже требует Строку, Наименование, Модель, Ед.изм, Требуемое (>0), Срок; Код — не обязателен. Ужесточить/использовать на этапе **импорта**:
  - В `v12ParseSourceRows` после разбора проверять каждую строку и копить ошибки (какие материалы/поля не заполнены).
  - В `v12SyncBOM` (или `v12RunFullSync`) при наличии ошибок — **не завершать импорт молча**: собрать отчёт (BOM → строка → поле) и показать пользователю/записать в SYSTEM_LOG с уровнем ERROR; синхронизация по этому BOM помечается как «ошибка данных», позиции получают `VALIDATION_STATUS = ERROR`.
  - Опционально — в самом шаблоне (файл источника) добавить **data validation** на обязательные колонки (список, обязательность, числовые диапазоны), чтобы сотрудник не мог сохранить BOM с пропусками.

### Конфликт 6 — Контроль склада вне зоны ответственности
**Решение:**
- **Удалить** уменьшение склада при передаче: в `v12MarkReceivedByProduction` убрать `v12AdjustWarehouseQty(materialKey, -required)`.
- **Убрать** увеличение склада при поставке: в `v12SetRealDeliveryQty` убрать `v12AdjustWarehouseQty(materialKey, delta)` — факт прихода фиксируется только через `REAL_DELIVERY_QTY` в `POSITION_STATE`.
- **Не использовать** `WAREHOUSE_QTY` как условие готовности/передачи. Критерий — только `availableForProduction >= required`.
- `v12RecalculateWarehouseConsistency` (ТЗ №30, проверка `reserved > warehouse`) — вне зоны: либо удалить вызов из `v12RunFullSync`, либо оставить как информационный отчёт, но **никогда не блокировать** отборку/передачу.
- Лист `MATERIAL_STATE` (физический склад) — либо оставить как пассивную справку, либо убрать из обязательных. Рекомендация: оставить как справочный, не влияющий на логику.

## Итоговые правки по файлам

| Файл | Правка |
|------|--------|
| `v12_calculate.js` | `v12ValidatePosition` — уже валидирует ТЗ №8; можно ужесточить (числа ≥ 0, формат даты) |
| `v12_projections.js` | `v12RefreshDeficitSummary`: не фильтровать по дефициту; статус = «Некорректные данные» / «На складе» / supplyState-рус; SUPPLY_STATE в русском; чекбоксы по готовности. `v12RefreshPicking`: PRODUCTION_STATE в русском; статус «Некорректные данные»; чекбокс только при `available >= required && valid`. `v12RefreshWorkingBOM`: PRODUCTION_STATE в русском. Добавить `v12ProductionStatusDisplay` |
| `v12_handoff.js` | `v12MarkReceivedByProduction`: убрать `v12AdjustWarehouseQty(-required)`; гейт — `available >= required && valid` |
| `v12_operations.js` | `v12SetRealDeliveryQty`: убрать `v12AdjustWarehouseQty(+delta)` |
| `v12_source.js` / `v12_change_engine.js` | Валидация разбора: `v12ParseSourceRows` → проверка полноты; `v12SyncBOM` → отчёт об ошибках, `VALIDATION_STATUS = ERROR`, не молчать |
| `v12_trigger.js` | `v12InstallDeficitCheckboxes` / `v12InstallPickingCheckboxes` — ставить чекбоксы только на «готовые» строки |
| `v12_material_state.js` | `v12RecalculateWarehouseConsistency` — убрать/сделать информационным, не блокирующим |
| `v12_config.js` | Добавить `PRODUCTION_STATUS`-маппинг/русские константы отображения |

## Вывод
- Ошибки в моём предыдущем анализе: **S1 отменяется** (сводка = все BOM); «на складе» = `RESERVED`, а не отдельный статус; признак «приехало» — `availableForProduction >= required`, а не `deficit <= 0`.
- Решения: развести **статус (справочный, по-русски)**, **готовность (`available >= required`)** и **валидацию данных**; убрать контроль склада из процесса.

---

Чтобы внести эти правки в код, переключитесь на **Act Mode**.