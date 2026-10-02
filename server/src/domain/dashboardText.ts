/**
 * Текстовые подсказки дашборда — перенос `v12BuildMissingItemsText`,
 * `v12BuildShelfItemsText`, `v12BuildSupplyItemsText`, `v12FormatItemLine`
 * (`v12_projections.js`).
 *
 * Формат строки один: «<количество> - <модель> - <дата>». Даты сортируются по
 * убыванию (самая поздняя сверху) — так видно, что приедет позже всех.
 */

import { PROCUREMENT_OUTCOME_LABEL } from './constants.js';
import { formatDateOnly, formatDateTime } from './values.js';
import type { MissingEntry, ShelfEntry, SupplyEntry } from './projectionTypes.js';
import type { ProcurementOutcome } from './types.js';

/** Порядок групп в подсказке «Ожидается поставка». */
const SUPPLY_GROUP_ORDER: ProcurementOutcome[] = ['NOT_ORDERED', 'PARTIAL', 'ON_TIME', 'LATE'];

/** Одна строка подсказки: количество, модель и дата (если есть). */
export function formatItemLine(entry: { qty: number; model: string; expectedDate: string | null }): string {
  const date = formatDateOnly(entry.expectedDate);
  return date ? `${entry.qty} - ${entry.model} - ${date}` : `${entry.qty} - ${entry.model}`;
}

/** Сортировка по ожидаемой дате по убыванию, при равенстве — по модели. */
function byExpectedDateDesc(
  a: { expectedDate: string | null; model: string },
  b: { expectedDate: string | null; model: string },
): number {
  const da = a.expectedDate ?? '';
  const db = b.expectedDate ?? '';
  if (da !== db) {
    return db.localeCompare(da);
  }
  return a.model.localeCompare(b.model, 'ru');
}

/** Недостающие материалы: «<дефицит> - <модель> - <ожидаемый срок>». */
export function buildMissingItemsText(missing: readonly MissingEntry[]): string {
  if (!missing.length) {
    return '';
  }
  return [...missing].sort(byExpectedDateDesc).map(formatItemLine).join('\n');
}

/** Материалы на складе, ждущие отборки. */
export function buildShelfItemsText(entries: readonly ShelfEntry[]): string {
  if (!entries.length) {
    return '';
  }
  return [...entries].sort(byExpectedDateDesc).map(formatItemLine).join('\n');
}

/** Позиции снабжения, сгруппированные по исходу заказа. */
export function buildSupplyItemsText(entries: readonly SupplyEntry[]): string {
  if (!entries.length) {
    return '';
  }
  const blocks: string[] = [];
  for (const outcome of SUPPLY_GROUP_ORDER) {
    const items = entries.filter((entry) => entry.outcome === outcome);
    if (!items.length) {
      continue;
    }
    items.sort(byExpectedDateDesc);
    blocks.push(`${PROCUREMENT_OUTCOME_LABEL[outcome]}:\n${items.map(formatItemLine).join('\n')}`);
  }
  return blocks.join('\n');
}

/** Ячейка «Недостающие материалы»: список недостач либо отметка о комплектности. */
export function buildDashboardMissingCell(params: {
  total: number;
  collected: number;
  maxReceivedAt: string | null;
  missing: readonly MissingEntry[];
}): string {
  if (params.total > 0 && params.collected === params.total) {
    const stamp = formatDateTime(params.maxReceivedAt);
    return stamp ? `Скомплектовано - ${stamp}` : 'Скомплектовано';
  }
  return buildMissingItemsText(params.missing);
}
