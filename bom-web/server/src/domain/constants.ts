/**
 * Константы предметной области: состояния, статусы, подписи, цвета, роли и
 * матрица прав. Порт `V12_CONFIG` (листовая схема заменена реляционной, поэтому
 * номера колонок здесь не нужны — нужны сами значения и подписи).
 */

import type {
  BomStatus,
  LifecycleState,
  PositionFlag,
  ProcurementOutcome,
  ProductionState,
  Role,
  SupplyState,
  ValidationState,
} from './types.js';

export const SUPPLY_STATE = {
  NO_REQUIREMENT: 'NO_REQUIREMENT',
  RESERVED: 'RESERVED',
  NOT_ORDERED: 'NOT_ORDERED',
  PARTIALLY_ORDERED: 'PARTIALLY_ORDERED',
  ORDERED: 'ORDERED',
  PARTIALLY_DELIVERED: 'PARTIALLY_DELIVERED',
  DELIVERED: 'DELIVERED',
} as const satisfies Record<string, SupplyState>;

export const PRODUCTION_STATE = {
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  PARTIALLY_AVAILABLE: 'PARTIALLY_AVAILABLE',
  READY_FOR_HANDOFF: 'READY_FOR_HANDOFF',
  RECEIVED: 'RECEIVED',
} as const satisfies Record<string, ProductionState>;

export const LIFECYCLE_STATE = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  REMOVED: 'REMOVED',
} as const satisfies Record<string, LifecycleState>;

export const VALIDATION_STATE = {
  VALID: 'VALID',
  ERROR: 'ERROR',
} as const satisfies Record<string, ValidationState>;

export const FLAGS = {
  CHANGED: 'CHANGED',
  OVER_ORDERED: 'OVER_ORDERED',
  SHORT_DELIVERY: 'SHORT_DELIVERY',
} as const satisfies Record<string, PositionFlag>;

export const BOM_STATUS = {
  ERROR: 'ERROR',
  READY: 'READY',
  ON_SHELF: 'ON_SHELF',
  NOT_ORDERED: 'NOT_ORDERED',
  WAITING_LATE: 'WAITING_LATE',
  WAITING_ON_TIME: 'WAITING_ON_TIME',
} as const satisfies Record<string, BomStatus>;

/** Человекочитаемые подписи статуса BOM (как в прежней системе). */
export const BOM_STATUS_LABEL: Record<BomStatus, string> = {
  ERROR: 'Ошибка данных',
  READY: 'Скомплектован, готов к работе',
  ON_SHELF: 'На складе, ждет отборки',
  NOT_ORDERED: 'Есть незаказанные компоненты',
  WAITING_LATE: 'Ожидается поставка (Опаздывает)',
  WAITING_ON_TIME: 'Ожидается поставка (В срок)',
};

/** Подписи состояния обеспечения позиции. */
export const SUPPLY_STATE_LABEL: Record<SupplyState, string> = {
  NO_REQUIREMENT: 'Потребности нет',
  RESERVED: 'Закрыто резервом',
  NOT_ORDERED: 'Не заказано',
  PARTIALLY_ORDERED: 'Заказано частично',
  ORDERED: 'Заказано',
  PARTIALLY_DELIVERED: 'Поставлено частично',
  DELIVERED: 'Поставлено',
};

/** Подписи состояния производства. */
export const PRODUCTION_STATE_LABEL: Record<ProductionState, string> = {
  NOT_AVAILABLE: 'Нет в наличии',
  PARTIALLY_AVAILABLE: 'Частично доступно',
  READY_FOR_HANDOFF: 'На складе',
  RECEIVED: 'Передано',
};

/** Подписи жизненного цикла позиции. */
export const LIFECYCLE_STATE_LABEL: Record<LifecycleState, string> = {
  ACTIVE: 'Активна',
  ARCHIVED: 'В производстве',
  REMOVED: 'Удалена',
};

/** Подписи исхода снабжения (используются в подсказках дашборда). */
export const PROCUREMENT_OUTCOME_LABEL: Record<ProcurementOutcome, string> = {
  NOT_ORDERED: 'Не заказано',
  PARTIAL: 'Заказано частично',
  ON_TIME: 'Ожидается поставка (в срок)',
  LATE: 'Ожидается поставка (опаздывает)',
};

/**
 * Цвета строк.
 *
 * Названия и смысл те же, что в прежней системе, и на них ссылается регламент
 * работы (REGULATIONS.md: красный — «не заказано», оранжевый — «опаздывает»,
 * жёлтый — «в срок», голубой — «готово к передаче»). Оттенки приведены к
 * фирменной палитре MAIR: они такие же по тону, но спокойнее, чтобы рядом с
 * тёмно-синей шапкой и оранжевыми акцентами таблица читалась, а не пестрила.
 *
 * Эти же значения повторены в интерфейсе токенами `--row-*`
 * (`web/src/styles/tokens.css`) — менять их нужно парой.
 */
export const COLORS = {
  RED: '#F6DBD8',
  ORANGE: '#F7DCC2',
  YELLOW: '#FBEECB',
  GREEN: '#D9EBDE',
  STOCK: '#CFE3F5',
  RECEIVED: '#C9E5D0',
  GRAY: '#E3E4E8',
  WHITE: '#FFFFFF',
} as const;

/** Цвет статуса BOM. */
export const BOM_STATUS_COLOR: Record<BomStatus, string> = {
  ERROR: COLORS.GRAY,
  READY: COLORS.GREEN,
  ON_SHELF: COLORS.STOCK,
  NOT_ORDERED: COLORS.RED,
  WAITING_LATE: COLORS.ORANGE,
  WAITING_ON_TIME: COLORS.YELLOW,
};

/**
 * Статус строки «Сводки дефицитов» (текст как в прежней системе, чтобы
 * пользователи видели привычные формулировки).
 */
export const DEFICIT_STATUS = {
  ERROR: 'Ошибка данных',
  NOT_ORDERED: 'Не заказано',
  PARTIAL: 'Заказано частично',
  ON_TIME: 'Ожидание поставки (в Срок)',
  LATE: 'Ожидание поставки (Опаздывает)',
} as const;

/** Действия, на которые проверяются права (аналог ключей `v12CanEditField`). */
export type PermissionAction =
  | 'SOURCE_BOM_WRITE'
  | 'DEADLINE'
  | 'REAL_DELIVERY'
  | 'ORDERED_QTY'
  | 'EXPECTED_DATE'
  | 'WAREHOUSE_QTY'
  | 'PICKING_CHECKBOX'
  | 'WORKING_BOM_CHECKBOX'
  | 'DASHBOARD_CHECKBOX'
  | 'USER_ADMIN';

export const ROLES = {
  ADMIN: 'admin',
  ECONOMIST: 'economist',
  PROCUREMENT: 'procurement',
  WAREHOUSE: 'warehouse',
  PRODUCTION: 'production',
  VIEWER: 'viewer',
} as const satisfies Record<string, Role>;

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Администратор',
  economist: 'Экономист',
  procurement: 'Снабженец',
  warehouse: 'Кладовщик',
  production: 'Производство',
  viewer: 'Наблюдатель',
};

/** Все роли в порядке отображения в админке. */
export const ROLE_LIST: Role[] = [
  'admin',
  'economist',
  'procurement',
  'warehouse',
  'production',
  'viewer',
];

/**
 * Матрица прав: роль → разрешённые действия. Роль без прав (viewer) получает
 * пустой список; администратор — всё (`*`).
 */
/** Административная «звёздочка»: роль имеет все права без перечисления. */
export const PERMISSION_WILDCARD = '*';

export const ROLE_PERMISSIONS: Record<
  Role,
  readonly (PermissionAction | typeof PERMISSION_WILDCARD)[]
> = {
  admin: [PERMISSION_WILDCARD],
  economist: ['SOURCE_BOM_WRITE', 'DEADLINE', 'REAL_DELIVERY'],
  procurement: ['ORDERED_QTY', 'EXPECTED_DATE'],
  warehouse: ['WAREHOUSE_QTY', 'PICKING_CHECKBOX'],
  production: ['PICKING_CHECKBOX', 'WORKING_BOM_CHECKBOX', 'DASHBOARD_CHECKBOX'],
  viewer: [],
};

/** Человекочитаемая подпись права (для экрана «Мой доступ» и отказов). */
export const PERMISSION_LABEL: Record<PermissionAction, string> = {
  SOURCE_BOM_WRITE: 'Спецификации BOM (создание, импорт, правка)',
  DEADLINE: '«Крайний срок поставки» в спецификации',
  REAL_DELIVERY: 'галочка «Реальная поставка» в сводке дефицитов',
  ORDERED_QTY: '«Заказано» в сводке дефицитов',
  EXPECTED_DATE: '«Ожидаемая поставка» в сводке дефицитов',
  WAREHOUSE_QTY: '«Складской остаток»',
  PICKING_CHECKBOX: 'передача материала производству (отборка)',
  WORKING_BOM_CHECKBOX: 'передача материала из WORKING BOM',
  DASHBOARD_CHECKBOX: 'галочка «Выполнено» на дашборде',
  USER_ADMIN: 'управление пользователями и доступами',
};

/** Ограничения, защищающие сервер от чрезмерных запросов. */
export const LIMITS = {
  /** Максимальный размер загружаемого файла спецификации (байт). */
  MAX_IMPORT_BYTES: 5 * 1024 * 1024,
  /** Максимальное число строк в одном импорте. */
  MAX_IMPORT_ROWS: 20_000,
  /**
   * Максимальное число значений в одной команде массовой правки.
   *
   * Зачем ограничение. Массовая правка (вставка блока ячеек из Excel) выполняется
   * ОДНОЙ транзакцией: так вся команда либо применяется, либо нет, и в журнале
   * действий появляется один идентификатор операции вместо сотен. Встроенная база
   * (`PGlite`) однопоточная, поэтому очень большая транзакция держит блокировку и
   * мешает остальным пользователям. Тысяча значений — это, например, 25 строк по
   * всем полям карточки спецификации: больше осмысленной работы за одну вставку
   * не бывает.
   */
  MAX_BULK_CHANGES: 1_000,
  /** Максимальная длина строкового поля, приходящего из интерфейса. */
  MAX_TEXT_LENGTH: 500,
  /** Максимальное количество BOM, отдаваемых одним списком. */
  MAX_LIST_LIMIT: 500,
} as const;

/** Параметры сессий (локальные логины). */
export const SESSION = {
  COOKIE_NAME: 'bom_sid',
  /** Срок жизни сессии, дней. */
  TTL_DAYS: 14,
  /** Минимальная длина пароля. */
  MIN_PASSWORD_LENGTH: 8,
} as const;
/**
 * Откуда пришла отметка «передано производству».
 *
 * Значения совпадают с названиями рабочих экранов прежней системы и попадают в
 * архив как есть: по записи архива сразу видно, из какого экрана передали
 * материал.
 */
export const SOURCE_UI = {
  PICKING: 'ОТБОРКА',
  WORKING_BOM: 'WORKING BOM',
} as const;

/** Подписи источников отметки для интерфейса. */
export const SOURCE_UI_LABEL: Record<string, string> = {
  [SOURCE_UI.PICKING]: 'Отборка',
  [SOURCE_UI.WORKING_BOM]: 'WORKING BOM',
};
