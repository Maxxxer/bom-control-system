/**
 * Базовые типы предметной области BOM CONTROL SYSTEM.
 *
 * Здесь только «словарь» системы: состояния позиции, статусы BOM, роли и
 * структуры, которыми обмениваются чистые функции расчёта. Никаких обращений
 * к базе или HTTP — слой полностью детерминирован и тестируется отдельно.
 */

/** Состояние обеспечения позиции (порт `V12_CONFIG.SUPPLY_STATE`). */
export type SupplyState =
  | 'NO_REQUIREMENT'
  | 'RESERVED'
  | 'NOT_ORDERED'
  | 'PARTIALLY_ORDERED'
  | 'ORDERED'
  | 'PARTIALLY_DELIVERED'
  | 'DELIVERED';

/** Состояние готовности позиции к производству (`V12_CONFIG.PRODUCTION_STATE`). */
export type ProductionState =
  | 'NOT_AVAILABLE'
  | 'PARTIALLY_AVAILABLE'
  | 'READY_FOR_HANDOFF'
  | 'RECEIVED';

/** Жизненный цикл позиции (`V12_CONFIG.LIFECYCLE_STATE`). */
export type LifecycleState = 'ACTIVE' | 'ARCHIVED' | 'REMOVED';

/** Результат валидации обязательных полей BOM. */
export type ValidationState = 'VALID' | 'ERROR';

/** Флаги позиции, используемые в расчёте (`V12_CONFIG.FLAGS`). */
export type PositionFlag = 'CHANGED' | 'OVER_ORDERED' | 'SHORT_DELIVERY';

/** Статус BOM на дашборде (`V12_CONFIG.BOM_STATUS`). */
export type BomStatus =
  | 'ERROR'
  | 'READY'
  | 'ON_SHELF'
  | 'NOT_ORDERED'
  | 'WAITING_LATE'
  | 'WAITING_ON_TIME';

/** Исход снабжения позиции (единый для сводки и статуса BOM). */
export type ProcurementOutcome = 'NOT_ORDERED' | 'PARTIAL' | 'ON_TIME' | 'LATE';

/** Роли (`V12_CONFIG.ROLES`). */
export type Role =
  | 'admin'
  | 'economist'
  | 'procurement'
  | 'warehouse'
  | 'production'
  | 'viewer';

/**
 * Описательные (неизменяемые из интерфейса) поля позиции: приходят из исходной
 * спецификации BOM и служат и для отображения, и для валидации.
 *
 * `deadline` — ISO-строка `YYYY-MM-DD` либо null (пустой срок = ошибка данных).
 */
export interface PositionIdentity {
  rowNo: number;
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
  deadline: string | null;
}

/** Количественные поля позиции: вход расчёта и предмет правок ролей. */
export interface PositionQuantities {
  requiredQty: number;
  reservedQty: number;
  orderedQty: number;
  realDeliveryQty: number;
  receivedQty: number;
  received: boolean;
}

/** Вход чистого расчёта состояния позиции. */
export interface CalculationInput extends PositionQuantities {
  identity: PositionIdentity;
}

/** Какие обязательные поля не заполнены (для сообщения «Ошибка данных»). */
export interface ValidationMissing {
  rowNo: boolean;
  name: boolean;
  model: boolean;
  unit: boolean;
  requiredQty: boolean;
  deadline: boolean;
}

/** Результат валидации позиции по требованиям к BOM. */
export interface ValidationResult {
  valid: boolean;
  missing: ValidationMissing;
}

/**
 * Результат расчёта. Все производные величины — вычисляемые: они не хранятся
 * как самостоятельная истина, а пересчитываются из количеств позиции.
 */
export interface CalculationResult {
  deficitQty: number;
  uncoveredNeed: number;
  overOrderedQty: number;
  shortDeliveryQty: number;
  availableForProduction: number;
  readyForHandoff: boolean;
  supplyState: SupplyState;
  productionState: ProductionState;
  flags: PositionFlag[];
  valid: boolean;
  missing: ValidationMissing;
}

/** Поля позиции, которые нужны для определения исхода снабжения. */
export interface ProcurementRow {
  orderedQty: number;
  deficitQty: number;
  expectedDate: string | null;
  deadline: string | null;
}
