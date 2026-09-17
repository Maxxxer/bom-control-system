/**
 * =====================================================
 * BOM CONTROL SYSTEM V12 — ЛИЧНЫЙ ФАЙЛ ОТБОРЩИКА (САТЕЛЛИТ)
 *
 * FILE: sat_config.js
 *
 * ЭТОТ ФАЙЛ — ЧАСТЬ ОТДЕЛЬНОГО СКРИПТА, привязанного к ЛИЧНОЙ таблице
 * отборщика. Он НЕ разворачивается в мастер-проект (см. .claspignore: _satellite/).
 *
 * ЗАЧЕМ. В мастере ОТБОРКА — один общий лист и один фильтр проекта в B1 на всех.
 * Двое отборщиков не могут работать одновременно: смена фильтра одним стирает
 * работу другого, а пересборка проекций сбрасывает чужие неприменённые галочки.
 * Поэтому каждый отборщик работает в СВОЁМ файле: у него свой фильтр, свои
 * галочки и своя кнопка «ПРИМЕНИТЬ». Мастер получает только готовый лот
 * (список отмеченных позиций) и применяет его целиком.
 *
 * ДАННЫЕ НЕ ДУБЛИРУЮТСЯ НАВСЕГДА: лист отборщика — витрина. Он наполняется
 * от мастера кнопкой «ОБНОВИТЬ» (satRefresh) и нажатием кнопки один раз при
 * открытии файла.
 * =====================================================
 */

const SAT_CONFIG = {

  VERSION: "13.0.0",

  SYSTEM_NAME: "BOM CONTROL V12 — файл отборщика",

  /** Имя листа-витрины в личном файле отборщика. */
  SHEET_NAME: "ОТБОРКА",

  /**
   * Колонки витрины. СОЗНАТЕЛЬНО совпадают с колонками мастерского листа
   * ОТБОРКА (v12_config.js -> PICKING_COLUMNS): отборщик видит ту же таблицу,
   * что и раньше, и не переучивается.
   */
  COLUMNS: {
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
    DELIVERY_DATE: 12,
    CHECKBOX: 13
  },

  /** Всего колонок витрины. */
  COLUMN_COUNT: 13,

  /** Первая строка данных (строка 1 — заголовки). */
  FIRST_DATA_ROW: 2,

  /**
   * Фильтр проекта — ровно как в мастере: ячейка B1 (строка 1, колонка 2).
   * Никаких скрытых листов настроек: отборщик видит фильтр там, где привык.
   */
  FILTER: {
    ROW: 1,
    COL: 2,
    ALL: "(Все проекты)"
  },

  /**
   * Свойства скрипта (Script Properties) личного файла отборщика.
   *
   * Хранить адрес мастера, секрет и адрес отборщика в КОДЕ нельзя: код
   * копируется всем, а секрет — общий на всех. Поэтому всё в свойствах скрипта,
   * которые заполняются установкой (satInstall) и не попадают в репозиторий.
   *
   * Совет: после настройки защитите свойства файла — доступ к таблице у одного
   * человека, доступ к скрипту тоже.
   */
  PROP: {
    MASTER_URL: "SAT_MASTER_URL",       // URL веб-приложения мастера
    TOKEN: "SAT_TOKEN",                 // общий секрет транспорта
    ACTOR: "SAT_ACTOR",                 // e-mail отборщика (проверяется мастером)
    PROJECT: "SAT_PROJECT",             // выбранный проект (дублирует B1)
    SPREADSHEET_ID: "SAT_SPREADSHEET_ID" // id личного файла (для журнала мастера)
  },

  /** Действия веб-API мастера (см. v12_config.js -> WEB_ACTIONS). */
  ACTIONS: {
    ROWS: "rows",
    SUBMIT: "submit",
    STATUS: "status",
    CLAIM: "claim",
    RELEASE: "release",
    PICKERS: "pickers"
  },

  /** Статусы лота от мастер (v12_config.js -> PICKING_BATCH_STATUS). */
  BATCH_STATUS: {
    PENDING: "PENDING",
    APPLIED: "APPLIED",
    PARTIAL: "PARTIAL",
    FAILED: "FAILED"
  },

  /** Человеческие подписи статусов лота. */
  BATCH_STATUS_LABEL: {
    PENDING: "в обработке",
    APPLIED: "применён",
    PARTIAL: "применён частично",
    FAILED: "не применён"
  },

  /** Подписи исходов позиций лота (v12_config.js -> BATCH_ITEM_ERROR). */
  ITEM_ERROR_LABEL: {
    ALREADY: "уже передано производству",
    STALE: "позиция исчезла — обновите список"
  },

  /**
   * Палитра — копия V12_CONFIG.COLORS. Копия, а не ссылка: сателлит живёт в
   * отдельном проекте и не может импортировать код мастера. Значения совпадают
   * с мастером, поэтому цвет строки в личном файле и в мастере одинаковый.
   */
  COLORS: {
    RED: "#F4CCCC",
    ORANGE: "#F4B183",
    YELLOW: "#FFF2CC",
    STOCK: "#9FC5E8",
    GRAY: "#D9D9D9",
    WHITE: "#FFFFFF"
  },

  /** Цвет предупреждения «проект уже отбирает другой» в строке 1. */
  WARN_COLOR: "#F4CCCC",
  OK_COLOR: "#D9EAD3",

  /** Параметры сети. */
  HTTP: {
    // Мастеру может потребоваться время: приём лота пишет намерения и
    // пересобирает проекции. 60 с — потолок UrlFetchApp.
    TIMEOUT_SECONDS: 60,
    MAX_RETRIES: 2,
    RETRY_DELAY_MS: 1500
  },

  /** UI. */
  UI: {
    TOAST_TITLE: "BOM CONTROL — отбор",
    TOAST_SECONDS: 4,
    TOAST_SECONDS_ERROR: 10,
    BUTTON_SCRIPT: "satSubmit",
    BUTTON_LABEL: "ПРИМЕНИТЬ",
    BUTTON_ALT: "Отправить отмеченные позиции мастеру (одним лотом)"
  },

  /**
   * PNG-кнопки «ПРИМЕНИТЬ» — та же картинка, что в мастере (v12_ui.js):
   * зелёная со скруглением, белый текст, 124x20. Отборщик видит ту же кнопку,
   * что и на мастерском листе.
   */
  BUTTON_PNG_BASE64:
    "iVBORw0KGgoAAAANSUhEUgAAAHwAAAAUCAYAAABPuVmJAAAAx0lEQVR42u2ayw2AIAxA2cG7IziEA7iK+5/0ogkeCOVTsPCa9KA0UvpMLRbnHlmO7ULHVee" +
    "LP7CeOzqYfqADei7wIuBSkdqHnh+bv9Q+1X8r/iQDjxkCfFLg2gHIDZj0vjQw2v7XHgc4wG0ClwJMvW613tinDOAAtw08t2grBVjLn9yiSivlS/0HOMD7pv" +
    "TU1KddFNZ+wVsXbdL1ARzgfYH32vZZ35YBHOAA/9OvVYo2gLcFTnt0ovbo2xMnIONr8NQLOu4RpxuYfQiD8ON7kQAAAABJRU5ErkJggg=="
};

/**
 * Ключ кэша выбранного проекта (для onEdit простого триггера, где нельзя
 * читать свойства — см. sat_onEdit в sat_menu.js).
 */
const SAT_PROJECT_CACHE_KEY = "sat_project";

/**
 * Подпись статуса лота по-русски.
 */
function satBatchStatusLabel(status) {
  return SAT_CONFIG.BATCH_STATUS_LABEL[status] || status || "";
}

/**
 * Подпись исхода позиции лота по-русски.
 */
function satItemErrorLabel(code) {
  return SAT_CONFIG.ITEM_ERROR_LABEL[code] || code || "";
}

/**
 * Заголовки витрины — совпадают с мастерским листом ОТБОРКА.
 */
function satHeaders() {
  return [
    "Position ID", "BOM", "№ п/п", "Артикул", "Производитель", "Наименование",
    "Модель", "Ед.изм", "Кол-во", "Доступно для производства", "Состояние поставки",
    "Дата поставки", "Отметка получено"
  ];
}
