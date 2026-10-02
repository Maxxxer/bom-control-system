/**
 * Дашборд — перенос `v12AggregateBomStates`, `v12RefreshDashboard`,
 * `v12BuildMissingEntry`, `v12BuildShelfEntry`, `v12BuildSupplyEntry`
 * (`v12_projections.js`).
 *
 * Дашборд показывает по строке на BOM: статус, сколько позиций всего, сколько на
 * складе, сколько ждёт поставки, сколько уже передано производству, сроки и
 * список недостающих материалов. Выполненные BOM в активный список не попадают.
 *
 * Правило учёта: позиции с жизненным циклом «удалена» игнорируются, а переданные
 * производству — считаются собранными и недостающими НЕ являются.
 */

import { bomStatusPresentation, computeBomStatus } from './bomStatus.js';
import { buildDashboardMissingCell } from './dashboardText.js';
import { LIFECYCLE_STATE, PRODUCTION_STATE } from './constants.js';
import { procurementOutcome } from './procurement.js';
import { extractProjectCode, toIsoDate } from './values.js';
import type { BomAggregate, DashboardRow, MissingEntry, ShelfEntry, SupplyEntry } from './projectionTypes.js';
import type { Position } from './position.js';

/** Создать пустой агрегат для BOM. */
function emptyAggregate(bomId: string, bomName: string): BomAggregate {
  return {
    bomId,
    bomName,
    total: 0,
    collected: 0,
    onShelf: 0,
    awaitingSupply: 0,
    notOrdered: 0,
    partial: 0,
    late: 0,
    onTime: 0,
    errors: 0,
    missing: [],
    onShelfEntries: [],
    supplyEntries: [],
    minDeadline: null,
    maxReceivedAt: null,
  };
}

/** Агрегировать позиции по BOM: количества, сроки и подсказки. */
export function aggregateBomStates(positions: readonly Position[]): Map<string, BomAggregate> {
  const byBom = new Map<string, BomAggregate>();

  for (const position of positions) {
    if (position.lifecycle === LIFECYCLE_STATE.REMOVED) {
      continue;
    }
    let agg = byBom.get(position.bomId);
    if (!agg) {
      agg = emptyAggregate(position.bomId, position.bomName);
      byBom.set(position.bomId, agg);
    }

    agg.total += 1;
    agg.minDeadline = earliest(agg.minDeadline, position.identity.deadline);

    // Ошибка данных — технический статус, позиция сразу попадает в недостачи.
    if (!position.computed.valid) {
      agg.errors += 1;
      agg.missing.push(buildMissingEntry(position));
      continue;
    }

    // Передано производству — позиция закрыта.
    if (position.quantities.received) {
      agg.collected += 1;
      agg.maxReceivedAt = latest(agg.maxReceivedAt, position.receivedAt);
      continue;
    }

    // Материал на складе, ждёт отборки — недостающим НЕ считается.
    if (position.computed.productionState === PRODUCTION_STATE.READY_FOR_HANDOFF) {
      agg.onShelf += 1;
      agg.onShelfEntries.push(buildShelfEntry(position));
      continue;
    }

    // Позиция в снабжении — исход по тем же правилам, что и статус строки сводки.
    const outcome = procurementOutcome({
      orderedQty: position.quantities.orderedQty,
      deficitQty: position.computed.deficitQty,
      expectedDate: position.expectedDate,
      deadline: position.identity.deadline,
    });
    agg.awaitingSupply += 1;
    agg.supplyEntries.push(buildSupplyEntry(position, outcome));
    if (outcome === 'NOT_ORDERED') {
      agg.notOrdered += 1;
    } else if (outcome === 'PARTIAL') {
      agg.notOrdered += 1;
      agg.partial += 1;
    } else if (outcome === 'LATE') {
      agg.late += 1;
    } else {
      agg.onTime += 1;
    }

    if (position.computed.deficitQty > 0) {
      agg.missing.push(buildMissingEntry(position));
    }
  }

  return byBom;
}

/** Запись «недостающий материал». */
export function buildMissingEntry(position: Position): MissingEntry {
  return {
    qty: position.computed.deficitQty,
    model: position.identity.model,
    code: position.identity.code,
    name: position.identity.name,
    manufacturer: position.identity.manufacturer,
    expectedDate: position.expectedDate,
  };
}

/** Запись «материал на складе» (для подсказки колонки «На складе»). */
export function buildShelfEntry(position: Position): ShelfEntry {
  return {
    qty: position.quantities.requiredQty,
    model: position.identity.model,
    expectedDate: position.realDeliveryDate,
  };
}

/** Запись «позиция в снабжении» (для подсказки колонки «Ожидается поставка»). */
export function buildSupplyEntry(
  position: Position,
  outcome: SupplyEntry['outcome'],
): SupplyEntry {
  return {
    qty: position.computed.deficitQty,
    model: position.identity.model,
    expectedDate: position.expectedDate,
    outcome,
  };
}

/** Строки дашборда: активные BOM, кроме отмеченных выполненными. */
export function buildDashboardRows(
  positions: readonly Position[],
  options: { excludedBomIds?: ReadonlySet<string>; bomCreatedDates?: ReadonlyMap<string, string | null> } = {},
): DashboardRow[] {
  const excluded = options.excludedBomIds ?? new Set<string>();
  const createdDates = options.bomCreatedDates ?? new Map<string, string | null>();
  const aggregates = aggregateBomStates(positions);
  const rows: DashboardRow[] = [];

  for (const agg of aggregates.values()) {
    if (excluded.has(agg.bomId)) {
      continue;
    }
    const status = computeBomStatus(agg);
    const presentation = bomStatusPresentation(status);
    rows.push({
      bomId: agg.bomId,
      bomName: agg.bomName,
      projectCode: extractProjectCode(agg.bomName),
      done: false,
      status,
      statusText: presentation.text,
      statusColor: presentation.color,
      totalPositions: agg.total,
      onShelf: agg.onShelf,
      awaitingSupply: agg.awaitingSupply,
      collectedPositions: agg.collected,
      dateCreated: createdDates.get(agg.bomId) ?? null,
      deadline: agg.minDeadline,
      missingText: buildDashboardMissingCell({
        total: agg.total,
        collected: agg.collected,
        maxReceivedAt: agg.maxReceivedAt,
        missing: agg.missing,
      }),
      missing: agg.missing,
      onShelfEntries: agg.onShelfEntries,
      supplyEntries: agg.supplyEntries,
    });
  }

  rows.sort((a, b) => a.bomName.localeCompare(b.bomName, 'ru'));
  return rows;
}

/** Подсказки дашборда отдельными функциями (для тестов и переиспользования). */
export { buildShelfItemsText, buildSupplyItemsText, buildMissingItemsText } from './dashboardText.js';

/** Более ранняя дата (пустая не затирает найденную). */
function earliest(current: string | null, candidate: string | null): string | null {
  const next = toIsoDate(candidate);
  if (!next) {
    return current;
  }
  const now = toIsoDate(current);
  if (!now) {
    return next;
  }
  return next < now ? next : now;
}

/** Более поздняя дата/время (для отметки «Скомплектовано»). */
function latest(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}
