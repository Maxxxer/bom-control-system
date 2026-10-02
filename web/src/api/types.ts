/**
 * Контракт данных между интерфейсом и сервером.
 *
 * Типы повторяют то, что реально отдаёт API. Строки витрин описаны ИМЕНОВАННЫМИ
 * полями (как и на сервере), поэтому порядок колонок в таблице задаётся
 * интерфейсом, а не сервером.
 *
 * Даты во всех ответах — строки вида `ГГГГ-ММ-ДД` либо `null`; отметки времени
 * (когда именно нажали кнопку) приходят в формате ISO с временем.
 */

export type Role = 'admin' | 'economist' | 'procurement' | 'warehouse' | 'production' | 'viewer';

/** Пользователь в текущей сессии: роль и её права. */
export interface SessionUser {
  id: number;
  login: string;
  fullName: string;
  role: Role;
  roleLabel: string;
  permissions: string[];
}

/** Итог операции: применено, уже так, или запрещено правилами. */
export type OperationStatus = 'applied' | 'already' | 'blocked';

/** Какие обязательные поля позиции не заполнены (причина «Ошибки данных»). */
export interface PositionMissingFields {
  rowNo: boolean;
  name: boolean;
  model: boolean;
  unit: boolean;
  requiredQty: boolean;
  deadline: boolean;
}

/** Позиция в полном виде (как её отдаёт сервер). */
export interface PositionDto {
  id: number;
  positionId: string;
  bomId: string;
  bomName: string;
  materialKey: string;
  identity: {
    rowNo: number;
    code: string;
    manufacturer: string;
    name: string;
    model: string;
    unit: string;
    deadline: string | null;
  };
  quantities: {
    requiredQty: number;
    reservedQty: number;
    orderedQty: number;
    realDeliveryQty: number;
    receivedQty: number;
    received: boolean;
  };
  expectedDate: string | null;
  realDeliveryDate: string | null;
  receivedAt: string | null;
  receivedBy: string;
  lifecycle: 'ACTIVE' | 'ARCHIVED' | 'REMOVED';
  updatedAt: string;
  computed: {
    deficitQty: number;
    uncoveredNeed: number;
    overOrderedQty: number;
    shortDeliveryQty: number;
    availableForProduction: number;
    readyForHandoff: boolean;
    supplyState: string;
    productionState: string;
    flags: string[];
    valid: boolean;
    /** Незаполненные обязательные поля: показываются прямо в строке. */
    missing: PositionMissingFields;
  };
}

/** Ответ на операцию по позиции. */
export interface OperationReply {
  status: OperationStatus;
  reason: string;
  /** Пояснение к применённому изменению (например, о ключе материала). */
  notice: string;
  position: PositionDto | null;
}

/** Запись «недостающий материал» в дашборде. */
export interface MissingEntry {
  qty: number;
  model: string;
  code: string;
  name: string;
  manufacturer: string;
  expectedDate: string | null;
}

/** Запись «материал на складе, ждёт отборки». */
export interface ShelfEntry {
  qty: number;
  model: string;
  expectedDate: string | null;
}

/** Запись «позиция в снабжении». */
export interface SupplyEntry {
  qty: number;
  model: string;
  expectedDate: string | null;
  outcome: string;
}

/** Агрегат по спецификации (используется в карточке BOM). */
export interface BomAggregate {
  bomId: string;
  bomName: string;
  total: number;
  collected: number;
  onShelf: number;
  awaitingSupply: number;
  notOrdered: number;
  partial: number;
  late: number;
  onTime: number;
  errors: number;
  missing: MissingEntry[];
  onShelfEntries: ShelfEntry[];
  supplyEntries: SupplyEntry[];
  minDeadline: string | null;
  maxReceivedAt: string | null;
}

/** Строка сводки дефицитов. */
export interface DeficitRow {
  positionId: string;
  bomId: string;
  bomName: string;
  projectCode: string;
  rowNo: number;
  materialCode: string;
  manufacturer: string;
  materialName: string;
  model: string;
  unit: string;
  deficitQty: number;
  orderedQty: number;
  expectedDate: string | null;
  deadline: string | null;
  realDelivery: boolean;
  uncoveredNeed: number;
  statusKey: string;
  statusText: string;
  statusColor: string;
}

/** Строка списка отборки. */
export interface PickingRow {
  positionId: string;
  bomId: string;
  bomName: string;
  projectCode: string;
  rowNo: number;
  materialCode: string;
  manufacturer: string;
  materialName: string;
  model: string;
  unit: string;
  requiredQty: number;
  availableForProduction: number;
  productionState: string;
  productionStateText: string;
  deliveryDate: string | null;
  canHandoff: boolean;
  color: string;
}

/** Строка WORKING BOM. */
export interface WorkingBomRow {
  positionId: string;
  bomId: string;
  bomName: string;
  projectCode: string;
  rowNo: number;
  materialCode: string;
  manufacturer: string;
  materialName: string;
  model: string;
  unit: string;
  requiredQty: number;
  reservedQty: number;
  realDeliveryQty: number;
  availableForProduction: number;
  receivedQty: number;
  productionState: string;
  productionStateText: string;
  canHandoff: boolean;
  updatedAt: string;
}

/** Строка листа «Снабжение». */
export interface SupplyProjectEntry {
  projectCode: string;
  deficitQty: number;
  deadline: string | null;
  text: string;
}

export interface SupplyRow {
  materialKey: string;
  materialCode: string;
  manufacturer: string;
  materialName: string;
  model: string;
  unit: string;
  totalDeficit: number;
  totalOrdered: number;
  totalRealDelivery: number;
  projects: SupplyProjectEntry[];
}

/** Строка дашборда: одна спецификация. */
export interface DashboardRow {
  bomId: string;
  bomName: string;
  projectCode: string;
  done: boolean;
  status: string;
  statusText: string;
  statusColor: string;
  totalPositions: number;
  onShelf: number;
  awaitingSupply: number;
  collectedPositions: number;
  dateCreated: string | null;
  deadline: string | null;
  missingText: string;
  missing: MissingEntry[];
  onShelfEntries: ShelfEntry[];
  supplyEntries: SupplyEntry[];
}

/** Строка склада. */
export interface WarehouseRow {
  materialKey: string;
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
  warehouseQty: number;
  reservedQty: number;
  freeQty: number;
  inconsistent: boolean;
  positionsCount: number;
  requiredTotal: number;
  hasRecord: boolean;
}

/* Массовая правка и откат */

/**
 * Результат по одному изменению массовой правки.
 *
 * Идентификатор строки приходит РАЗНЫМИ полями: у правки позиций это `positionId`,
 * у правки склада — `materialKey`. Поэтому оба поля необязательные: интерфейсу
 * важны статус и причина, а по какому полю пришла строка, он знает из запроса.
 */
export interface BulkItemResult {
  positionId?: string;
  materialKey?: string;
  /** Поле в терминах сервера («orderedQty», «expectedDate», «SPEC.MODEL»). */
  field: string;
  status: OperationStatus;
  reason: string;
}

/**
 * Итог массовой правки.
 *
 * Частичный успех — нормальный исход: причина отказа по одной ячейке не отменяет
 * остальные, поэтому интерфейс показывает и число применённых, и причины отказов.
 */
export interface BulkReply {
  applied: number;
  already: number;
  blocked: number;
  results: BulkItemResult[];
  /** Обновлённые позиции: по ним таблица сразу показывает состояние сервера. */
  positions?: PositionDto[];
}

/** Итог откатa операции: прежние значения возвращены по записям журнала. */
export interface RollbackReply {
  /** Команда, которую откатывали. */
  sourceOperationId: string;
  /** Идентификатор команды откатa (у откатa своя запись в журнале). */
  operationId: string;
  applied: number;
  already: number;
  blocked: number;
  results: Array<BulkItemResult & { restoredValue: string }>;
  positions?: PositionDto[];
}
