/**
 * Репозиторий позиций спецификаций.
 *
 * Поля позиции делятся на две группы, и это разделение принципиально:
 *
 * 1. СПЕЦИФИКАЦИЯ (№ п/п, артикул, наименование, модель, ед.изм, потребность,
 *    резерв, крайний срок) — приходит из исходной спецификации. При повторном
 *    импорте она обновляется, но операционные данные при этом сохраняются.
 *
 * 2. ОПЕРАЦИОННЫЕ ДАННЫЕ (заказано, ожидаемая дата, реальная поставка,
 *    передано производству, жизненный цикл) — их ведут роли. Повторный импорт
 *    спецификации их НЕ затирает: иначе кладовщик и снабженец теряли бы работу
 *    при каждом обновлении файла.
 */

import type { Database } from '../db/Database.js';
import type { Position } from '../domain/position.js';
import type { LifecycleState } from '../domain/types.js';
import { mapPosition, POSITION_SELECT, type PositionRow } from './positionMapper.js';

/** Поля позиции, приходящие из спецификации. */
export interface PositionSpec {
  rowNo: number;
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
  requiredQty: number;
  reservedQty: number;
  deadline: string | null;
}

/** Новая позиция (спецификация + ключи). */
export interface NewPosition extends PositionSpec {
  bomId: number;
  positionId: string;
  materialKey: string;
}

/** Операционные поля, доступные для изменения ролями. */
export interface OperatingChanges {
  orderedQty?: number;
  expectedDate?: string | null;
  realDeliveryQty?: number;
  realDeliveryDate?: string | null;
  received?: boolean;
  receivedQty?: number;
  receivedAt?: Date | null;
  receivedBy?: string;
  lifecycle?: LifecycleState;
}

/** Размер порции при массовой вставке (ограничение на число параметров). */
const INSERT_CHUNK_SIZE = 200;

/** Все позиции системы (включая архивные). */
export async function listPositions(db: Database): Promise<Position[]> {
  const rows = await db.query<PositionRow>(
    `${POSITION_SELECT} order by b.name asc, p.row_no asc`,
  );
  return rows.map(mapPosition);
}

/** Только активные позиции (рабочие экраны). */
export async function listActivePositions(db: Database): Promise<Position[]> {
  const rows = await db.query<PositionRow>(
    `${POSITION_SELECT} where p.lifecycle = 'ACTIVE' order by b.name asc, p.row_no asc`,
  );
  return rows.map(mapPosition);
}

/** Позиции одной спецификации по её коду. */
export async function listPositionsByBom(
  db: Database,
  bomCode: string,
): Promise<Position[]> {
  const rows = await db.query<PositionRow>(
    `${POSITION_SELECT} where b.code = $1 order by p.row_no asc`,
    [bomCode],
  );
  return rows.map(mapPosition);
}

/** Найти позицию по её идентификатору (`код спецификации:ключ материала`). */
export async function findPositionByPositionId(
  db: Database,
  positionId: string,
): Promise<Position | null> {
  const rows = await db.query<PositionRow>(`${POSITION_SELECT} where p.position_id = $1`, [
    positionId,
  ]);
  const row = rows[0];
  return row ? mapPosition(row) : null;
}

/**
 * Добавить позиции (массово, порциями).
 *
 * Конфликт по `position_id` игнорируется: повторный импорт той же спецификации
 * не должен падать и не должен создавать дубли.
 */
export async function insertPositions(
  db: Database,
  positions: readonly NewPosition[],
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < positions.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = positions.slice(offset, offset + INSERT_CHUNK_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];
    chunk.forEach((position, index) => {
      const base = index * 12;
      tuples.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ` +
          `$${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`,
      );
      values.push(
        position.bomId,
        position.positionId,
        position.materialKey,
        position.rowNo,
        position.code,
        position.manufacturer,
        position.name,
        position.model,
        position.unit,
        position.requiredQty,
        position.reservedQty,
        position.deadline,
      );
    });

    const rows = await db.query<{ position_id: string }>(
      `insert into bom_positions (
         bom_id, position_id, material_key, row_no, code, manufacturer,
         name, model, unit, required_qty, reserved_qty, deadline
       ) values ${tuples.join(', ')}
       on conflict (position_id) do nothing
       returning position_id`,
      values,
    );
    inserted += rows.length;
  }
  return inserted;
}

/** Удалить позиции по их идентификаторам (например, исчезнувшие из спецификации). */
export async function deletePositionsByPositionIds(
  db: Database,
  positionIds: readonly string[],
): Promise<number> {
  if (!positionIds.length) {
    return 0;
  }
  const rows = await db.query<{ position_id: string }>(
    `delete from bom_positions where position_id = any($1::text[]) returning position_id`,
    [positionIds],
  );
  return rows.length;
}

/**
 * Обновить поля спецификации (при повторном импорте).
 * Операционные данные не затрагиваются.
 */
export async function updatePositionSpec(
  db: Database,
  positionId: string,
  spec: PositionSpec,
): Promise<void> {
  await db.execute(
    `update bom_positions set
       row_no        = $2,
       code          = $3,
       manufacturer  = $4,
       name          = $5,
       model         = $6,
       unit          = $7,
       required_qty  = $8,
       reserved_qty  = $9,
       deadline      = $10,
       updated_at    = now(),
       version       = version + 1
     where position_id = $1`,
    [
      positionId,
      spec.rowNo,
      spec.code,
      spec.manufacturer,
      spec.name,
      spec.model,
      spec.unit,
      spec.requiredQty,
      spec.reservedQty,
      spec.deadline,
    ],
  );
}

/**
 * Обновить операционные поля.
 *
 * Передаются только те поля, которые нужно изменить; остальные сохраняются.
 * Так одна функция обслуживает и правку заказа снабженцем, и передачу
 * производству, и возврат из архива.
 */
export async function updateOperatingFields(
  db: Database,
  positionId: string,
  changes: OperatingChanges,
): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [positionId];

  const push = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (changes.orderedQty !== undefined) {
    push('ordered_qty', changes.orderedQty);
  }
  if (changes.expectedDate !== undefined) {
    push('expected_date', changes.expectedDate);
  }
  if (changes.realDeliveryQty !== undefined) {
    push('real_delivery_qty', changes.realDeliveryQty);
  }
  if (changes.realDeliveryDate !== undefined) {
    push('real_delivery_date', changes.realDeliveryDate);
  }
  if (changes.received !== undefined) {
    push('received', changes.received);
  }
  if (changes.receivedQty !== undefined) {
    push('received_qty', changes.receivedQty);
  }
  if (changes.receivedAt !== undefined) {
    push('received_at', changes.receivedAt);
  }
  if (changes.receivedBy !== undefined) {
    push('received_by', changes.receivedBy);
  }
  if (changes.lifecycle !== undefined) {
    push('lifecycle', changes.lifecycle);
  }

  if (!assignments.length) {
    return;
  }

  await db.execute(
    `update bom_positions set
       ${assignments.join(', ')},
       updated_at = now(),
       version    = version + 1
     where position_id = $1`,
    values,
  );
}

/** Число позиций по коду спецификации (для списка спецификаций). */
export async function countPositionsByBom(db: Database): Promise<Map<string, number>> {
  const rows = await db.query<{ code: string; total: number | string }>(
    `select b.code, count(p.id)::int as total
       from boms b
       left join bom_positions p on p.bom_id = b.id
      group by b.code`,
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.code, Number(row.total));
  }
  return counts;
}
