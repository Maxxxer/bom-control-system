# project_info__69 — Добавлено поле «Производитель», переименования колонок, новый ключ материала

## Что сделано

Единое переименование колонок и добавление поля «Производитель» во все листы, меняется схема «Сводки дефицитов», меняется формула ключа материала.

### Единые названия колонок (канон по всем листам)
`BOM_ROW` → **№ п/п** · `MATERIAL_CODE` → **Артикул** · `REQUIRED_QTY` → **Кол-во** ·
`REAL_DELIVERY_QTY` → **Реальная поставка** · `DEADLINE` → **Крайний срок поставки** ·
`MANUFACTURER` → **Производитель** (новое). `Наименование`, `Модель`, `Ед.изм`,
`Зарезервировано`, `Заказано`, `Ожидаемая поставка` — без изменений.

### Ключ материала (К5) — изменён
`v12BuildMaterialKey` = **«Артикул + Производитель»**:
- если артикул заполнен → `code|manufacturer`; при пустом производителе — просто `code`
  (обратная совместимость);
- если артикул пуст → fallback `name|model[|manufacturer]|unit` (производитель включается,
  только если заполнен).

## Изменённые файлы

| Файл | Изменение |
|---|---|
| `v12_config.js` | Счётчики: `COLUMN_COUNT` DEFICIT 14→15, PICKING 12→13, WORKING_BOM 15→16, SUPPLY 9→10, ARCHIVE 13→14, MATERIAL_STATE 9→10, POSITION_STATE 31→32. `POSITION_COLUMNS.MANUFACTURER=32`, `MATERIAL_COLUMNS.MANUFACTURER=10` (в конец — без сдвига данных). `DEFICIT_COLUMNS`/`PICKING_COLUMNS`/`WORKING_BOM_COLUMNS`/`SUPPLY_COLUMNS`/`ARCHIVE_COLUMNS` — добавлен `MANUFACTURER` и сдвинуты последующие. Все `HEADERS.*` приведены к канону. |
| `v12_source.js` | `v12ParseSourceRows`: алиасы `№ п/п`, `Артикул`, `Кол-во`, `Крайний срок поставки`; чтение `Производитель` (старые заголовки сохранены). |
| `v12_position_state.js` | `v12BuildPositionRow`: запись `MANUFACTURER`. |
| `v12_change_engine.js` | `manufacturer` в `POSITION_ADDED`, сравнение с `MATERIAL_CHANGED` (field `MANUFACTURER`), `colMap += MANUFACTURER`. |
| `v12_utils.js` | Новая формула `v12BuildMaterialKey`. |
| `v12_projections.js` | `v12BuildDeficitRow` (+Производитель 5-й колонкой), `v12RefreshPicking`, `v12RefreshWorkingBOM`, `v12RefreshSupply` (агрегация + вывод), `v12BuildMissingEntry`. |
| `v12_handoff.js` | `v12BuildMaterialKey(..., manufacturer)`; архивная строка + `MANUFACTURER`. |
| `v12_material_state.js` | Ключ с manufacturer; при создании строки склада пишутся `MATERIAL_CODE`/`MANUFACTURER`. |
| `v12_operations.js` | Ключ с manufacturer. |
| `v12_sheet_service.js` | `V12_ALIGN_CENTER_COLUMNS` под новые индексы. Новая `v12MigrateCanonicalHeaders()` (приводит шапки всех листов к канону; для persistent-листов колонки добавлены в конец — данные не сдвигаются) и `v12ClearPhantomValidations()` (сброс «фантомных» чекбоксов там, где позиция чекбокс-колонки сдвинулась). Обе вызваны в `v12EnsureAllSheets`. |
| `_local_tests/v12_deficit_filter_test.js` | Индексы DEFICIT + проверка `MANUFACTURER=5`. |
| `_local_tests/v12_picking_schema_test.js` | Схема PICKING 12→13, POSITION_STATE 31→32. |
| `_local_tests/v12_supply_schema_test.js` | Схема SUPPLY 9→10, индексы и выравнивание. |
| `REGULATIONS.md` | §4.2 (шапка BOM), §4.3 (обязательные поля). |

## Миграция и порядок запуска
1. `⚙ Установка V12` — миграции и приведение шапок к канону.
2. `🔄 Полная синхронизация` — читает BOM с новыми колонками; для существующих позиций
   `MANUFACTURER` дозаполняется событием `MATERIAL_CHANGED`.
3. Старые BOM (с `Код`/`Требуется`/`Ед.изм`) продолжают читаться (алиасы сохранены).

## Замечания
- Позиция «Производитель» — **после «Артикул»** во всех листах (единообразно).
- `Ед.изм` осталась обязательной (по решению: «добавим в BOM ед. изм.»).
- Ключ MATERIAL_STATE для старых записей без производителя не меняется (`code`), поэтому
  складские остатки остаются привязанными; при появлении производителя ключ станет `code|manufacturer`.

## Проверка
- Все 15 локальных тестов (`_local_tests/*_test.js`) проходят: `TOTAL: 15, FAILED: 0`.
- `node --check` по всем изменённым файлам — OK.
