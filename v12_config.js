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
  SCHEMA_VERSION: "1.0.0",

  SYSTEM: {
    NAME: "BOM CONTROL SYSTEM V12",
    BUILD_DATE: "2026-09-09",
    ENVIRONMENT: "DEVELOPMENT"
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
    EXCLUDED_BOMS: "EXCLUDED_BOMS"
  },

  /**
   * Количество колонок по листам
   */
  COLUMN_COUNT: {
    BOM_REGISTRY: 12,
    POSITION_STATE: 30,
    MATERIAL_STATE: 9,
    DEFICIT_SUMMARY: 15,
    PICKING: 15,
    WORKING_BOM: 14,
    SUPPLY: 13,
    DASHBOARD: 11,
    ARCHIVE: 13,
    AUDIT_LOG: 11,
    EVENT_LOG: 7,
    SYSTEM_LOG: 5,
    MATERIAL_HISTORY: 7,
    BOM_REVISION: 4,
    EXCLUDED_BOMS: 3
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
   * POSITION_STATE (30)
   * Центральное операционное состояние позиции.
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
    UPDATED_AT: 30
  },

  /**
   * MATERIAL_STATE (9) — физический склад, НЕ источник потребности.
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
    UPDATED_AT: 9
  },

  /**
   * DEFICIT_SUMMARY (15) — проекция для снабжения (заказ, даты, поставка).
   * Только позиции с дефицитом > 0. Дефицит (кол. DEFICIT_QTY) = max(0, required − reserved).
   * Порядок: Дефицит, Заказано, Ожидаемая поставка, Крайний срок, Реальная поставка,
   * Поставлено, Непокрытая потребность, Статус. Колонка «Получено» убрана — её отмечают кладовщики в ОТБОРКЕ.
   */
  DEFICIT_COLUMNS: {
    POSITION_ID: 1,
    BOM_NAME: 2,
    BOM_ROW: 3,
    MATERIAL_CODE: 4,
    MATERIAL_NAME: 5,
    MODEL: 6,
    UNIT: 7,
    DEFICIT_QTY: 8,
    ORDERED_QTY: 9,
    EXPECTED_DATE: 10,
    DEADLINE: 11,
    REAL_DELIVERY: 12,
    REAL_DELIVERY_QTY: 13,
    UNCOVERED_NEED: 14,
    STATUS: 15
  },

  /**
   * ОТБОРКА (PICKING) (15) — интерфейс кладовщика/производства.
   */
  PICKING_COLUMNS: {
    POSITION_ID: 1,
    BOM_NAME: 2,
    BOM_ROW: 3,
    MATERIAL_CODE: 4,
    MATERIAL_NAME: 5,
    MODEL: 6,
    UNIT: 7,
    REQUIRED_QTY: 8,
    RESERVED_QTY: 9,
    AVAILABLE_FOR_PRODUCTION: 10,
    WAREHOUSE_QTY: 11,
    PRODUCTION_STATE: 12,
    CHECKBOX: 13,
    RECEIVED_QTY: 14,
    UPDATED_AT: 15
  },

  /**
   * WORKING BOM (14) — периодический документ на BOM (для производства).
   */
  WORKING_BOM_COLUMNS: {
    POSITION_ID: 1,
    BOM_NAME: 2,
    BOM_ROW: 3,
    MATERIAL_CODE: 4,
    MATERIAL_NAME: 5,
    MODEL: 6,
    UNIT: 7,
    REQUIRED_QTY: 8,
    RESERVED_QTY: 9,
    REAL_DELIVERY_QTY: 10,
    AVAILABLE_FOR_PRODUCTION: 11,
    RECEIVED_BY_PRODUCTION_QTY: 12,
    PRODUCTION_STATE: 13,
    UPDATED_AT: 14
  },

  /**
   * СНАБЖЕНИЕ (SUPPLY) (13) — агрегация по materialKey.
   */
  SUPPLY_COLUMNS: {
    MATERIAL_KEY: 1,
    MATERIAL_CODE: 2,
    MATERIAL_NAME: 3,
    MODEL: 4,
    UNIT: 5,
    TOTAL_REQUIRED: 6,
    TOTAL_RESERVED: 7,
    TOTAL_DEFICIT: 8,
    TOTAL_ORDERED: 9,
    TOTAL_REAL_DELIVERY: 10,
    TOTAL_UNCOVERED: 11,
    BOM_COUNT: 12,
    UPDATED_AT: 13
  },

  /**
   * DASHBOARD (11)
   */
  DASHBOARD_COLUMNS: {
    DONE: 1,
    BOM_ID: 2,
    BOM_NAME: 3,
    STATUS: 4,
    TOTAL_POSITIONS: 5,
    COLLECTED_POSITIONS: 6,
    PROGRESS: 7,
    DATE_CREATED: 8,
    DEADLINE: 9,
    MISSING_ITEMS: 10,
    UPDATED_AT: 11
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
    HISTORY: 13
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
   * Заголовки листов (канон: русские).
   */
  HEADERS: {
    BOM_REGISTRY: [
      "BOM ID", "Source Spreadsheet ID", "Source Sheet", "Working Spreadsheet ID",
      "BOM Name", "Активен", "Выполнено", "Ревизия источника", "Hash",
      "Последняя синхронизация", "Dirty", "Обновлено"
    ],
    POSITION_STATE: [
      "Position ID", "BOM ID", "Ревизия", "BOM", "Строка", "Код", "Наименование",
      "Модель", "Ед.изм", "Требуется", "Зарезервировано", "Заказано", "Поставлено",
      "Ожидаемая поставка", "Крайний срок", "Передано производству (кол-во)",
      "Передано производству", "Дата передачи", "Кто передал", "Валидация",
      "Жизненный цикл", "SupplyState", "ProductionState", "Дефицит",
      "Непокрытая потребность", "Перезаказ", "Недопоставка",
      "Доступно для производства", "Флаги", "Обновлено"
    ],
    MATERIAL_STATE: [
      "Material Key", "Код", "Наименование", "Модель", "Ед.изм",
      "Складской остаток", "Зарезервировано (контроль)", "Свободно", "Обновлено"
    ],
    DEFICIT_SUMMARY: [
      "Position ID", "BOM", "Строка", "Код", "Наименование", "Модель", "Ед.изм",
      "Дефицит", "Заказано", "Ожидаемая поставка", "Крайний срок", "Реальная поставка",
      "Поставлено", "Непокрытая потребность", "Статус"
    ],
    PICKING: [
      "Position ID", "BOM", "Строка", "Код", "Наименование", "Модель", "Ед.изм",
      "Требуется", "Зарезервировано", "Доступно для производства",
      "Складской остаток", "ProductionState", "Отметка получено",
      "Передано (кол-во)", "Обновлено"
    ],
    WORKING_BOM: [
      "Position ID", "BOM", "Строка", "Код", "Наименование", "Модель", "Ед.изм",
      "Требуется", "Зарезервировано", "Поставлено", "Доступно для производства",
      "Передано производству", "ProductionState", "Обновлено"
    ],
    SUPPLY: [
      "Material Key", "Код", "Наименование", "Модель", "Ед.изм",
      "Всего требуется", "Всего зарезервировано", "Всего дефицит",
      "Всего заказано", "Всего поставлено", "Всего непокрыто",
      "BOM (кол-во)", "Обновлено"
    ],
    DASHBOARD: [
      "Выполнено", "BOM ID", "BOM", "Статус", "Позиций", "Собрано",
      "Прогресс", "Дата создания", "Крайний срок", "Недостающие позиции", "Обновлено"
    ],
    ARCHIVE: [
      "Дата", "Position ID", "BOM", "Строка", "Код", "Наименование", "Модель",
      "Ед.изм", "Передано (кол-во)", "Дата передачи", "Кто передал",
      "Источник (UI)", "История"
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
    EXCLUDED_BOMS: ["BOM ID", "Выполнено", "Дата"]
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
    RETURNED: "RETURNED",
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
   * Флаги позиции (из ТЗ №15–23, №113).
   */
  FLAGS: {
    NORMAL: "NORMAL",
    CHANGED: "CHANGED",
    QUANTITY_CHANGED: "QUANTITY_CHANGED",
    RESERVE_CHANGED: "RESERVE_CHANGED",
    DEADLINE_CHANGED: "DEADLINE_CHANGED",
    MATERIAL_CHANGED: "MATERIAL_CHANGED",
    MATERIAL_REPLACED: "MATERIAL_REPLACED",
    POSITION_ADDED: "POSITION_ADDED",
    POSITION_DELETED: "POSITION_DELETED",
    OVER_ORDERED: "OVER_ORDERED",
    SHORT_DELIVERY: "SHORT_DELIVERY",
    RESERVATION_PHYSICAL_INCONSISTENCY: "RESERVATION_PHYSICAL_INCONSISTENCY"
  },

  /**
   * Статусы BOM в дашборде (из ТЗ №47).
   */
  BOM_STATUS: {
    NOT_PROCESSED: "Не обработан",
    PARTIAL_SELECTED: "Частично отобран",
    WAITING_ON_TIME: "Ожидание поставки (в срок)",
    WAITING_LATE: "Ожидание поставки (опаздывает)",
    READY: "Готов к производству",
    ERROR: "Ошибка данных"
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
  },

  /**
   * Цвет supplyState.
   */
  SUPPLY_COLOR: {
    "NO_REQUIREMENT": "NO_REQUIREMENT",
    "RESERVED": "GREEN",
    "NOT_ORDERED": "RED",
    "PARTIALLY_ORDERED": "ORANGE",
    "ORDERED": "YELLOW",
    "PARTIALLY_DELIVERED": "STOCK",
    "DELIVERED": "RECEIVED"
  },

  /**
   * Цвет productionState.
   */
  PRODUCTION_COLOR: {
    "NOT_AVAILABLE": "RED",
    "PARTIALLY_AVAILABLE": "ORANGE",
    "READY_FOR_HANDOFF": "GREEN",
    "RECEIVED": "RECEIVED"
  },

  /**
   * Цвет BOM-статуса дашборда.
   */
  BOM_STATUS_COLOR: {
    "Не обработан": "RED",
    "Частично отобран": "ORANGE",
    "Ожидание поставки (в срок)": "YELLOW",
    "Ожидание поставки (опаздывает)": "ORANGE",
    "Готов к производству": "READY",
    "Ошибка данных": "GRAY"
  },

  /**
   * События (V12).
   */
  EVENTS: {
    BOM_SYNCED: "BOM_SYNCED",
    POSITION_ADDED: "POSITION_ADDED",
    POSITION_DELETED: "POSITION_DELETED",
    QUANTITY_CHANGED: "QUANTITY_CHANGED",
    RESERVE_CHANGED: "RESERVE_CHANGED",
    DEADLINE_CHANGED: "DEADLINE_CHANGED",
    MATERIAL_CHANGED: "MATERIAL_CHANGED",
    MATERIAL_REPLACED: "MATERIAL_REPLACED",
    ORDERED_CHANGED: "ORDERED_CHANGED",
    EXPECTED_DATE_CHANGED: "EXPECTED_DATE_CHANGED",
    REAL_DELIVERY_CHANGED: "REAL_DELIVERY_CHANGED",
    PRODUCTION_HANDOFF: "PRODUCTION_HANDOFF",
    RETURN_FROM_ARCHIVE: "RETURN_FROM_ARCHIVE",
    WAREHOUSE_QTY_CHANGED: "WAREHOUSE_QTY_CHANGED",
    SYSTEM_ERROR: "SYSTEM_ERROR"
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
   */
  SOURCE_UI: {
    PICKING: "PICKING",
    WORKING_BOM: "WORKING_BOM"
  },

  /**
   * Пределы и настройки.
   */
  LIMITS: {
    MAX_POSITIONS: 100000,
    MAX_BOMS: 2000
  },

  SETTINGS: {
    DATE_FORMAT: "dd.MM.yyyy HH:mm",
    ENABLE_LOGGING: true,
    ENABLE_AUDIT: true,
    ENABLE_HISTORY: true,
    ENABLE_AUTO_WORKING_BOM: true,
    LOCK_TIMEOUT: 30000,
    AUTO_RESIZE_DASHBOARD: false,
    AUTO_RESIZE_MAX_ROWS: 100,
    LOG_BUFFER_THRESHOLD: 50
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
