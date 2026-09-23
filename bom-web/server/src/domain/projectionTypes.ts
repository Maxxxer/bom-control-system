/**
 * Типы представлений (проекций). Проекция — это «экран» для роли: набор строк,
 * который сервер считает из текущего состояния позиций.
 *
 * Строки описаны ИМЕНОВАННЫМИ полями, а не номерами колонок, как в электронной
 * таблице: так интерфейс не зависит от порядка столбцов, а сервер и клиент видят
 * один и тот же контракт.
 */

import type { BomStatus, ProcurementOutcome, ProductionState } from './types.js';
import type { DeficitStatusKey } from './procurement.js';

/** Запись «недостающий материал» для дашборда. */
export interface MissingEntry {
  qty: number;
  model: string;
  code: string;
  name: string;
  manufacturer: string;
  expectedDate: string | null;
}

/** Запись «материал на складе, ждёт отборки» для подсказки дашборда. */
export interface ShelfEntry {
  qty: number;
  model: string;
  expectedDate: string | null;
}

/** Запись «позиция в снабжении» для подсказки дашборда. */
export interface SupplyEntry {
  qty: number;
  model: string;
  expectedDate: string | null;
  outcome: ProcurementOutcome;
}

/** Агрегат по одному BOM: из него считается статус и колонки дашборда. */
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

/** Строка сводки дефицитов (рабочее место снабженца и экономиста). */
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
  statusKey: DeficitStatusKey;
  statusText: string;
  statusColor: string;
}

/** Строка списка отборки (рабочее место кладовщика). */
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
  productionState: ProductionState;
  productionStateText: string;
  deliveryDate: string | null;
  /** Только голубые строки можно передавать производству. */
  canHandoff: boolean;
  color: string;
}

/** Строка WORKING BOM (рабочее место производства). */
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
  productionState: ProductionState;
  productionStateText: string;
  canHandoff: boolean;
  updatedAt: string;
}

/** Строка листа СНАБЖЕНИЕ (агрегация по ключу материала). */
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

/** Строка дашборда: один BOM. */
export interface DashboardRow {
  bomId: string;
  bomName: string;
  projectCode: string;
  done: boolean;
  status: BomStatus;
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
