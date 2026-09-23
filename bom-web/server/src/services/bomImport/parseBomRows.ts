/**
 * Разбор строк спецификации в позиции (порт `v12ParseSourceRows` из
 * `v12_source.js`).
 *
 * Правила, которые важно сохранить:
 *   * строка без наименования в спецификацию не попадает — это разделитель или
 *     подпись, а не материал;
 *   * если колонки «№ п/п» нет, номером строки служит её позиция в файле;
 *   * позиции с незаполненными обязательными полями ИМПОРТИРУЮТСЯ — они попадают
 *     в систему как «Ошибка данных» и их можно исправить. Отбрасывать их нельзя:
 *     иначе экономист не увидит, что в исходной спецификации не хватает модели
 *     или крайнего срока, и дефицит по этим строкам просто исчезнет из отчётов.
 */

import { LIMITS } from '../../domain/constants.js';
import { buildMaterialKey, buildPositionId } from '../../domain/materialKeys.js';
import { toIsoDate, toNumber, trimmed } from '../../domain/values.js';
import { describeMissingFields, validatePosition } from '../../domain/validation.js';
import { ValidationError } from '../../errors.js';
import { resolveBomColumns, type BomColumnIndex } from './bomColumns.js';

/** Позиция, разобранная из файла (ещё не записанная в базу). */
export interface ParsedBomPosition {
  positionId: string;
  materialKey: string;
  rowNo: number;
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
  requiredQty: number;
  reservedQty: number;
  deadline: string | null;
  /** Номер строки в исходном файле (1 — шапка): нужен для сообщений о проблемах. */
  sourceLine: number;
}

/** Замечание по строке файла (не мешает импорту, но показывается человеку). */
export interface ImportIssue {
  sourceLine: number;
  name: string;
  reason: string;
}

export interface ParsedBom {
  positions: ParsedBomPosition[];
  /** Позиции с неполными данными: импортируются, но требуют правки спецификации. */
  incomplete: ImportIssue[];
  /** Строки без наименования: пропущены. */
  skipped: ImportIssue[];
  /** Найденные колонки — показываются в отчёте об импорте. */
  foundColumns: string[];
}

/** Прочитать ячейку как текст с ограничением длины. */
function cellText(cells: readonly string[], index: number): string {
  if (index < 0) {
    return '';
  }
  return trimmed(cells[index] ?? '');
}

/** Прочитать ячейку как количество. */
function cellQty(cells: readonly string[], index: number): number {
  if (index < 0) {
    return 0;
  }
  return toNumber(cells[index]);
}

/** Прочитать ячейку как дату (ISO или null). */
function cellDate(cells: readonly string[], index: number): string | null {
  if (index < 0) {
    return null;
  }
  return toIsoDate(cells[index]);
}

/** Описание найденных колонок для отчёта об импорте. */
function describeColumns(columns: BomColumnIndex): string[] {
  const labels: Array<[keyof BomColumnIndex, string]> = [
    ['rowNo', '№ п/п'],
    ['code', 'Артикул'],
    ['name', 'Наименование'],
    ['model', 'Модель'],
    ['unit', 'Ед.изм'],
    ['manufacturer', 'Производитель'],
    ['requiredQty', 'Кол-во'],
    ['reservedQty', 'Зарезервировано'],
    ['deadline', 'Крайний срок поставки'],
  ];
  return labels
    .filter(([key]) => columns[key] !== -1)
    .map(([, label]) => label);
}

/**
 * Разобрать таблицу строк в позиции спецификации.
 *
 * `bomCode` — код спецификации (имя файла без расширения): из него строится
 * идентификатор позиции, поэтому повторный импорт того же файла обновляет те же
 * позиции, а не создаёт новые.
 */
export function parseBomRows(params: { bomCode: string; rows: readonly string[][] }): ParsedBom {
  const { bomCode, rows } = params;
  if (rows.length < 2) {
    throw new ValidationError(
      'В файле нет данных: нужна шапка с колонками и хотя бы одна строка материала',
    );
  }

  const columns = resolveBomColumns(rows[0] ?? []);
  if (!columns) {
    throw new ValidationError(
      'Не найдены обязательные колонки «№ п/п» и «Наименование». ' +
        'Проверьте, что первая строка файла — шапка спецификации',
    );
  }

  const positions: ParsedBomPosition[] = [];
  const incomplete: ImportIssue[] = [];
  const skipped: ImportIssue[] = [];
  const takenIds = new Set<string>();

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index] ?? [];
    const sourceLine = index + 1;
    const name = cellText(cells, columns.name);
    if (!name) {
      skipped.push({ sourceLine, name: '', reason: 'Пустое наименование — строка пропущена' });
      continue;
    }

    const code = cellText(cells, columns.code);
    const manufacturer = cellText(cells, columns.manufacturer);
    const model = cellText(cells, columns.model);
    const unit = cellText(cells, columns.unit);
    const requiredQty = cellQty(cells, columns.requiredQty);
    const reservedQty = cellQty(cells, columns.reservedQty);
    const deadline = cellDate(cells, columns.deadline);
    const rowNo = columns.rowNo === -1 ? index : toNumber(cells[columns.rowNo]);

    const materialKey = buildMaterialKey({ code, manufacturer, name, model, unit });
    const positionId = buildPositionId(bomCode, materialKey, takenIds);

    const validation = validatePosition(
      { rowNo, code, manufacturer, name, model, unit, deadline },
      requiredQty,
    );
    if (!validation.valid) {
      incomplete.push({
        sourceLine,
        name,
        reason: `Не заполнено: ${describeMissingFields(validation.missing).join(', ')}`,
      });
    }

    positions.push({
      positionId,
      materialKey,
      rowNo,
      code,
      manufacturer,
      name,
      model,
      unit,
      requiredQty,
      reservedQty,
      deadline,
      sourceLine,
    });
  }

  if (!positions.length) {
    throw new ValidationError('В файле не найдено ни одной строки материала');
  }
  if (positions.length > LIMITS.MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `Позиций больше допустимого (${LIMITS.MAX_IMPORT_ROWS}). Разделите спецификацию`,
    );
  }

  return { positions, incomplete, skipped, foundColumns: describeColumns(columns) };
}
