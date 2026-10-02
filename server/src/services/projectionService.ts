/**
 * Витрины (проекции) для рабочих экранов.
 *
 * Проекции НЕ хранятся в базе: они собираются из актуального состояния позиций
 * при каждом запросе. В прежней системе их приходилось пересобирать в листы
 * после каждой правки; здесь источник истины один — таблица позиций, поэтому
 * рассогласование между витринами невозможно по построению.
 *
 * Все витрины строятся в доменном слое (чистые функции), сервис лишь собирает
 * данные и добавляет к ним итоги, которые удобно показывать человеку.
 */

import type { Database } from '../db/Database.js';
import { BOM_STATUS_LABEL, ROLE_LABEL } from '../domain/constants.js';
import { aggregateBomStates, buildDashboardRows } from '../domain/dashboard.js';
import { buildPickingRows, buildProjectCodes, type PickingOptions } from '../domain/picking.js';
import { buildDeficitRows, buildWorkingBomRows } from '../domain/projectionsRows.js';
import { buildSupplyRows } from '../domain/supply.js';
import type {
  DashboardRow,
  DeficitRow,
  PickingRow,
  SupplyRow,
  WorkingBomRow,
} from '../domain/projectionTypes.js';
import { bomCreatedDates, doneBomCodes } from '../repositories/boms.js';
import { listPositions } from '../repositories/positions.js';

/** Строка витрины с фильтром по проекту. */
function projectFiltered<Row extends { projectCode: string }>(
  rows: Row[],
  projectCode?: string | null,
): Row[] {
  const filter = String(projectCode ?? '').trim();
  return filter ? rows.filter((row) => row.projectCode === filter) : rows;
}

/** Сводка дефицитов: строки, итоги и список проектов для фильтра. */
export async function getDeficitView(
  db: Database,
  params: { projectCode?: string | null } = {},
): Promise<{
  rows: DeficitRow[];
  projects: string[];
  totals: { rows: number; deficitQty: number; uncoveredNeed: number; orderedQty: number };
}> {
  const positions = await listPositions(db);
  const rows = projectFiltered(buildDeficitRows(positions), params.projectCode);
  return {
    rows,
    projects: buildProjectCodes(positions),
    totals: {
      rows: rows.length,
      deficitQty: rows.reduce((sum, row) => sum + row.deficitQty, 0),
      uncoveredNeed: rows.reduce((sum, row) => sum + row.uncoveredNeed, 0),
      orderedQty: rows.reduce((sum, row) => sum + row.orderedQty, 0),
    },
  };
}

/** WORKING BOM: активные позиции всех спецификаций. */
export async function getWorkingBomView(
  db: Database,
  params: { projectCode?: string | null } = {},
): Promise<{
  rows: WorkingBomRow[];
  projects: string[];
  totals: { rows: number; requiredQty: number; availableForProduction: number; canHandoff: number };
}> {
  const positions = await listPositions(db);
  const rows = projectFiltered(buildWorkingBomRows(positions), params.projectCode);
  return {
    rows,
    projects: buildProjectCodes(positions),
    totals: {
      rows: rows.length,
      requiredQty: rows.reduce((sum, row) => sum + row.requiredQty, 0),
      availableForProduction: rows.reduce((sum, row) => sum + row.availableForProduction, 0),
      canHandoff: rows.filter((row) => row.canHandoff).length,
    },
  };
}

/**
 * Отборка: строки, готовые к передаче, сверху.
 *
 * Даты создания спецификаций нужны, чтобы у позиций, изначально закрытых
 * резервом, дата поставки совпадала с датой создания спецификации.
 */
export async function getPickingView(
  db: Database,
  params: { projectCode?: string | null } = {},
): Promise<{
  rows: PickingRow[];
  projects: string[];
  totals: { rows: number; canHandoff: number };
}> {
  const [positions, createdDates] = await Promise.all([listPositions(db), bomCreatedDates(db)]);
  const options: PickingOptions = {
    projectCode: params.projectCode ?? null,
    bomCreatedDates: createdDates,
  };
  const rows = buildPickingRows(positions, options);
  return {
    rows,
    projects: buildProjectCodes(positions),
    totals: {
      rows: rows.length,
      canHandoff: rows.filter((row) => row.canHandoff).length,
    },
  };
}

/** Снабжение: свод по материалам с перечнем проектов. */
export async function getSupplyView(db: Database): Promise<{
  rows: SupplyRow[];
  totals: { rows: number; totalDeficit: number; totalOrdered: number; totalRealDelivery: number };
}> {
  const positions = await listPositions(db);
  const rows = buildSupplyRows(positions);
  return {
    rows,
    totals: {
      rows: rows.length,
      totalDeficit: rows.reduce((sum, row) => sum + row.totalDeficit, 0),
      totalOrdered: rows.reduce((sum, row) => sum + row.totalOrdered, 0),
      totalRealDelivery: rows.reduce((sum, row) => sum + row.totalRealDelivery, 0),
    },
  };
}

/** Дашборд: по строке на спецификацию, выполненные исключены. */
export async function getDashboardView(db: Database): Promise<{
  rows: DashboardRow[];
  totals: {
    boms: number;
    ready: number;
    onShelf: number;
    awaitingSupply: number;
    withErrors: number;
    positions: number;
  };
}> {
  const [positions, excluded, createdDates] = await Promise.all([
    listPositions(db),
    doneBomCodes(db),
    bomCreatedDates(db),
  ]);
  const rows = buildDashboardRows(positions, {
    excludedBomIds: excluded,
    bomCreatedDates: createdDates,
  });
  return {
    rows,
    totals: {
      boms: rows.length,
      ready: rows.filter((row) => row.status === 'READY').length,
      onShelf: rows.reduce((sum, row) => sum + row.onShelf, 0),
      awaitingSupply: rows.reduce((sum, row) => sum + row.awaitingSupply, 0),
      withErrors: rows.filter((row) => row.status === 'ERROR').length,
      positions: rows.reduce((sum, row) => sum + row.totalPositions, 0),
    },
  };
}

/** Обзор для главного экрана: сколько чего в работе у каждой роли. */
export async function getOverview(db: Database): Promise<{
  positions: { total: number; active: number; inProduction: number; removed: number };
  boms: { total: number; done: number; withErrors: number };
  issues: { invalidPositions: number; withoutOrder: number; inconsistentShelf: number };
  statuses: Array<{ status: string; label: string; count: number }>;
}> {
  const [positions, excluded] = await Promise.all([listPositions(db), doneBomCodes(db)]);
  const aggregates = aggregateBomStates(positions);
  const invalidPositions = positions.filter(
    (position) => !position.computed.valid && position.lifecycle !== 'REMOVED',
  ).length;
  const withoutOrder = positions.filter(
    (position) =>
      position.lifecycle === 'ACTIVE' &&
      position.computed.valid &&
      position.computed.deficitQty > 0 &&
      position.quantities.orderedQty === 0,
  ).length;

  const statusCounts = new Map<string, number>();
  for (const aggregate of aggregates.values()) {
    const status = (() => {
      if (aggregate.errors > 0) {
        return 'ERROR';
      }
      if (aggregate.total > 0 && aggregate.collected === aggregate.total) {
        return 'READY';
      }
      if (aggregate.onShelf > 0) {
        return 'ON_SHELF';
      }
      if (aggregate.notOrdered > 0) {
        return 'NOT_ORDERED';
      }
      return aggregate.late > 0 ? 'WAITING_LATE' : 'WAITING_ON_TIME';
    })();
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  return {
    positions: {
      total: positions.length,
      active: positions.filter((position) => position.lifecycle === 'ACTIVE').length,
      inProduction: positions.filter((position) => position.lifecycle === 'ARCHIVED').length,
      removed: positions.filter((position) => position.lifecycle === 'REMOVED').length,
    },
    boms: {
      total: aggregates.size,
      done: excluded.size,
      withErrors: [...aggregates.values()].filter((aggregate) => aggregate.errors > 0).length,
    },
    issues: {
      invalidPositions,
      withoutOrder,
      inconsistentShelf: 0,
    },
    statuses: [...statusCounts.entries()].map(([status, count]) => ({
      status,
      label: BOM_STATUS_LABEL[status as keyof typeof BOM_STATUS_LABEL] ?? status,
      count,
    })),
  };
}

/** Справочник ролей для интерфейса (без обращения к базе). */
export function listRoleLabels(): Array<{ role: string; label: string }> {
  return Object.entries(ROLE_LABEL).map(([role, label]) => ({ role, label }));
}
