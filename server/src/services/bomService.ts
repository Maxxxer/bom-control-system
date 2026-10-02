/**
 * Спецификации: импорт, список, карточка и отметка «Выполнено».
 *
 * Гибридная схема наполнения: спецификация попадает в систему либо файлом
 * (Excel/CSV), либо вводом вручную — во втором случае создаётся минимальная
 * спецификация, а позиции добавляются через правку. Оба пути ведут к одной и той
 * же структуре, поэтому дальше система работает с ними одинаково.
 *
 * Код спецификации берётся из имени файла без расширения: так повторная загрузка
 * обновляет ту же спецификацию, а не создаёт двойника.
 */

import type { Database } from '../db/Database.js';
import { bomStatusPresentation, computeBomStatus, isBomReadyForDone } from '../domain/bomStatus.js';
import { LIMITS } from '../domain/constants.js';
import { aggregateBomStates } from '../domain/dashboard.js';
import type { BomAggregate } from '../domain/projectionTypes.js';
import type { Position } from '../domain/position.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import {
  findBomByCode,
  listBoms,
  setBomDone,
  type BomRecord,
} from '../repositories/boms.js';
import { countPositionsByBom, listPositionsByBom } from '../repositories/positions.js';
import { deletePositionsByPositionIds } from '../repositories/positions.js';
import { AUDIT_ACTION, recordChanges, type OperationContext } from './operationLog.js';
import { readBomFile } from './bomImport/parseBomFile.js';
import { parseBomRows } from './bomImport/parseBomRows.js';
import { applyParsedBom, type BomImportSummary } from './bomImport/syncBom.js';

/** Строка списка спецификаций. */
export interface BomListItem extends BomRecord {
  positionCount: number;
}

/** Отчёт об импорте, который показывается пользователю. */
export interface BomImportReport {
  bomCode: string;
  bomName: string;
  created: boolean;
  revision: number;
  inserted: number;
  updated: number;
  deleted: number;
  markedRemoved: number;
  totalInFile: number;
  foundColumns: string[];
  /** Строки с неполными данными: импортированы, но требуют правки спецификации. */
  incomplete: Array<{ sourceLine: number; name: string; reason: string }>;
  /** Строки без наименования: пропущены. */
  skipped: Array<{ sourceLine: number; name: string; reason: string }>;
  /** Файл пустых строк в конце (обычное дело в Excel). */
  skippedEmptyRows: number;
}

/** Разобрать имя файла в код и отображаемое имя спецификации. */
export function bomCodeFromFileName(fileName: string): string {
  const base = String(fileName ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^./\\]+$/, '')
    .trim();
  if (!base) {
    throw new ValidationError('Не удалось определить имя спецификации из имени файла');
  }
  return base.slice(0, LIMITS.MAX_TEXT_LENGTH);
}

/** Список спецификаций с числом позиций. */
export async function listBomsWithCounts(db: Database): Promise<BomListItem[]> {
  const [boms, counts] = await Promise.all([listBoms(db), countPositionsByBom(db)]);
  return boms.map((bom) => ({ ...bom, positionCount: counts.get(bom.code) ?? 0 }));
}

/** Карточка спецификации: данные, позиции и сводка по ней. */
export async function getBomCard(
  db: Database,
  bomCode: string,
): Promise<{
  bom: BomRecord;
  positions: Position[];
  aggregate: BomAggregate;
  statusText: string;
}> {
  const bom = await findBomByCode(db, bomCode);
  if (!bom) {
    throw new NotFoundError(`Спецификация «${bomCode}» не найдена`);
  }
  const positions = await listPositionsByBom(db, bomCode);
  const aggregate = aggregateBomStates(positions).get(bomCode);
  if (!aggregate) {
    throw new NotFoundError(`У спецификации «${bomCode}» нет позиций`);
  }
  return {
    bom,
    positions,
    aggregate,
    statusText: bomStatusPresentation(computeBomStatus(aggregate)).text,
  };
}

/**
 * Импортировать спецификацию из загруженного файла.
 *
 * Порядок шагов: прочитать файл → разобрать строки → записать в базу. Ошибки
 * чтения и разбора возвращаются пользователю как понятные сообщения, а не как
 * «внутренняя ошибка сервера».
 */
export async function importBomFromFile(
  db: Database,
  ctx: OperationContext,
  params: { fileName: string; contentBase64: string },
): Promise<BomImportReport> {
  const bomCode = bomCodeFromFileName(params.fileName);
  const file = await readBomFile(params);
  const parsed = parseBomRows({ bomCode, rows: file.rows });
  const summary: BomImportSummary = await applyParsedBom(db, ctx, {
    bomCode,
    bomName: bomCode,
    sourceNote: `${params.fileName} (${file.kind.toUpperCase()})`,
    parsed,
  });

  return {
    bomCode: summary.bom.code,
    bomName: summary.bom.name,
    created: summary.created,
    revision: summary.bom.revision,
    inserted: summary.inserted,
    updated: summary.updated,
    deleted: summary.deleted,
    markedRemoved: summary.markedRemoved,
    totalInFile: parsed.positions.length,
    foundColumns: parsed.foundColumns,
    incomplete: parsed.incomplete,
    skipped: parsed.skipped,
    skippedEmptyRows: file.skippedEmptyRows,
  };
}

/**
 * Отметить спецификацию «Выполнено» или вернуть её в работу.
 *
 * Отметить выполненной можно только полностью собранную спецификацию: иначе
 * «Выполнено» скрывало бы незакрытые позиции. Снять отметку можно всегда — это
 * возврат проекта в работу, и он не требует условий.
 */
export async function setBomCompletion(
  db: Database,
  ctx: OperationContext,
  params: { bomCode: string; done: boolean },
): Promise<BomRecord> {
  const bom = await findBomByCode(db, params.bomCode);
  if (!bom) {
    throw new NotFoundError(`Спецификация «${params.bomCode}» не найдена`);
  }
  if (bom.isDone === params.done) {
    return bom;
  }

  if (params.done) {
    const positions = await listPositionsByBom(db, params.bomCode);
    const aggregate = aggregateBomStates(positions).get(params.bomCode);
    if (!aggregate) {
      throw new ConflictError('В спецификации нет позиций — отмечать нечего');
    }
    if (!isBomReadyForDone(aggregate)) {
      throw new ConflictError(
        'Отметить «Выполнено» можно только когда все позиции переданы производству',
      );
    }
  }

  return db.transaction(async (tx) => {
    const updated = await setBomDone(tx, bom.id, params.done);
    if (!updated) {
      throw new NotFoundError(`Спецификация «${params.bomCode}» не найдена`);
    }
    await recordChanges(tx, ctx, [
      {
        action: params.done ? AUDIT_ACTION.BOM_DONE : AUDIT_ACTION.BOM_RETURNED,
        bomId: bom.code,
        field: 'Выполнено',
        oldValue: bom.isDone,
        newValue: params.done,
        reason: params.done ? 'Проект завершён' : 'Проект возвращён в работу',
      },
    ]);
    return updated;
  });
}

/**
 * Удалить спецификацию вместе с позициями.
 *
 * Архив, история и журнал НЕ удаляются: следы переданных материалов должны
 * сохраняться независимо от того, что стало с самой спецификацией.
 */
export async function deleteBom(
  db: Database,
  ctx: OperationContext,
  bomCode: string,
): Promise<{ deletedPositions: number }> {
  const bom = await findBomByCode(db, bomCode);
  if (!bom) {
    throw new NotFoundError(`Спецификация «${bomCode}» не найдена`);
  }

  return db.transaction(async (tx) => {
    const positions = await listPositionsByBom(tx, bomCode);
    const deletedPositions = await deletePositionsByPositionIds(
      tx,
      positions.map((position) => position.positionId),
    );
    await tx.execute(`delete from boms where code = $1`, [bomCode]);
    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.BOM_IMPORT,
        bomId: bomCode,
        field: 'BOM_DELETED',
        oldValue: `${positions.length} поз.`,
        newValue: 'удалена',
        reason: 'Спецификация удалена вместе с позициями',
      },
    ]);
    return { deletedPositions };
  });
}
