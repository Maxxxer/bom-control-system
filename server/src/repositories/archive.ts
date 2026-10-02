/**
 * Репозиторий архива переданных позиций (соответствует прежнему листу ARCHIVE).
 *
 * Запись попадает в архив в момент передачи позиции производству и хранит снимок
 * данных на этот момент: код спецификации, номер строки, артикул, наименование,
 * модель, единицу и переданное количество. Снимок нужен потому, что спецификация
 * может измениться или исчезнуть, а след передачи должен остаться.
 *
 * Архив — только добавление: записи не изменяются и не удаляются. Возврат из
 * архива фиксируется в истории позиции, а позиция снова становится активной.
 */

import type { Database } from '../db/Database.js';

export interface ArchiveEntry {
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
  receivedAt: Date;
  receivedBy: string;
  sourceUi: string;
  comment?: string;
}

export interface ArchiveRecord extends Omit<ArchiveEntry, 'receivedAt'> {
  id: number;
  receivedAt: string | null;
  createdAt: string;
}

interface ArchiveRow {
  id: string | number;
  position_id: string;
  bom_id: string;
  bom_name: string;
  row_no: number | string;
  code: string | null;
  manufacturer: string | null;
  name: string | null;
  model: string | null;
  unit: string | null;
  qty: number | string;
  received_at: Date | string | null;
  received_by: string | null;
  source_ui: string | null;
  comment: string | null;
  created_at: Date | string;
}

const ARCHIVE_COLUMNS = `
  id, position_id, bom_id, bom_name, row_no::float8 as row_no, code, manufacturer,
  name, model, unit, qty::float8 as qty, received_at, received_by, source_ui, comment, created_at
`;

function mapArchive(row: ArchiveRow): ArchiveRecord {
  return {
    id: Number(row.id),
    positionId: row.position_id,
    bomId: row.bom_id,
    bomName: row.bom_name,
    rowNo: Number(row.row_no),
    code: row.code ?? '',
    manufacturer: row.manufacturer ?? '',
    name: row.name ?? '',
    model: row.model ?? '',
    unit: row.unit ?? '',
    qty: Number(row.qty),
    receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
    receivedBy: row.received_by ?? '',
    sourceUi: row.source_ui ?? '',
    comment: row.comment ?? '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Добавить записи архива (одна или несколько передач). */
export async function insertArchive(
  db: Database,
  entries: readonly ArchiveEntry[],
): Promise<number> {
  if (!entries.length) {
    return 0;
  }
  const values: unknown[] = [];
  const tuples: string[] = [];
  entries.forEach((entry, index) => {
    const base = index * 14;
    tuples.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ` +
        `$${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, ` +
        `$${base + 13}, $${base + 14})`,
    );
    values.push(
      entry.positionId,
      entry.bomId,
      entry.bomName,
      entry.rowNo,
      entry.code,
      entry.manufacturer,
      entry.name,
      entry.model,
      entry.unit,
      entry.qty,
      entry.receivedAt,
      entry.receivedBy,
      entry.sourceUi,
      entry.comment ?? '',
    );
  });

  const rows = await db.query<{ id: string | number }>(
    `insert into archive (
       position_id, bom_id, bom_name, row_no, code, manufacturer,
       name, model, unit, qty, received_at, received_by, source_ui, comment
     ) values ${tuples.join(', ')}
     returning id`,
    values,
  );

  return rows.length;
}

/** Последние записи архива (свежие — сверху). */
export async function listArchive(db: Database, limit = 200): Promise<ArchiveRecord[]> {
  const rows = await db.query<ArchiveRow>(
    `select ${ARCHIVE_COLUMNS} from archive order by created_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map(mapArchive);
}

/** Записи архива по одной позиции (история передач этой позиции). */
export async function listArchiveByPosition(
  db: Database,
  positionId: string,
): Promise<ArchiveRecord[]> {
  const rows = await db.query<ArchiveRow>(
    `select ${ARCHIVE_COLUMNS} from archive
      where position_id = $1
      order by created_at desc, id desc`,
    [positionId],
  );
  return rows.map(mapArchive);
}
