/**
 * Репозиторий истории позиции (соответствует прежнему листу MATERIAL_HISTORY).
 *
 * Это «жизненный путь» позиции: заказ, ожидаемая дата, поставка, передача
 * производству, возврат в работу. В отличие от журнала действий, история
 * привязана к позиции и показывается человеку прямо в карточке материала, а
 * также попадает в архив при передаче.
 */

import type { Database } from '../db/Database.js';

/** Событие истории позиции. */
export interface HistoryEntry {
  positionId: string;
  event: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  actor: string;
  comment?: string;
}

export interface HistoryRecord {
  id: number;
  positionId: string;
  event: string;
  oldValue: string;
  newValue: string;
  actor: string;
  comment: string;
  createdAt: string;
}

interface HistoryRow {
  id: string | number;
  position_id: string;
  event: string;
  old_value: string | null;
  new_value: string | null;
  actor: string | null;
  comment: string | null;
  created_at: Date | string;
}

const HISTORY_COLUMNS = `
  id, position_id, event, old_value, new_value, actor, comment, created_at
`;

/** Значение приводится к тексту: история читается человеком. */
function asText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function mapHistory(row: HistoryRow): HistoryRecord {
  return {
    id: Number(row.id),
    positionId: row.position_id,
    event: row.event,
    oldValue: row.old_value ?? '',
    newValue: row.new_value ?? '',
    actor: row.actor ?? '',
    comment: row.comment ?? '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Записать события истории одним запросом. */
export async function insertHistory(
  db: Database,
  entries: readonly HistoryEntry[],
): Promise<number> {
  if (!entries.length) {
    return 0;
  }
  const values: unknown[] = [];
  const tuples: string[] = [];
  entries.forEach((entry, index) => {
    const base = index * 7;
    tuples.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
    );
    values.push(
      entry.positionId,
      entry.event,
      asText(entry.oldValue),
      asText(entry.newValue),
      entry.actor,
      entry.comment ?? '',
      new Date(),
    );
  });

  const rows = await db.query<{ id: string | number }>(
    `insert into position_history (
       position_id, event, old_value, new_value, actor, comment, created_at
     ) values ${tuples.join(', ')}
     returning id`,
    values,
  );
  return rows.length;
}

/** История одной позиции (свежие события — сверху). */
export async function listHistory(
  db: Database,
  positionId: string,
  limit = 100,
): Promise<HistoryRecord[]> {
  const rows = await db.query<HistoryRow>(
    `select ${HISTORY_COLUMNS} from position_history
      where position_id = $1
      order by created_at desc, id desc
      limit $2`,
    [positionId, limit],
  );
  return rows.map(mapHistory);
}
