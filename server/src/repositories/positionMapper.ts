/**
 * Преобразование строки базы в сущность «Позиция».
 *
 * Зачем отдельный модуль: позиции читаются в нескольких местах (проекции,
 * операции, импорт). Один маппер гарантирует, что все они видят одинаковые
 * данные, а SQL-запрос выборки тоже один — с явными приведениями типов.
 *
 * Приведения важны: `numeric` PostgreSQL драйверы отдают строкой (чтобы не
 * терять точность), поэтому количества приводятся к `float8` прямо в запросе,
 * а даты — к `text` в формате `YYYY-MM-DD` (без сюрпризов часовых поясов).
 */

import { applyComputed, type Position } from '../domain/position.js';
import { toIsoDate, toNumber } from '../domain/values.js';
import type { LifecycleState } from '../domain/types.js';

/**
 * Общая часть SELECT: позиция вместе с кодом и именем своей спецификации.
 * Подставляется в запросы репозитория, чтобы выборка была описана один раз.
 */
export const POSITION_SELECT = `
  select
    p.id,
    p.position_id,
    p.material_key,
    p.row_no::float8                as row_no,
    p.code,
    p.manufacturer,
    p.name,
    p.model,
    p.unit,
    p.required_qty::float8          as required_qty,
    p.reserved_qty::float8          as reserved_qty,
    p.ordered_qty::float8           as ordered_qty,
    p.real_delivery_qty::float8     as real_delivery_qty,
    p.real_delivery_date::text      as real_delivery_date,
    p.expected_date::text           as expected_date,
    p.deadline::text                as deadline,
    p.received_qty::float8          as received_qty,
    p.received,
    p.received_at,
    p.received_by,
    p.lifecycle,
    p.updated_at,
    b.code                          as bom_code,
    b.name                          as bom_name
  from bom_positions p
  join boms b on b.id = p.bom_id
`;

/** Строка выборки позиции. */
export interface PositionRow {
  id: string | number;
  position_id: string;
  material_key: string;
  row_no: number | string;
  code: string | null;
  manufacturer: string | null;
  name: string | null;
  model: string | null;
  unit: string | null;
  required_qty: number | string;
  reserved_qty: number | string;
  ordered_qty: number | string;
  real_delivery_qty: number | string;
  real_delivery_date: string | null;
  expected_date: string | null;
  deadline: string | null;
  received_qty: number | string;
  received: boolean;
  received_at: Date | string | null;
  received_by: string | null;
  lifecycle: string;
  updated_at: Date | string;
  bom_code: string;
  bom_name: string;
}

/** Преобразовать строку выборки в сущность позиции (с пересчётом производных). */
export function mapPosition(row: PositionRow): Position {
  return applyComputed({
    id: Number(row.id),
    positionId: row.position_id,
    bomId: row.bom_code,
    bomName: row.bom_name,
    materialKey: row.material_key,
    identity: {
      rowNo: toNumber(row.row_no),
      code: row.code ?? '',
      manufacturer: row.manufacturer ?? '',
      name: row.name ?? '',
      model: row.model ?? '',
      unit: row.unit ?? '',
      deadline: toIsoDate(row.deadline),
    },
    quantities: {
      requiredQty: toNumber(row.required_qty),
      reservedQty: toNumber(row.reserved_qty),
      orderedQty: toNumber(row.ordered_qty),
      realDeliveryQty: toNumber(row.real_delivery_qty),
      receivedQty: toNumber(row.received_qty),
      received: row.received === true,
    },
    expectedDate: toIsoDate(row.expected_date),
    realDeliveryDate: toIsoDate(row.real_delivery_date),
    receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
    receivedBy: row.received_by ?? '',
    lifecycle: row.lifecycle as LifecycleState,
    updatedAt: new Date(row.updated_at).toISOString(),
    computed: {
      deficitQty: 0,
      uncoveredNeed: 0,
      overOrderedQty: 0,
      shortDeliveryQty: 0,
      availableForProduction: 0,
      readyForHandoff: false,
      supplyState: 'NO_REQUIREMENT',
      productionState: 'NOT_AVAILABLE',
      flags: [],
      valid: false,
      missing: {
        rowNo: true,
        name: true,
        model: true,
        unit: true,
        requiredQty: true,
        deadline: true,
      },
    },
  });
}
