/**
 * Чтение файла спецификации: из загруженного файла получается таблица строк.
 *
 * Поддерживаются оба формата, с которыми работают на практике:
 *   * XLSX (Excel) — обычная форма ведения спецификаций;
 *   * CSV с разделителем `;` (мастер-формат прежней системы) или `,`.
 *
 * Разделитель определяется по первой строке: этим CSV из Excel (который всегда
 * сохраняется через `;` в русской локали) читается без дополнительных настроек.
 *
 * Файл НЕ разбирается на позиции здесь — только превращается в таблицу строк,
 * чтобы разбор колонок и правил остался в одном месте (`parseBomRows.ts`).
 */

import ExcelJS from 'exceljs';

import { LIMITS } from '../../domain/constants.js';
import { isoFromDate } from '../../domain/values.js';
import { ValidationError } from '../../errors.js';

/** Формат прочитанного файла. */
export type BomFileKind = 'xlsx' | 'csv';

export interface ParsedBomFile {
  kind: BomFileKind;
  /** Строки файла: массив массивов ячеек, приведённых к тексту/числу. */
  rows: string[][];
  /** Количество строк, отброшенных как полностью пустые. */
  skippedEmptyRows: number;
}

/** Определить формат по имени файла. */
function detectKind(fileName: string): BomFileKind {
  const lower = String(fileName ?? '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    return 'xlsx';
  }
  if (lower.endsWith('.xls')) {
    throw new ValidationError(
      'Старый формат Excel (.xls) не поддерживается: сохраните файл как .xlsx или .csv',
    );
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return 'csv';
  }
  throw new ValidationError('Поддерживаются файлы .xlsx и .csv');
}

/** Привести значение ячейки Excel к тексту или числу. */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return isoFromDate(value) ?? '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const cell = value as {
      result?: unknown;
      text?: unknown;
      richText?: Array<{ text?: unknown }>;
      hyperlink?: unknown;
    };
    // Формула: важно её значение, а не сама формула.
    if (cell.result !== undefined) {
      return cellToText(cell.result);
    }
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => String(part?.text ?? '')).join('');
    }
    if (cell.text !== undefined) {
      return String(cell.text);
    }
  }
  return '';
}

/**
 * Разобрать текст CSV/DSV в таблицу.
 *
 * Учитываются кавычки: значение в кавычках может содержать разделитель и перевод
 * строки — иначе спецификации с описаниями вроде «кабель, экранированный»
 * разваливались бы на лишние колонки.
 */
export function parseDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      // Перенос строки завершает запись; \r\n считается одним переносом.
      if (char === '\r' && source[i + 1] === '\n') {
        i += 1;
      }
      row.push(cell.trim());
      cell = '';
      rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

/** Понять разделитель CSV по первой строке: где больше знаков — тот и разделитель. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  if (tabs > semicolons && tabs > commas) {
    return '\t';
  }
  return semicolons >= commas ? ';' : ',';
}

/** Отбросить полностью пустые строки (в конце файлов их обычно много). */
function dropEmptyRows(rows: string[][]): { rows: string[][]; skipped: number } {
  const kept: string[][] = [];
  let skipped = 0;
  for (const row of rows) {
    const hasValue = row.some((cell) => String(cell ?? '').trim() !== '');
    if (hasValue) {
      kept.push(row);
    } else {
      skipped += 1;
    }
  }
  return { rows: kept, skipped };
}

/** Прочитать загруженный файл в таблицу строк. */
export async function readBomFile(params: {
  fileName: string;
  contentBase64: string;
}): Promise<ParsedBomFile> {
  const kind = detectKind(params.fileName);
  const buffer = Buffer.from(String(params.contentBase64 ?? ''), 'base64');
  if (!buffer.length) {
    throw new ValidationError('Файл пуст или повреждён при загрузке');
  }
  if (buffer.length > LIMITS.MAX_IMPORT_BYTES) {
    const megabytes = Math.round(LIMITS.MAX_IMPORT_BYTES / (1024 * 1024));
    throw new ValidationError(`Файл больше ${megabytes} МБ — разбейте спецификацию на части`);
  }

  let rawRows: string[][];
  if (kind === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    try {
      // Типы exceljs описаны под прежнюю (не generic) форму Buffer из типов Node:
      // формально современный Buffer<ArrayBuffer> им не соответствует, хотя это
      // тот же объект. Приведение типа локально и не влияет на выполнение.
      const xlsxData = buffer as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0];
      await workbook.xlsx.load(xlsxData);
    } catch {
      throw new ValidationError('Не удалось прочитать файл Excel: проверьте, что это .xlsx');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new ValidationError('В файле Excel нет ни одного листа');
    }
    rawRows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const count = Math.max(row.cellCount, sheet.columnCount);
      for (let index = 1; index <= count; index += 1) {
        cells.push(cellToText(row.getCell(index).value));
      }
      rawRows.push(cells);
    });
  } else {
    const text = buffer.toString('utf8');
    rawRows = parseDelimitedText(text, detectDelimiter(text));
  }

  const { rows, skipped } = dropEmptyRows(rawRows);
  if (rows.length > LIMITS.MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `В файле ${rows.length} строк — больше допустимых ${LIMITS.MAX_IMPORT_ROWS}. Разделите спецификацию`,
    );
  }
  return { kind, rows, skippedEmptyRows: skipped };
}
