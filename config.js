/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: config.js
 *
 * Единый источник правды. Все имена листов, колонки,
 * заголовки, статусы, цвета и события — только здесь.
 *
 * Канонические заголовки: РУССКИЕ.
 * =====================================================
 */

const V11_CONFIG = {

  VERSION: "11.3.0",
  SCHEMA_VERSION: "2.1.0",

  SYSTEM: {
    NAME: "BOM CONTROL SYSTEM V11",
    BUILD_DATE: "2026-09-07",
    ENVIRONMENT: "PRODUCTION"
  },

  /**
   * Системные состояния (свойства скрипта)
   */
  SYSTEM_STATE: {
    RECALCULATING: "V11_RECALCULATING",
    UPDATING: "V11_UPDATING",
    LOCKED: "V11_LOCKED",
    SAFE_MODE: "V11_SAFE_MODE",
    MAINTENANCE: "V11_MAINTENANCE"
  },

  /**
   * Листы
   */
  SHEETS: {
    MATERIAL_STATE: "MATERIAL_STATE",
    DEFICIT_SUMMARY: "Сводка дефицитов",
    DASHBOARD: "Dashboard",
    BOM_STATE: "BOM_STATE",
    MATERIAL_HISTORY: "MATERIAL_HISTORY",
    EVENT_LOG: "EVENT_LOG",
    ARCHIVE: "Архив",
    BOM_REVISION: "BOM_REVISION",
    SYSTEM_LOG: "SYSTEM_LOG",
    EXCLUDED_BOMS: "EXCLUDED_BOMS"
  },

  /**
   * Количество колонок
   */
  COLUMN_COUNT: {
    MATERIAL_STATE: 21,
    DEFICIT_SUMMARY: 13,
    BOM_STATE: 11,
    BOM_REVISION: 4,
    MATERIAL_HISTORY: 7,
    EVENT_LOG: 7,
    SYSTEM_LOG: 5,
    DASHBOARD: 11,
    ARCHIVE: 11,
    EXCLUDED_BOMS: 3
  },

  /**
   * MATERIAL_STATE (21)
   */
  MATERIAL_COLUMNS: {
    MATERIAL_ID: 1,
    BOM: 2,
    BOM_VERSION: 3,
    BOM_ROW: 4,
    MATERIAL_CODE: 5,
    MATERIAL_NAME: 6,
    UNIT: 7,
    REQUIRED: 8,
    RESERVED: 9,
    ORDERED: 10,
    DEFICIT: 11,
    EXPECTED_DATE: 12,
    DEADLINE_DATE: 13,
    REAL_DELIVERY: 14,
    REAL_DELIVERY_DATE: 15,
    RECEIVED: 16,
    RECEIVED_DATE: 17,
    RECEIVED_USER: 18,
    STATUS: 19,
    STATE: 20,
    UPDATED: 21
  },

  /**
   * DEFICIT_SUMMARY (13)
   * «Требуется» (кол. 8) = дефицит = BOM.Требуется − Зарезервировано.
   * Это сумма, которую должен заказать снабженец.
   */
  DEFICIT_COLUMNS: {
    RECEIVED: 1,
    MATERIAL_ID: 2,
    BOM: 3,
    ROW: 4,
    CODE: 5,
    NAME: 6,
    UNIT: 7,
    REQUIRED: 8,
    ORDERED: 9,
    EXPECTED_DATE: 10,
    DEADLINE_DATE: 11,
    REAL_DELIVERY: 12,
    STATUS: 13
  },

  /**
   * BOM_STATE (11)
   */
  BOM_COLUMNS: {
    BOM: 1,
    VERSION: 2,
    DATE_CREATED: 3,
    TOTAL_MATERIALS: 4,
    DEFICIT: 5,
    NOT_ORDERED: 6,
    LAST_DELIVERY: 7,
    DEADLINE: 8,
    STATUS: 9,
    READY: 10,
    UPDATED: 11
  },

  /**
   * BOM_REVISION (4)
   */
  BOM_REVISION_COLUMNS: {
    DATE: 1,
    BOM: 2,
    VERSION: 3,
    USER: 4
  },

  /**
   * MATERIAL_HISTORY (7)
   */
  HISTORY_COLUMNS: {
    DATE: 1,
    MATERIAL_ID: 2,
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
    MATERIAL_ID: 4,
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
   * ARCHIVE (11)
   */
  ARCHIVE_COLUMNS: {
    DATE: 1,
    BOM: 2,
    VERSION: 3,
    CODE: 4,
    NAME: 5,
    QTY: 6,
    DELIVERY_DATE: 7,
    RECEIVED_DATE: 8,
    RECEIVED_USER: 9,
    STATE: 10,
    HISTORY: 11
  },

  /**
   * DASHBOARD (11)
   */
  DASHBOARD_COLUMNS: {
    DONE: 1,
    BOM: 2,
    STATUS: 3,
    DATE_CREATED: 4,
    TOTAL_MATERIALS: 5,
    DEFICIT: 6,
    NOT_ORDERED: 7,
    LAST_DELIVERY: 8,
    DEADLINE: 9,
    READY: 10,
    MISSING_ITEMS: 11
  },

  /**
   * Заголовки (канон: русские)
   */
  HEADERS: {
    MATERIAL_STATE: [
      "MaterialID", "BOM", "Версия BOM", "Строка BOM", "Код материала",
      "Наименование", "Ед.изм", "Требуется", "Зарезервировано", "Заказано",
      "Дефицит", "Ожидаемая поставка", "Крайний срок", "Реальная поставка",
      "Дата реальной поставки", "Получено", "Дата получения", "Кто получил",
      "Статус", "State", "Обновлено"
    ],
    DEFICIT_SUMMARY: [
      "Получено", "MaterialID", "BOM", "Строка", "Код", "Наименование",
      "Ед.изм", "Требуется", "Заказано", "Ожидаемая поставка",
      "Крайний срок", "Реальная поставка", "Статус"
    ],
    BOM_STATE: [
      "BOM", "Версия", "Дата создания", "Позиций", "Дефицит", "Незаказано",
      "Последняя поставка", "Крайний срок", "Статус", "Готовность", "Обновлено"
    ],
    BOM_REVISION: ["Дата создания", "BOM", "Версия", "Создал"],
    MATERIAL_HISTORY: [
      "Дата", "MaterialID", "Событие", "Старое значение", "Новое значение",
      "Пользователь", "Комментарий"
    ],
    EVENT_LOG: [
      "Дата", "Event ID", "Тип события", "MaterialID", "BOM", "Пользователь", "Данные"
    ],
    SYSTEM_LOG: ["Дата", "Функция", "Сообщение", "Уровень", "Данные"],
    DASHBOARD: [
      "Выполнено", "BOM", "Статус", "Дата создания", "Позиций", "Дефицит",
      "Незаказано", "Последняя поставка", "Крайний срок", "Готовность",
      "Недостающие позиции"
    ],
    ARCHIVE: [
      "Дата архивации", "BOM", "Версия", "Код материала", "Наименование",
      "Количество", "Дата поставки", "Дата получения", "Кто отметил",
      "Состояние", "История"
    ],
    EXCLUDED_BOMS: ["BOM", "Выполнено", "Дата"]
  },

  /**
   * Статусы материалов
   */
  MATERIAL_STATUS: {
    ERROR: "Ошибка данных",
    NOT_ORDERED: "Не заказано",
    PARTIAL_ORDER: "Заказано частично",
    ORDERED_ON_TIME: "Ожидаем (в срок)",
    ORDERED_LATE: "Ожидаем (опаздывает)",
    DATE_UNKNOWN: "Не указана дата поставки",
    STOCK: "На складе",
    RECEIVED: "Получено производством",
    READY: "Готов",
    NO_REQUIREMENT: "Нет потребности",
    ARCHIVED: "Архив",
    REMOVED: "Удален"
  },

  /**
   * Внутренние состояния материалов
   */
  MATERIAL_STATE: {
    DEFICIT: "DEFICIT",
    PARTIAL_ORDER: "PARTIAL_ORDER",
    WAITING: "WAITING",
    WAITING_LATE: "WAITING_LATE",
    STOCK: "STOCK",
    RECEIVED: "RECEIVED",
    READY: "READY",
    NO_REQUIREMENT: "NO_REQUIREMENT",
    ERROR: "ERROR",
    ARCHIVED: "ARCHIVED",
    REMOVED: "REMOVED"
  },

  /**
   * BOM-статусы (в дашборде/BOM_STATE)
   * «Готов» = все позиции BOM получены производством
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
   * События
   */
  EVENTS: {
    REAL_DELIVERY_CONFIRMED: "REAL_DELIVERY_CONFIRMED",
    REAL_DELIVERY_CANCELLED: "REAL_DELIVERY_CANCELLED",
    MATERIAL_RECEIVED: "MATERIAL_RECEIVED",
    MATERIAL_RECEIVED_CANCELLED: "MATERIAL_RECEIVED_CANCELLED",
    DELIVERY_DATE_CHANGED: "DELIVERY_DATE_CHANGED",
    DEADLINE_DATE_CHANGED: "DEADLINE_DATE_CHANGED",
    STATUS_CHANGED: "STATUS_CHANGED",
    ORDER_CHANGED: "ORDER_CHANGED",
    MATERIAL_ORDERED: "MATERIAL_ORDERED",
    MATERIAL_REMOVED: "MATERIAL_REMOVED",
    BOM_QTY_CHANGED: "BOM_QTY_CHANGED",
    BOM_NAME_CHANGED: "BOM_NAME_CHANGED",
    BOM_MATERIAL_ADDED: "BOM_MATERIAL_ADDED",
    BOM_MATERIAL_REMOVED: "BOM_MATERIAL_REMOVED",
    MATERIAL_ARCHIVED: "MATERIAL_ARCHIVED",
    BOM_IMPORTED: "BOM_IMPORTED",
    SYSTEM_ERROR: "SYSTEM_ERROR",
    SYSTEM_RECOVERY: "SYSTEM_RECOVERY",
    SAFE_MODE_ENABLED: "SAFE_MODE_ENABLED",
    SAFE_MODE_DISABLED: "SAFE_MODE_DISABLED"
  },

  /**
   * Цвета
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
   * Карта цветов для статусов материалов
   */
  STATUS_COLOR_MAP: {
    "Ошибка данных": "GRAY",
    "Не заказано": "RED",
    "Не указана дата поставки": "RED",
    "Заказано частично": "RED",
    "Ожидаем (опаздывает)": "ORANGE",
    "Ожидаем (в срок)": "YELLOW",
    "На складе": "STOCK",
    "Получено производством": "RECEIVED",
    "Готов": "GREEN",
    "Нет потребности": "NO_REQUIREMENT",
    "Архив": "NO_REQUIREMENT",
    "Удален": "NO_REQUIREMENT"
  },

  /**
   * Ограничения
   */
  LIMITS: {
    MAX_MATERIALS: 10000,
    MAX_BOMS: 1000,
    MAX_HISTORY_ROWS: 50000
  },

  DEFAULTS: {
    NUMBER: 0,
    TEXT: "",
    BOOLEAN: false,
    DATE: null
  },

  /**
   * Настройки
   */
  SETTINGS: {
    DATE_FORMAT: "dd.MM.yyyy HH:mm",
    ENABLE_LOGGING: true,
    ENABLE_HISTORY: true,
    ENABLE_AUTO_ARCHIVE: true,
    ENABLE_DASHBOARD: true,
    ENABLE_SAFE_MODE: true,
    ENABLE_DEBUG: false,
    LOCK_TIMEOUT: 30000,
    CACHE_SECONDS: 300,
    ARCHIVE_AFTER_DAYS: 30,
    MAX_RECALC_RETRIES: 3,
    // Производительность: autoResizeColumns на Dashboard — очень медленная операция.
    // Отключаем по умолчанию; включаем только при небольшом числе строк.
    AUTO_RESIZE_DASHBOARD: false,
    AUTO_RESIZE_MAX_ROWS: 100
  },

  /**
   * Импорт BOM из Google Drive
   * FOLDER_ID — заполнить ID папки с актуальными файлами BOM.
   */
  DRIVE: {
    FOLDER_ID: "1Y7YoqpFcZuJ1shnvw3h9sWZFWkNiEZfR",
    ALLOWED_MIME: [
      "application/vnd.google-apps.spreadsheet",
      "text/csv"
    ]
  },

  /**
   * Роли пользователей
   */
  ROLES: {
    ECONOMIST: "economist",
    PROCUREMENT: "procurement",
    MANAGER: "manager",
    STOREKEEPER: "storekeeper"
  }
};
