/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 11_Config.gs
 *
 * Центральная конфигурация системы
 *
 * FINAL RELEASE
 *
 * VERSION:
 * 11.1.3
 *
 * =====================================================
 */


const V11_CONFIG = {


VERSION:
"11.1.3",


SCHEMA_VERSION:
"1.2.1",



SYSTEM:{

NAME:
"BOM CONTROL SYSTEM V11",

BUILD_DATE:
"2026-09-06",

ENVIRONMENT:
"PRODUCTION"

},




/**
 * =====================================================
 * Системные состояния
 * =====================================================
 */

SYSTEM_STATE:{


RECALCULATING:
"V11_RECALCULATING",


UPDATING:
"V11_UPDATING",


LOCKED:
"V11_LOCKED",


SAFE_MODE:
"V11_SAFE_MODE",


MAINTENANCE:
"V11_MAINTENANCE"

},




/**
 * =====================================================
 * Листы
 * =====================================================
 */

SHEETS:{


MATERIAL_STATE:
"MATERIAL_STATE",


DEFICIT_SUMMARY:
"Сводка дефицитов",


DASHBOARD:
"Dashboard",


BOM_STATE:
"BOM_STATE",


MATERIAL_HISTORY:
"MATERIAL_HISTORY",


EVENT_LOG:
"EVENT_LOG",


ARCHIVE:
"Архив",


BOM_REVISION:
"BOM_REVISION",


SYSTEM_LOG:
"SYSTEM_LOG"

},




/**
 * =====================================================
 * Количество колонок
 * =====================================================
 */

COLUMN_COUNT:{


MATERIAL_STATE:
21,


DEFICIT_SUMMARY:
11,


BOM_STATE:
6,


BOM_REVISION:
5,


MATERIAL_HISTORY:
7,


EVENT_LOG:
5,


SYSTEM_LOG:
5

},




/**
 * =====================================================
 * MATERIAL STATE
 * =====================================================
 */

MATERIAL_COLUMNS:{


MATERIAL_ID:1,

BOM:2,

BOM_VERSION:3,

BOM_ROW:4,

MATERIAL_CODE:5,

MATERIAL_NAME:6,

UNIT:7,

REQUIRED:8,

RESERVED:9,

ORDERED:10,

DEFICIT:11,

EXPECTED_DATE:12,

DEADLINE_DATE:13,

REAL_DELIVERY:14,

REAL_DELIVERY_DATE:15,

RECEIVED:16,

RECEIVED_DATE:17,

RECEIVED_USER:18,

STATUS:19,

STATE:20,

UPDATED:21

},




/**
 * =====================================================
 * DEFICIT SUMMARY
 * =====================================================
 */

DEFICIT_COLUMNS:{


MATERIAL_ID:1,

BOM:2,

CODE:3,

NAME:4,

REQUIRED:5,

ORDERED:6,

DEFICIT:7,

EXPECTED_DATE:8,

DEADLINE_DATE:9,

REAL_DELIVERY:10,

STATUS:11

},




/**
 * =====================================================
 * BOM STATE
 * =====================================================
 */

BOM_COLUMNS:{


BOM:1,

VERSION:2,

TOTAL_MATERIALS:3,

READY_MATERIALS:4,

STATUS:5,

UPDATED:6

},




/**
 * =====================================================
 * BOM REVISION
 * =====================================================
 */

BOM_REVISION_COLUMNS:{


BOM:1,

VERSION:2,

DATE:3,

USER:4,

COMMENT:5

},




/**
 * =====================================================
 * HISTORY
 * =====================================================
 */

HISTORY_COLUMNS:{


DATE:1,

MATERIAL_ID:2,

EVENT:3,

OLD_VALUE:4,

NEW_VALUE:5,

COMMENT:6,

USER:7

},




/**
 * =====================================================
 * EVENT LOG
 * =====================================================
 */

EVENT_COLUMNS:{


DATE:1,

EVENT_TYPE:2,

MATERIAL_ID:3,

COMMENT:4,

USER:5

},




/**
 * =====================================================
 * SYSTEM LOG
 * =====================================================
 */

SYSTEM_LOG_COLUMNS:{


DATE:1,

FUNCTION:2,

MESSAGE:3,

LEVEL:4,

DATA:5

},




/**
 * =====================================================
 * Заголовки
 * =====================================================
 */

HEADERS:{


MATERIAL_STATE:[

"MaterialID",
"BOM",
"BOM_VERSION",
"BOM_ROW",
"MATERIAL_CODE",
"MATERIAL_NAME",
"UNIT",
"REQUIRED",
"RESERVED",
"ORDERED",
"DEFICIT",
"EXPECTED_DATE",
"DEADLINE_DATE",
"REAL_DELIVERY",
"REAL_DELIVERY_DATE",
"RECEIVED",
"RECEIVED_DATE",
"RECEIVED_USER",
"STATUS",
"STATE",
"UPDATED"

],



DEFICIT_SUMMARY:[

"MaterialID",
"BOM",
"CODE",
"NAME",
"REQUIRED",
"ORDERED",
"DEFICIT",
"EXPECTED_DATE",
"DEADLINE_DATE",
"REAL_DELIVERY",
"STATUS"

],



BOM_STATE:[

"BOM",
"VERSION",
"TOTAL",
"READY",
"STATUS",
"UPDATED"

],



BOM_REVISION:[

"BOM",
"VERSION",
"DATE",
"USER",
"COMMENT"

],



MATERIAL_HISTORY:[

"DATE",
"MATERIAL_ID",
"EVENT",
"OLD_VALUE",
"NEW_VALUE",
"COMMENT",
"USER"

],



EVENT_LOG:[

"DATE",
"EVENT_TYPE",
"MATERIAL_ID",
"COMMENT",
"USER"

],



SYSTEM_LOG:[

"DATE",
"FUNCTION",
"MESSAGE",
"LEVEL",
"DATA"

]

},




/**
 * =====================================================
 * Статусы материалов
 * =====================================================
 */

MATERIAL_STATUS:{


NOT_ORDERED:
"Не заказано",


PARTIAL_ORDER:
"Заказано частично",


ORDERED_ON_TIME:
"Заказано (в срок)",


ORDERED_LATE:
"Заказано (опаздывает)",


STOCK:
"На складе",


RECEIVED:
"Получено производством",


READY:
"Готов",


NO_REQUIREMENT:
"Нет потребности",


ARCHIVED:
"Архив",


REMOVED:
"Удален"

},




/**
 * =====================================================
 * Внутренние состояния
 * =====================================================
 */

MATERIAL_STATE:{


DEFICIT:
"DEFICIT",


PARTIAL_ORDER:
"PARTIAL_ORDER",


WAITING:
"WAITING",


WAITING_LATE:
"WAITING_LATE",


STOCK:
"STOCK",


RECEIVED:
"RECEIVED",


READY:
"READY",


NO_REQUIREMENT:
"NO_REQUIREMENT",


ARCHIVED:
"ARCHIVED",


REMOVED:
"REMOVED"

},




/**
 * =====================================================
 * BOM статусы
 * =====================================================
 */

BOM_STATUS:{


RED:
"🔴 Есть незаказанные материалы",


PARTIAL:
"🟠 Частично заказан",


ORANGE:
"🟠 Просрочка поставки",


YELLOW:
"🟡 Ожидается поставка",


GREEN:
"🟢 Готов к производству"

},




/**
 * =====================================================
 * События
 * =====================================================
 */

EVENTS:{


REAL_DELIVERY_CONFIRMED:
"REAL_DELIVERY_CONFIRMED",


REAL_DELIVERY_CANCELLED:
"REAL_DELIVERY_CANCELLED",


MATERIAL_RECEIVED:
"MATERIAL_RECEIVED",


MATERIAL_RECEIVED_CANCELLED:
"MATERIAL_RECEIVED_CANCELLED",


DELIVERY_DATE_CHANGED:
"DELIVERY_DATE_CHANGED",


STATUS_CHANGED:
"STATUS_CHANGED",


ORDER_CHANGED:
"ORDER_CHANGED",


MATERIAL_ORDERED:
"MATERIAL_ORDERED",


MATERIAL_REMOVED:
"MATERIAL_REMOVED",


BOM_QTY_CHANGED:
"BOM_QTY_CHANGED",


BOM_NAME_CHANGED:
"BOM_NAME_CHANGED",


BOM_MATERIAL_ADDED:
"BOM_MATERIAL_ADDED",


BOM_MATERIAL_REMOVED:
"BOM_MATERIAL_REMOVED",


MATERIAL_ARCHIVED:
"MATERIAL_ARCHIVED",


SYSTEM_ERROR:
"SYSTEM_ERROR",


SYSTEM_RECOVERY:
"SYSTEM_RECOVERY",


SAFE_MODE_ENABLED:
"SAFE_MODE_ENABLED",


SAFE_MODE_DISABLED:
"SAFE_MODE_DISABLED"

},




/**
 * =====================================================
 * Цвета
 * =====================================================
 */

COLORS:{


RED:
"#F4CCCC",


ORANGE:
"#F4B183",


YELLOW:
"#FFF2CC",


GREEN:
"#D9EAD3",


STOCK:
"#9FC5E8",


RECEIVED:
"#B6D7A8",


READY:
"#D9EAD3",


NO_REQUIREMENT:
"#E7E6E6"

},




/**
 * =====================================================
 * Карта цветов
 * =====================================================
 */

STATUS_COLOR_MAP:{


"Не заказано":
"RED",


"Заказано частично":
"RED",


"Заказано (опаздывает)":
"ORANGE",


"Заказано (в срок)":
"YELLOW",


"На складе":
"STOCK",


"Получено производством":
"RECEIVED",


"Готов":
"GREEN",


"Нет потребности":
"NO_REQUIREMENT",


"Архив":
"NO_REQUIREMENT",


"Удален":
"NO_REQUIREMENT"

},




/**
 * =====================================================
 * Ограничения
 * =====================================================
 */

LIMITS:{


MAX_MATERIALS:
10000,


MAX_BOMS:
1000,


MAX_HISTORY_ROWS:
50000

},




DEFAULTS:{


NUMBER:
0,


TEXT:
"",


BOOLEAN:
false,


DATE:
null

},




/**
 * =====================================================
 * Настройки
 * =====================================================
 */

SETTINGS:{


DATE_FORMAT:
"dd.MM.yyyy HH:mm",


ENABLE_LOGGING:
true,


ENABLE_HISTORY:
true,


ENABLE_AUTO_ARCHIVE:
true,


ENABLE_DASHBOARD:
true,


ENABLE_SAFE_MODE:
true,


ENABLE_DEBUG:
false,


LOCK_TIMEOUT:
30000,


CACHE_SECONDS:
300,


ARCHIVE_AFTER_DAYS:
30,


MAX_RECALC_RETRIES:
3

}



};