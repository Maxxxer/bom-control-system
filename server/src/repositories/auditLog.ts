/**
 * Репозиторий журнала действий (соответствует прежнему AUDIT_LOG).
 *
 * Каждая значимая операция оставляет след: кто, что, у какой позиции, старое и
 * новое значение, причина. Операции внутри одной команды (например, передача
 * сразу нескольких позиций) помечаются общим `operation_id`, поэтому по журналу
 * видно, что они сделаны одним нажатием.
 *
 * Журнал — только добавление. Записи никогда не изменяются и не удаляются.
 */

import type { Database } from '../db/Database.js';

/** Событие, попавшее в журнал. */
export interface AuditEntry {
  operationId: string;
  actor: string;
  action: string;
  bomId?: string;
  positionId?: string;
  field?: string;
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
  reason?: string;
}

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

interface AuditRow {
  id: string | number;
  operation_id: string;
  actor: string | null;
  action: string;
  bom_id: string | null;
  position_id: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  created_at: Date | string;
}

/**
 * Привести значение к тексту для журнала и истории.
 *
 * Журнал и история читаются человеком и не участвуют в расчётах, поэтому
 * значения хранятся строками: так в одной записи уживаются число, дата и флаг.
 */
export function formatLogValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'да' : 'нет';
  }
  return String(value);
}

const AUDIT_COLUMNS = `
  id, operation_id, actor, action, bom_id, position_id, field,
  old_value, new_value, reason, created_at
`;

function mapAudit(row: AuditRow): AuditRecord {
  return {
    id: Number(row.id),
    operationId: row.operation_id,
    actor: row.actor ?? '',
    action: row.action,
    bomId: row.bom_id ?? '',
    positionId: row.position_id ?? '',
    field: row.field ?? '',
    oldValue: row.old_value ?? '',
    newValue: row.new_value ?? '',
    reason: row.reason ?? '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Записать события журнала одним запросом (в порядке перечисления). */
export async function insertAudit(
  db: Database,
  entries: readonly AuditEntry[],
): Promise<number> {
  if (!entries.length) {
    return 0;
  }
  const values: unknown[] = [];
  const tuples: string[] = [];
  entries.forEach((entry, index) => {
    const base = index * 10;
    tuples.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`,
    );
    values.push(
      entry.operationId,
      entry.actor,
      entry.action,
      entry.bomId ?? '',
      entry.positionId ?? '',
      entry.field ?? '',
      formatLogValue(entry.oldValue),
      formatLogValue(entry.newValue),
      entry.reason ?? '',
      new Date(),
    );
  });

  const rows = await db.query<{ id: string | number }>(
    `insert into audit_log (
       operation_id, actor, action, bom_id, position_id, field,
       old_value, new_value, reason, created_at
     ) values ${tuples.join(', ')}
     returning id`,
    values,
  );
  return rows.length;
}

/** Последние события журнала (свежие — сверху). */
export async function listAudit(
  db: Database,
  options: { limit?: number; positionId?: string; bomId?: string } = {},
): Promise<AuditRecord[]> {
  const limit = options.limit ?? 200;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.positionId) {
    values.push(options.positionId);
    conditions.push(`position_id = $${values.length}`);
  }
  if (options.bomId) {
    values.push(options.bomId);
    conditions.push(`bom_id = $${values.length}`);
  }
  values.push(limit);

  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const rows = await db.query<AuditRow>(
    `select ${AUDIT_COLUMNS} from audit_log
      ${where}
      order by created_at desc, id desc
      limit $${values.length}`,
    values,
  );
  return rows.map(mapAudit);
}

/** Все события одной операции (например, одной отправки лота отборки). */
export async function listAuditByOperation(
  db: Database,
  operationId: string,
): Promise<AuditRecord[]> {
  const rows = await db.query<AuditRow>(
    `select ${AUDIT_COLUMNS} from audit_log
      where operation_id = $1
      order by id asc`,
    [operationId],
  );
  return rows.map(mapAudit);
}
