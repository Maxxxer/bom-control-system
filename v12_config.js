/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_config.js
 *
 * Единый источник правды для новой архитектуры
 *   ORIGINAL BOM (источник, read-only)
 *     -> BOM_REGISTRY
 *       -> POSITION_STATE (центральное операционное состояние)
 *         -> MATERIAL_STATE (физический склад)
 *         -> DEFICIT_SUMMARY / ОТБОРКА / WORKING BOM /
 *            СНАБЖЕНИЕ / DASHBOARD (проекции)
 *
 * Здесь зафиксированы решения по конфликтам ТЗ (К1–К7):
 *   К1: reservedQty = складское удержание под позицию BOM.
 *   К2: таблица маппинга supplyState/productionState -> BOM-статус дашборда.
 *   К3: READY_FOR_HANDOFF vs RECEIVED_BY_PRODUCTION — разные понятия.
 *   К4: reserved = 0 — валидный дефолт; валидация по №8 ТЗ.
 *   К5: materialKey = code, иначе name|model|unit.
 *   К6: RETURN_FROM_ARCHIVE — возврат receivedByProductionQty -> склад.
 *   К7: инкрементальное обновление проекций + ленивая сверка.
 * =====================================================
 */

const V12_CONFIG = {

  VERSION: "12.0.0",

  SYSTEM: {
    NAME: "BOM CONTROL SYSTEM V12",
    BUILD_DATE: "2026-09-09"
  },

  /**
   * Листы
   */
  SHEETS: {
    BOM_REGISTRY: "BOM_REGISTRY",
    POSITION_STATE: "POSITION_STATE",
    MATERIAL_STATE: "MATERIAL_STATE",
    DEFICIT_SUMMARY: "Сводка дефицитов",
    PICKING: "ОТБОРКА",
    WORKING_BOM: "WORKING BOM",
    SUPPLY: "СНАБЖЕНИЕ",
    DASHBOARD: "Dashboard",
    ARCHIVE: "Архив",
    AUDIT_LOG: "AUDIT_LOG",
    EVENT_LOG: "EVENT_LOG",
    SYSTEM_LOG: "SYSTEM_LOG",
    MATERIAL_HISTORY: "MATERIAL_HISTORY",
    BOM_REVISION: "BOM_REVISION",
    EXCLUDED_BOMS: "EXCLUDED_BOMS",
    PENDING_EDITS: "PENDING_EDITS"
  },

  /**
   * Количество колонок по листам
   */
  COLUMN_COUNT: {
    BOM_REGISTRY: 12,
    POSITION_STATE: 32,
    MATERIAL_STATE: 10,
    DEFICIT_SUMMARY: 15,
    PICKING: 13,
    WORKING_BOM: 16,
    SUPPLY: 10,
    DASHBOARD: 11,
    ARCHIVE: 14,
    AUDIT_LOG: 11,
    EVENT_LOG: 7,
    SYSTEM_LOG: 5,
    MATERIAL_HISTORY: 7,
    BOM_REVISION: 4,
    EXCLUDED_BOMS: 3,
    PENDING_EDITS: 10
  },

  /**
   * BOM_REGISTRY (12)
   * Реестр BOM: связь «источник <-> рабочий BOM», ревизии, dirty-флаг.
   */
  BOM_REGISTRY_COLUMNS: {
    BOM_ID: 1,
    SOURCE_SPREADSHEET_ID: 2,
    SOURCE_SHEET_NAME: 3,
    WORKING_SPREADSHEET_ID: 4,
    BOM_NAME: 5,
    ACTIVE: 6,
    COMPLETED_FLAG: 7,
    SOURCE_REVISION: 8,
    LAST_HASH: 9,
    LAST_SYNC_AT: 10,
    DIRTY: 11,
    UPDATED_AT: 12
  },

  /**
   * POSITION_STATE (32)
   * Центральное операционное состояние позиции.
   * Колонка REAL_DELIVERY_DATE (31) — дата, которой позиция была отмечена
   * как реальная поставка (используется в ОТБОРКЕ для материала на складе).
   * Колонка MANUFACTURER (32) — производитель материала (из BOM), добавлена
   * в конец, чтобы не сдвигать существующие индексы 1..31.
   */
  POSITION_COLUMNS: {
    POSITION_ID: 1,
    BOM_ID: 2,
    SOURCE_REVISION: 3,
    BOM_NAME: 4,
    BOM_ROW: 5,
    MATERIAL_CODE: 6,
    MATERIAL_NAME: 7,
    MODEL: 8,
    UNIT: 9,
    REQUIRED_QTY: 10,
    RESERVED_QTY: 11,
    ORDERED_QTY: 12,
    REAL_DELIVERY_QTY: 13,
    EXPECTED_DATE: 14,
    DEADLINE: 15,
    RECEIVED_BY_PRODUCTION_QTY: 16,
    RECEIVED_BY_PRODUCTION: 17,
    RECEIVED_BY_PRODUCTION_AT: 18,
    RECEIVED_BY_PRODUCTION_USER: 19,
    VALIDATION_STATUS: 20,
    LIFECYCLE_STATE: 21,
    SUPPLY_STATE: 22,
    PRODUCTION_STATE: 23,
    DEFICIT_QTY: 24,
    UNCOVERED_NEED: 25,
    OVER_ORDERED_QTY: 26,
    SHORT_DELIVERY_QTY: 27,
    AVAILABLE_FOR_PRODUCTION: 28,
    FLAGS: 29,
    UPDATED_AT: 30,
    REAL_DELIVERY_DATE: 31,
    MANUFACTURER: 32
  },

  /**
   * MATERIAL_STATE (10) — физический склад, НЕ источник потребности.
   * Колонка MANUFACTURER (10) — производитель материала (из BOM), добавлена
   * в конец, чтобы не сдвигать существующие индексы 1..9.
   */
  MATERIAL_COLUMNS: {
    MATERIAL_KEY: 1,
    MATERIAL_CODE: 2,
    MATERIAL_NAME: 3,
    MODEL: 4,
    UNIT: 5,
    WAREHOUSE_QTY: 6,
    RESERVED_QTY: 7,
    FREE_QTY: 8,
    UPDATED_AT: 9,
    MANUFACTURER: 10
  },

  /**
   * DEFICIT_SUMMARY (15) — проекция для снабжения (заказ, даты, поставка).
   * Только позиции, материал которых ещё не приехал (availableForProduction < required).
   * Дефицит (кол. DEFICIT_QTY) = max(0, required − reserved).
   * Колонка MANUFACTURER (5) — производитель (из BOM), сразу после «Артикул».
   */
  DEFICIT_COLUMNS: {
    POSITION_ID: 1,
    BOM_NAME: 2,
    BOM_ROW: 3,
    MATERIAL_CODE: 4,
    MANUFACTURER: 5,
    MATERIAL_NAME: 6,
    MODEL: 7,
    UNIT: 8,
    DEFICIT_QTY: 9,
    ORDERED_QTY: 10,
    EXPECTED_DATE: 11,
    DEADLINE: 12,
    REAL_DELIVERY: 13,
    UNCOVERED_NEED: 14,
    STATUS: 15
  },

  /**
   * ОТБОРКА (PICKING) (12) — интерфейс кладовщика/производства.
   * Колонка «Дата поставки» (EXPECTED_DATE) справа от «Состояние поставки»
   * показывает дату поставки: для материала на складе — дату фактической
   * поставки (REAL_DELIVERY_DATE), иначе — ожидаемую дату прихода.
   */
  PICKING_COLUMNS: {
    POSITION_ID: 1,
    BOM_NAME: 2,
    BOM_ROW: 3,
    MATERIAL_CODE: 4,
    MANUFACTURER: 5,
    MATERIAL_NAME: 6,
    MODEL: 7,
    UNIT: 8,
    REQUIRED_QTY: 9,
    AVAILABLE_FOR_PRODUCTION: 10,
    PRODUCTION_STATE: 11,
    EXPECTED_DATE: 12,
    CHECKBOX: 13
  },

  /**
   * WORKING BOM (15) — периодический документ на BOM (для производства).
   * Колонка CHECKBOX (14) — передача производству (как в ОТБОРКЕ).
   */
  WORKING_BOM_COLUMNS: {
    POSITION_ID: 1,
    BOM_NAME: 2,
    BOM_ROW: 3,
    MATERIAL_CODE: 4,
    MANUFACTURER: 5,
    MATERIAL_NAME: 6,
    MODEL: 7,
    UNIT: 8,
    REQUIRED_QTY: 9,
    RESERVED_QTY: 10,
    REAL_DELIVERY_QTY: 11,
    AVAILABLE_FOR_PRODUCTION: 12,
    RECEIVED_BY_PRODUCTION_QTY: 13,
    PRODUCTION_STATE: 14,
    CHECKBOX: 15,
    UPDATED_AT: 16
  },

  /**
   * СНАБЖЕНИЕ (SUPPLY) (9) — агрегация по materialKey.
   * Колонка PROJECTS (последняя) — перечень проектов, использующих материал,
   * в формате «<дефицит> - <номер проекта> - <крайний срок>», по строке на
   * проект, отсортированный по крайнему сроку по возрастанию (самый ранний
   * сверху). Для проекта берётся САМЫЙ РАННИЙ крайний срок его позиций
   * (самое жёсткое ограничение). Пример: «4 - 1234.АБВ - 20.09.2026».
   */
  SUPPLY_COLUMNS: {
    MATERIAL_KEY: 1,
    MATERIAL_CODE: 2,
    MANUFACTURER: 3,
    MATERIAL_NAME: 4,
    MODEL: 5,
    UNIT: 6,
    TOTAL_DEFICIT: 7,
    TOTAL_ORDERED: 8,
    TOTAL_REAL_DELIVERY: 9,
    PROJECTS: 10
  },

  /**
   * DASHBOARD (11). Колонки «Прогресс» и «Обновлено» убраны; «BOM ID» скрыта
   * визуально (движку нужна для идентификации строки в обработчике «Выполнено»).
   * Чекбокс «Выполнено» (DONE) обрабатывается ТАК ЖЕ, как чекбоксы Сводки:
   * правка фиксируется в очереди (PENDING_EDITS, поле DASHBOARD_DONE) и
   * применяется кнопкой «ПРИМЕНИТЬ»; отмеченный BOM убирается из активного
   * дашборда (переходит в EXCLUDED_BOMS).
   * «Статус» показывает текстовое состояние BOM (см. BOM_STATUS) с цветовой
   * раскраской по состоянию (BOM_STATUS_COLOR). «На складе» — количество
   * позиций BOM, готовых к отборке, но ещё не переданных производству.
   * «Ожидается поставка» (AWAITING_SUPPLY) — количество позиций BOM в снабжении
   * (не заказано / заказано частично / ожидается в срок / ожидается опаздывает).
   */
  DASHBOARD_COLUMNS: {
    DONE: 1,
    BOM_ID: 2,
    BOM_NAME: 3,
    STATUS: 4,
    TOTAL_POSITIONS: 5,
    ON_SHELF: 6,
    AWAITING_SUPPLY: 7,
    COLLECTED_POSITIONS: 8,
    DATE_CREATED: 9,
    DEADLINE: 10,
    MISSING_ITEMS: 11
  },

  /**
   * ARCHIVE (13)
   */
  ARCHIVE_COLUMNS: {
    DATE: 1,
    POSITION_ID: 2,
    BOM_NAME: 3,
    BOM_ROW: 4,
    MATERIAL_CODE: 5,
    MATERIAL_NAME: 6,
    MODEL: 7,
    UNIT: 8,
    RECEIVED_BY_PRODUCTION_QTY: 9,
    RECEIVED_BY_PRODUCTION_AT: 10,
    RECEIVED_BY_PRODUCTION_USER: 11,
    SOURCE_UI: 12,
    HISTORY: 13,
    MANUFACTURER: 14
  },

  /**
   * AUDIT_LOG (11)
   */
  AUDIT_COLUMNS: {
    DATE: 1,
    OPERATION_ID: 2,
    ACTOR: 3,
    ACTION: 4,
    BOM_ID: 5,
    POSITION_ID: 6,
    FIELD: 7,
    OLD_VALUE: 8,
    NEW_VALUE: 9,
    REASON: 10,
    DATA: 11
  },

  /**
   * MATERIAL_HISTORY (7)
   */
  HISTORY_COLUMNS: {
    DATE: 1,
    POSITION_ID: 2,
    EVENT: 3,
    OLD_VALUE: 4,
    NEW_VALUE: 5,
    USER: 6,
    COMMENT: 7
  },

  /**
   * EVENT_LOG (7)
   */
  EVENT_COLUMNS: {
    DATE: 1,
    EVENT_ID: 2,
    EVENT_TYPE: 3,
    POSITION_ID: 4,
    BOM: 5,
    USER: 6,
    DATA: 7
  },

  /**
   * SYSTEM_LOG (5)
   */
  SYSTEM_LOG_COLUMNS: {
    DATE: 1,
    FUNCTION: 2,
    MESSAGE: 3,
    LEVEL: 4,
    DATA: 5
  },

  /**
   * BOM_REVISION (4)
   */
  BOM_REVISION_COLUMNS: {
    DATE: 1,
    BOM_ID: 2,
    REVISION: 3,
    USER: 4
  },

  /**
   * EXCLUDED_BOMS (3)
   */
  EXCLUDED_BOMS_COLUMNS: {
    BOM_ID: 1,
    DONE: 2,
    DATE: 3
  },

  /**
   * PENDING_EDITS (10) — очередь намерений (Вариант D + Вариант A).
   *
   * onEdit для редактируемых полей только фиксирует намерение строкой здесь
   * (без лока и без тяжёлой работы), а применяет всё пакетно, одним пересчётом
   * проекций, кнопка «✅ Применить изменения» (v12ApplyChanges). Очередь —
   * первичный источник истины: значение не теряется, даже если колонку/ячейку
   * перезапишет пересборка проекции.
   *
   * Охват: чекбоксы ОТБОРКИ / WORKING BOM / Сводки (HANDOFF, REAL_DELIVERY),
   * чекбокс «Выполнено» дашборда (DASHBOARD_DONE) и типизированные поля Сводки
   * дефицитов — «Заказано» (ORDERED_QTY) и «Ожидаемая поставка» (EXPECTED_DATE).
   * Поэтому колонка VALUE хранит не только boolean (чекбоксы), но и число
   * (ORDERED_QTY) либо дату (EXPECTED_DATE) — интерпретация зависит от поля FIELD.
   */
  PENDING_EDIT_COLUMNS: {
    DATE: 1,
    EDIT_ID: 2,
    SOURCE: 3,
    POSITION_ID: 4,
    FIELD: 5,
    VALUE: 6,
    USER: 7,
    STATUS: 8,
    PROCESSED_AT: 9,
    ERROR: 10
  },

  /**
   * Статусы строк очереди PENDING_EDITS.
   */
  PENDING_STATUS: {
    PENDING: "PENDING",
    DONE: "DONE",
    FAILED: "FAILED"
  },

  /**
   * Поле намерения (FIELD) в очереди.
   *
   * DASHBOARD_DONE — чекбокс «Выполнено» дашборда (SOURCE = DASHBOARD).
   * Значение boolean, как и у остальных чекбокс-полей (HANDOFF/REAL_DELIVERY),
   * но POSITION_ID для него хранит BOM ID — строка дашборда равна одному BOM.
   */
  PENDING_FIELD: {
    HANDOFF: "HANDOFF",
    REAL_DELIVERY: "REAL_DELIVERY",
    ORDERED_QTY: "ORDERED_QTY",
    EXPECTED_DATE: "EXPECTED_DATE",
    DASHBOARD_DONE: "DASHBOARD_DONE"
  },

  /**
   * Заголовки листов (канон: русские).
   */
  HEADERS: {
    BOM_REGISTRY: [
      "BOM ID", "Source Spreadsheet ID", "Source Sheet", "Working Spreadsheet ID",
      "BOM Name", "Активен", "Выполнено", "Ревизия источника", "Hash",
      "Последняя синхронизация", "Dirty", "Обновлено"
    ],
    POSITION_STATE: [
      "Position ID", "BOM ID", "Ревизия", "BOM", "№ п/п", "Артикул", "Наименование",
      "Модель", "Ед.изм", "Кол-во", "Зарезервировано", "Заказано", "Реальная поставка",
      "Ожидаемая поставка", "Крайний срок поставки", "Передано производству (кол-во)",
      "Передано производству", "Дата передачи", "Кто передал", "Валидация",
      "Жизненный цикл", "SupplyState", "ProductionState", "Дефицит",
      "Непокрытая потребность", "Перезаказ", "Недопоставка",
      "Доступно для производства", "Флаги", "Обновлено", "Дата поставки",
      "Производитель"
    ],
    MATERIAL_STATE: [
      "Material Key", "Артикул", "Наименование", "Модель", "Ед.изм",
      "Складской остаток", "Зарезервировано (контроль)", "Свободно", "Обновлено",
      "Производитель"
    ],
    DEFICIT_SUMMARY: [
      "Position ID", "BOM", "№ п/п", "Артикул", "Производитель", "Наименование",
      "Модель", "Ед.изм", "Дефицит", "Заказано", "Ожидаемая поставка",
      "Крайний срок поставки", "Реальная поставка", "Непокрытая потребность", "Статус"
    ],
    PICKING: [
      "Position ID", "BOM", "№ п/п", "Артикул", "Производитель", "Наименование",
      "Модель", "Ед.изм", "Кол-во", "Доступно для производства", "Состояние поставки",
      "Дата поставки", "Отметка получено"
    ],
    WORKING_BOM: [
      "Position ID", "BOM", "№ п/п", "Артикул", "Производитель", "Наименование",
      "Модель", "Ед.изм", "Кол-во", "Зарезервировано", "Реальная поставка",
      "Доступно для производства", "Передано производству", "ProductionState",
      "Отметка получено", "Обновлено"
    ],
    SUPPLY: [
      "Material Key", "Артикул", "Производитель", "Наименование", "Модель", "Ед.изм",
      "Всего дефицит", "Всего заказано", "Всего поставлено",
      "Проекты"
    ],
    DASHBOARD: [
      "Выполнено", "BOM ID", "BOM", "Статус", "Позиций", "На складе",
      "Ожидается поставка", "Собрано", "Дата создания", "Крайний срок",
      "Недостающие материалы"
    ],
    ARCHIVE: [
      "Дата", "Position ID", "BOM", "№ п/п", "Артикул", "Наименование", "Модель",
      "Ед.изм", "Передано (кол-во)", "Дата передачи", "Кто передал",
      "Источник (UI)", "История", "Производитель"
    ],
    AUDIT_LOG: [
      "Дата", "Operation ID", "Пользователь", "Действие", "BOM ID",
      "Position ID", "Поле", "Старое значение", "Новое значение", "Причина", "Данные"
    ],
    EVENT_LOG: [
      "Дата", "Event ID", "Тип события", "Position ID", "BOM", "Пользователь", "Данные"
    ],
    SYSTEM_LOG: ["Дата", "Функция", "Сообщение", "Уровень", "Данные"],
    MATERIAL_HISTORY: [
      "Дата", "Position ID", "Событие", "Старое значение", "Новое значение",
      "Пользователь", "Комментарий"
    ],
    BOM_REVISION: ["Дата создания", "BOM ID", "Ревизия", "Создал"],
    EXCLUDED_BOMS: ["BOM ID", "Выполнено", "Дата"],
    PENDING_EDITS: [
      "Дата", "Edit ID", "Источник", "Position ID", "Поле",
      "Значение", "Пользователь", "Статус", "Обработано", "Ошибка"
    ]
  },

  /**
   * Состояние снабжения позиции (supplyState) — из ТЗ №85–87.
   */
  SUPPLY_STATE: {
    NO_REQUIREMENT: "NO_REQUIREMENT",
    RESERVED: "RESERVED",
    NOT_ORDERED: "NOT_ORDERED",
    PARTIALLY_ORDERED: "PARTIALLY_ORDERED",
    ORDERED: "ORDERED",
    PARTIALLY_DELIVERED: "PARTIALLY_DELIVERED",
    DELIVERED: "DELIVERED"
  },

  /**
   * Состояние производства (productionState).
   */
  PRODUCTION_STATE: {
    NOT_AVAILABLE: "NOT_AVAILABLE",
    PARTIALLY_AVAILABLE: "PARTIALLY_AVAILABLE",
    READY_FOR_HANDOFF: "READY_FOR_HANDOFF",
    RECEIVED: "RECEIVED"
  },

  /**
   * Жизненный цикл позиции.
   */
  LIFECYCLE_STATE: {
    ACTIVE: "ACTIVE",
    ARCHIVED: "ARCHIVED",
    REMOVED: "REMOVED"
  },

  /**
   * Валидация позиции (по ТЗ №8):
   * обязательны — Строка, Наименование, Модель, Ед.изм, Требуемое, Зарезервировано, Срок;
   * Код — НЕ обязателен.
   */
  VALIDATION_STATUS: {
    VALID: "VALID",
    ERROR: "ERROR"
  },

  /**
   * Флаги позиции (используются в расчётном движке).
   */
  FLAGS: {
    CHANGED: "CHANGED",
    OVER_ORDERED: "OVER_ORDERED",
    SHORT_DELIVERY: "SHORT_DELIVERY"
  },

  /**
   * Статусы BOM в дашборде.
   *
   * Порядок приоритетов (сверху вниз — побеждает первый подходящий):
   *   1) ошибки данных в позициях → «Ошибка данных» (серый, технический статус);
   *   2) все позиции получены производством → «Скомплектован, готов к работе»;
   *   3) все позиции на складе (готовы к отборке), но не все переданы →
   *      «На складе, ждет отборки»;
   *   4) есть незаказанные позиции или позиции без ожидаемой даты →
   *      «Есть незаказанные компоненты»;
   *   5) хотя бы одна поставка позже крайнего срока → «(Опаздывает)»;
   *   6) иначе → «(В срок)».
   */
  BOM_STATUS: {
    ERROR: "Ошибка данных",
    READY: "Скомплектован, готов к работе",
    ON_SHELF: "На складе, ждет отборки",
    NOT_ORDERED: "Есть незаказанные компоненты",
    WAITING_LATE: "Ожидается поставка (Опаздывает)",
    WAITING_ON_TIME: "Ожидается поставка (В срок)"
  },

  /**
   * Роли (из ТЗ №114–117).
   */
  ROLES: {
    ADMIN: "admin",
    ECONOMIST: "economist",
    PROCUREMENT: "procurement",
    WAREHOUSE: "warehouse",
    PRODUCTION: "production",
    VIEWER: "viewer"
  },

  /**
   * Цвета.
   */
  COLORS: {
    RED: "#F4CCCC",
    ORANGE: "#F4B183",
    YELLOW: "#FFF2CC",
    GREEN: "#D9EAD3",
    STOCK: "#9FC5E8",
    RECEIVED: "#B6D7A8",
    READY: "#D9EAD3",
    NO_REQUIREMENT: "#E7E6E6",
    GRAY: "#D9D9D9",
    WHITE: "#FFFFFF"
    // Цвета статусов дашборда — см. BOM_STATUS_COLOR.
  },

  /**
   * Цвет BOM-статуса дашборда (значение — ключ из COLORS).
   */
  BOM_STATUS_COLOR: {
    "Ошибка данных": "GRAY",
    "Скомплектован, готов к работе": "GREEN",
    "На складе, ждет отборки": "STOCK",
    "Есть незаказанные компоненты": "RED",
    "Ожидается поставка (Опаздывает)": "ORANGE",
    "Ожидается поставка (В срок)": "YELLOW"
  },

  /**
   * События (V12) — используются детектором изменений источника.
   */
  EVENTS: {
    POSITION_ADDED: "POSITION_ADDED",
    POSITION_DELETED: "POSITION_DELETED",
    QUANTITY_CHANGED: "QUANTITY_CHANGED",
    RESERVE_CHANGED: "RESERVE_CHANGED",
    DEADLINE_CHANGED: "DEADLINE_CHANGED",
    MATERIAL_CHANGED: "MATERIAL_CHANGED"
  },

  /**
   * Действия аудита.
   */
  AUDIT_ACTIONS: {
    HANDOFF: "PRODUCTION_HANDOFF",
    RETURN_FROM_ARCHIVE: "RETURN_FROM_ARCHIVE",
    ORDERED_CHANGED: "ORDERED_CHANGED",
    EXPECTED_DATE_CHANGED: "EXPECTED_DATE_CHANGED",
    REAL_DELIVERY_CHANGED: "REAL_DELIVERY_CHANGED",
    WAREHOUSE_QTY_CHANGED: "WAREHOUSE_QTY_CHANGED",
    BOM_SYNCED: "BOM_SYNCED",
    MARK_DONE: "MARK_DONE"
  },

  /**
   * Источник интерфейса (sourceUI) для markReceivedByProduction.
   * DASHBOARD — чекбокс «Выполнено» дашборда (поле очереди DASHBOARD_DONE).
   */
  SOURCE_UI: {
    PICKING: "PICKING",
    WORKING_BOM: "WORKING_BOM",
    DEFICIT_SUMMARY: "DEFICIT_SUMMARY",
    DASHBOARD: "DASHBOARD"
  },

  SETTINGS: {
    DATE_FORMAT: "dd.MM.yyyy HH:mm",
    ENABLE_LOGGING: true,
    ENABLE_AUDIT: true,
    LOCK_TIMEOUT: 30000,
    // Очередь намерений PENDING_EDITS (V3).
    //
    // onEdit только ФИКСИРУЕТ намерение, а применение выполняет пользователь
    // кнопкой «✅ Применить изменения» (v12ApplyChanges). Автоприменения
    // (инлайн-слива из onEdit) и периодического фонового слива в модели V3 нет
    // вовсе — соответствующие настройки удалены, чтобы их нельзя было включить
    // «наполовину» и вернуть гонку правки и пересборки проекций.
    QUEUE_PURGE_DONE_DAYS: 30    // сколько дней хранить обработанные строки (аудит)
  },

  /**
   * Фильтр листа ОТБОРКА по коду проекта.
   * Код проекта — буквенно-цифровая первая часть имени BOM до первого дефиса.
   * Значение фильтра хранится прямо в ячейке B1 (строка 1, колонка BOM).
   */
  PICKING_FILTER: {
    CELL_ROW: 1,
    CELL_COL: 2,           // B1 = PICKING_COLUMNS.BOM_NAME
    ALL: "(Все проекты)"   // пункт сброса фильтра
  },

  /**
   * Папка Drive с исходными BOM (источник — только чтение).
   */
  DRIVE: {
    FOLDER_ID: "1Y7YoqpFcZuJ1shnvw3h9sWZFWkNiEZfR",
    ALLOWED_MIME: [
      "application/vnd.google-apps.spreadsheet",
      "text/csv"
    ]
  }
};
