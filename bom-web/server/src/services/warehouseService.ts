/**
 * Склад: остатки материалов и их соответствие резервам (порт
 * `v12RecalculateWarehouseConsistency` из `v12_material_state.js`).
 *
 * Хранится только фактический остаток. Резерв складывается из резервов позиций
 * (он приходит из спецификации), а свободный остаток считается как
 * «остаток − резерв» и не может быть отрицательным.
 *
 * Проверка согласованности (ТЗ №30): если резерв превышает фактический остаток,
 * это несоответствие — материал обещан производству в объёме, которого физически
 * нет. Строка помечается, и кладовщик видит проблему там же, где вводит остатки.
 */

import type { Database } from '../db/Database.js';
import { requirePermission } from '../domain/permissions.js';
import { isActive } from '../domain/position.js';
import { toQty } from '../domain/values.js';
import { ValidationError } from '../errors.js';
import {
  listMaterials,
  reservedByMaterial,
  setWarehouseQty,
  type MaterialIdentity,
} from '../repositories/materials.js';
import { listPositions } from '../repositories/positions.js';
import { AUDIT_ACTION, recordChanges, type OperationContext } from './operationLog.js';

/** Строка склада. */
export interface WarehouseRow {
  materialKey: string;
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
  /** Фактический остаток. */
  warehouseQty: number;
  /** Сумма резервов позиций по этому материалу. */
  reservedQty: number;
  /** Свободный остаток (не меньше нуля). */
  freeQty: number;
  /** Резерв превышает остаток — несоответствие, требующее внимания. */
  inconsistent: boolean;
  /** Сколько активных позиций используют материал. */
  positionsCount: number;
  /** Общая потребность по активным позициям. */
  requiredTotal: number;
  /** Есть ли запись остатка в базе (иначе остаток считается нулевым). */
  hasRecord: boolean;
}

/** Материал и его агрегаты в процессе построения списка. */
interface MaterialAggregate {
  identity: MaterialIdentity;
  reservedQty: number;
  requiredTotal: number;
  positionsCount: number;
}

/** Список склада: остатки, резервы, свободный остаток и несоответствия. */
export async function listWarehouse(db: Database): Promise<WarehouseRow[]> {
  const [records, positions, reservedMap] = await Promise.all([
    listMaterials(db),
    listPositions(db),
    reservedByMaterial(db),
  ]);

  const aggregates = new Map<string, MaterialAggregate>();
  for (const position of positions) {
    if (!isActive(position)) {
      continue;
    }
    let aggregate = aggregates.get(position.materialKey);
    if (!aggregate) {
      aggregate = {
        identity: {
          code: position.identity.code,
          manufacturer: position.identity.manufacturer,
          name: position.identity.name,
          model: position.identity.model,
          unit: position.identity.unit,
        },
        reservedQty: 0,
        requiredTotal: 0,
        positionsCount: 0,
      };
      aggregates.set(position.materialKey, aggregate);
    }
    aggregate.reservedQty += position.quantities.reservedQty;
    aggregate.requiredTotal += position.quantities.requiredQty;
    aggregate.positionsCount += 1;
  }

  const keys = new Set<string>([...aggregates.keys(), ...records.map((record) => record.materialKey)]);
  const rows: WarehouseRow[] = [];

  for (const materialKey of keys) {
    const record = records.find((item) => item.materialKey === materialKey);
    const aggregate = aggregates.get(materialKey);
    const identity: MaterialIdentity = aggregate?.identity ?? {
      code: record?.code ?? '',
      manufacturer: record?.manufacturer ?? '',
      name: record?.name ?? '',
      model: record?.model ?? '',
      unit: record?.unit ?? '',
    };
    const warehouseQty = record?.warehouseQty ?? 0;
    // Резерв берём из агрегата базы: он учитывает только активные позиции.
    const reservedQty = reservedMap.get(materialKey) ?? 0;

    rows.push({
      materialKey,
      code: identity.code,
      manufacturer: identity.manufacturer,
      name: identity.name,
      model: identity.model,
      unit: identity.unit,
      warehouseQty,
      reservedQty,
      freeQty: Math.max(warehouseQty - reservedQty, 0),
      inconsistent: reservedQty > warehouseQty,
      positionsCount: aggregate?.positionsCount ?? 0,
      requiredTotal: aggregate?.requiredTotal ?? 0,
      hasRecord: Boolean(record),
    });
  }

  rows.sort((a, b) => {
    // Сначала проблемные строки, затем — по наименованию.
    if (a.inconsistent !== b.inconsistent) {
      return a.inconsistent ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'ru');
  });
  return rows;
}

/** Итог изменения остатка. */
export interface WarehouseChangeResult {
  materialKey: string;
  previousQty: number;
  warehouseQty: number;
  reservedQty: number;
  freeQty: number;
}

/**
 * Установить фактический остаток материала (ввод кладовщика).
 *
 * Право: «Складской остаток». Отрицательный остаток невозможен — значение
 * ограничивается нулём.
 */
export async function setWarehouseQuantity(
  db: Database,
  ctx: OperationContext,
  params: { materialKey: string; quantity: number },
): Promise<WarehouseChangeResult> {
  requirePermission(ctx.role, 'WAREHOUSE_QTY');

  const materialKey = String(params.materialKey ?? '').trim();
  if (!materialKey) {
    throw new ValidationError('Не указан материал');
  }
  const quantity = toQty(params.quantity);

  const rows = await listWarehouse(db);
  const row = rows.find((item) => item.materialKey === materialKey);
  if (!row) {
    throw new ValidationError(`Материал не найден: ${materialKey}`);
  }
  if (row.warehouseQty === quantity) {
    return {
      materialKey,
      previousQty: row.warehouseQty,
      warehouseQty: row.warehouseQty,
      reservedQty: row.reservedQty,
      freeQty: row.freeQty,
    };
  }

  const identity: MaterialIdentity = {
    code: row.code,
    manufacturer: row.manufacturer,
    name: row.name,
    model: row.model,
    unit: row.unit,
  };

  await db.transaction(async (tx) => {
    await setWarehouseQty(tx, materialKey, quantity, identity);
    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.WAREHOUSE_QTY,
        field: 'WAREHOUSE_QTY',
        oldValue: row.warehouseQty,
        newValue: quantity,
        reason:
          `Материал: ${identity.name} ${identity.model} (${materialKey}). ` +
          `Резерв: ${row.reservedQty}`,
      },
    ]);
  });

  return {
    materialKey,
    previousQty: row.warehouseQty,
    warehouseQty: quantity,
    reservedQty: row.reservedQty,
    freeQty: Math.max(quantity - row.reservedQty, 0),
  };
}

/** Сводка несоответствий «резерв больше остатка» — для предупреждения на экране. */
export function listInconsistencies(rows: readonly WarehouseRow[]): WarehouseRow[] {
  return rows.filter((row) => row.inconsistent);
}
