/**
 * Контракт данных для административных разделов: учётные записи, спецификации,
 * журнал, архив, склад и результаты массовой передачи.
 *
 * Вынесено отдельно от `types.ts`, потому что это другой круг задач: рабочие
 * витрины нужны всем ролям, а эти данные — администратору и кладовщику.
 */

import type { BomAggregate, PositionDto, WarehouseRow } from './types.js';

/** Раздел «Мой доступ»: роли и подписи прав. */
export interface MetaResponse {
  roles: Array<{ role: string; label: string }>;
  permissions: Record<string, string>;
  sessionTtlDays: number;
}

/** Учётная запись глазами администратора. */
export interface UserView {
  id: number;
  login: string;
  fullName: string;
  role: string;
  roleLabel: string;
  isActive: boolean;
  createdAt: string;
  permissions: string[];
}

/** Спецификация в списке. */
export interface BomSummary {
  id: number;
  code: string;
  name: string;
  sourceNote: string;
  revision: number;
  isDone: boolean;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
  positionCount: number;
}

/** Отчёт об импорте спецификации. */
export interface BomImportReport {
  bomCode: string;
  bomName: string;
  created: boolean;
  revision: number;
  inserted: number;
  updated: number;
  deleted: number;
  markedRemoved: number;
  totalInFile: number;
  foundColumns: string[];
  incomplete: Array<{ sourceLine: number; name: string; reason: string }>;
  skipped: Array<{ sourceLine: number; name: string; reason: string }>;
  skippedEmptyRows: number;
}

/** Карточка спецификации. */
export interface BomCard {
  bom: BomSummary;
  positions: PositionDto[];
  aggregate: BomAggregate;
  statusText: string;
}

/** Событие журнала действий. */
export interface AuditRecord {
  id: number;
  operationId: string;
  actor: string;
  action: string;
  bomId: string;
  positionId: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  createdAt: string;
}

/** Запись архива переданных материалов. */
export interface ArchiveRecord {
  id: number;
  positionId: string;
  bomId: string;
  bomName: string;
  rowNo: number;
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
  qty: number;
  receivedAt: string | null;
  receivedBy: string;
  sourceUi: string;
  comment: string;
  createdAt: string;
}

/** Итог обработки одной позиции при передаче. */
export interface HandoffItemResult {
  positionId: string;
  bomName: string;
  materialName: string;
  model: string;
  status: 'handoff' | 'returned' | 'already' | 'blocked';
  reason?: string;
}

/** Итог массовой передачи или возврата. */
export interface HandoffBatchResult {
  results: HandoffItemResult[];
  handedOff: number;
  returned: number;
  skipped: number;
  blocked: number;
}

/** Ответ склада: строки, несоответствия и итоги. */
export interface WarehouseResponse {
  rows: WarehouseRow[];
  inconsistencies: WarehouseRow[];
  totals: {
    rows: number;
    warehouseQty: number;
    reservedQty: number;
    freeQty: number;
    inconsistent: number;
  };
}

/** Итоги витрины «Сводка дефицитов». */
export interface DeficitTotals {
  rows: number;
  deficitQty: number;
  uncoveredNeed: number;
  orderedQty: number;
}

/** Итоги витрины «WORKING BOM». */
export interface WorkingBomTotals {
  rows: number;
  requiredQty: number;
  availableForProduction: number;
  canHandoff: number;
}

/** Итоги витрины «Отборка». */
export interface PickingTotals {
  rows: number;
  canHandoff: number;
}

/** Итоги листа «Снабжение». */
export interface SupplyTotals {
  rows: number;
  totalDeficit: number;
  totalOrdered: number;
  totalRealDelivery: number;
}

/** Итоги дашборда. */
export interface DashboardTotals {
  boms: number;
  ready: number;
  onShelf: number;
  awaitingSupply: number;
  withErrors: number;
  positions: number;
}

/** Обзор для главного экрана. */
export interface OverviewResponse {
  positions: { total: number; active: number; inProduction: number; removed: number };
  boms: { total: number; done: number; withErrors: number };
  issues: { invalidPositions: number; withoutOrder: number; inconsistentShelf: number };
  statuses: Array<{ status: string; label: string; count: number }>;
}
