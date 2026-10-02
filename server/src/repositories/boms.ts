/**
 * Репозиторий спецификаций (BOM).
 *
 * `code` — это идентификатор спецификации: в прежней системе им было имя файла
 * исходной спецификации без расширения, и на него ссылаются позиции, история и
 * архив. Поэтому код отделён от отображаемого имени и меняется только при
 * переименовании импортируемого файла.
 *
 * Признак «Выполнено» (`is_done`) заменяет прежний лист EXCLUDED_BOMS: он же
 * определяет, показывать ли спецификацию в активном списке дашборда.
 */

import type { Database } from '../db/Database.js';
import { isoFromDate } from '../domain/values.js';

export interface BomRecord {
  id: number;
  code: string;
  name: string;
  sourceNote: string;
  revision: number;
  isDone: boolean;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BomRow {
  id: string | number;
  code: string;
  name: string;
  source_note: string;
  revision: number | string;
  is_done: boolean;
  done_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const BOM_COLUMNS =
  'id, code, name, source_note, revision, is_done, done_at, created_at, updated_at';

function mapBom(row: BomRow): BomRecord {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    sourceNote: row.source_note,
    revision: Number(row.revision),
    isDone: row.is_done === true,
    doneAt: row.done_at ? new Date(row.done_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Все спецификации, свежие — сверху. */
export async function listBoms(db: Database): Promise<BomRecord[]> {
  const rows = await db.query<BomRow>(
    `select ${BOM_COLUMNS} from boms order by updated_at desc, code asc`,
  );
  return rows.map(mapBom);
}

/** Найти спецификацию по идентификатору записи. */
export async function findBomById(db: Database, id: number): Promise<BomRecord | null> {
  const rows = await db.query<BomRow>(`select ${BOM_COLUMNS} from boms where id = $1`, [id]);
  const row = rows[0];
  return row ? mapBom(row) : null;
}

/** Найти спецификацию по коду (имя исходного файла без расширения). */
export async function findBomByCode(db: Database, code: string): Promise<BomRecord | null> {
  const rows = await db.query<BomRow>(`select ${BOM_COLUMNS} from boms where code = $1`, [code]);
  const row = rows[0];
  return row ? mapBom(row) : null;
}

/**
 * Создать спецификацию или вернуть существующую с тем же кодом.
 *
 * Повторный импорт того же файла не должен создавать вторую запись — иначе
 * появятся две спецификации с одинаковым кодом и разными позициями.
 */
export async function upsertBom(
  db: Database,
  params: { code: string; name: string; sourceNote?: string; actor?: string },
): Promise<BomRecord> {
  const rows = await db.query<BomRow>(
    `insert into boms (code, name, source_note, created_by)
     values ($1, $2, $3, $4)
     on conflict (code) do update set
       name        = excluded.name,
       source_note = excluded.source_note,
       updated_at  = now()
     returning ${BOM_COLUMNS}`,
    [params.code, params.name, params.sourceNote ?? '', params.actor ?? ''],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Не удалось сохранить спецификацию ${params.code}`);
  }
  return mapBom(row);
}

/** Отметить новую ревизию спецификации (при переимпорте). */
export async function bumpRevision(db: Database, id: number): Promise<number> {
  const rows = await db.query<{ revision: number | string }>(
    `update boms set revision = revision + 1, updated_at = now()
      where id = $1
      returning revision`,
    [id],
  );
  return Number(rows[0]?.revision ?? 1);
}

/** Отметить «Выполнено» либо снять отметку. */
export async function setBomDone(
  db: Database,
  id: number,
  done: boolean,
): Promise<BomRecord | null> {
  const rows = await db.query<BomRow>(
    `update boms set
       is_done    = $2,
       done_at    = case when $2 then now() else null end,
       updated_at = now()
     where id = $1
     returning ${BOM_COLUMNS}`,
    [id, done],
  );
  const row = rows[0];
  return row ? mapBom(row) : null;
}

/**
 * Даты создания спецификаций: код → дата в формате `ГГГГ-ММ-ДД`.
 *
 * Возвращается именно ДАТА (без времени), как и все даты в API: это «дата
 * создания спецификации», она показывается человеку и сравнивается со сроками.
 * Приведение к местной дате выполняется здесь, поэтому интерфейсу не приходится
 * угадывать часовой пояс.
 */
export async function bomCreatedDates(db: Database): Promise<Map<string, string | null>> {
  const rows = await db.query<{ code: string; created_at: Date | string }>(
    `select code, created_at from boms`,
  );
  const dates = new Map<string, string | null>();
  for (const row of rows) {
    dates.set(row.code, isoFromDate(new Date(row.created_at)));
  }
  return dates;
}

/** Коды спецификаций, отмеченных выполненными (исключаются из дашборда). */
export async function doneBomCodes(db: Database): Promise<Set<string>> {
  const rows = await db.query<{ code: string }>(`select code from boms where is_done = true`);
  return new Set(rows.map((row) => row.code));
}
