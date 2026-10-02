/**
 * Чтение файла спецификации: из загруженного файла получается таблица строк.
 *
 * Поддерживаются три формата, с которыми работают на практике:
 *   * XLSX/XLSM (Excel) — обычная форма ведения спецификаций;
 *   * XLS — старый бинарный формат Excel (BIFF8), в котором хранится архив
 *     спецификаций предприятия. Читается отдельной библиотекой: это не zip-архив,
 *     а проприетарный формат, который обычный разбор XLSX не понимает;
 *   * CSV с разделителем `;` (мастер-формат прежней системы) или `,`.
 *
 * Разделитель определяется по первой строке: этим CSV из Excel (который всегда
 * сохраняется через `;` в русской локали) читается без дополнительных настроек.
 *
 * Файл НЕ разбирается на позиции здесь — только превращается в таблицу строк,
 * чтобы разбор колонок и правил остался в одном месте (`parseBomRows.ts`).
 */

import ExcelJS from 'exceljs';
import XLSX from 'xlsx';

import { LIMITS } from '../../domain/constants.js';
import { isoFromDate } from '../../domain/values.js';
import { ValidationError } from '../../errors.js';

/** Формат прочитанного файла. */
export type BomFileKind = 'xlsx' | 'xls' | 'csv';

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
  if (lower.endsWith('.xls')) {
    return 'xls';
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    return 'xlsx';
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return 'csv';
  }
  throw new ValidationError('Поддерживаются файлы .xls, .xlsx и .csv');
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
 * Привести ячейку старого .xls к тексту.
 *
 * Отдельная функция, а не переиспользование `cellToText`: ячейка SheetJS устроена
 * иначе (плоский объект с типом `t` и значением `v`), но результат обязан совпасть
 * с тем, что даёт ExcelJS для .xlsx — иначе одна и та же спецификация импортировалась
 * бы по-разному в зависимости от того, в каком формате её сохранили.
 */
function legacyCellToText(cell: unknown): string {
  if (cell === null || typeof cell !== 'object') {
    return '';
  }
  const value = cell as { t?: string; v?: unknown; w?: unknown };
  // Дата: приводим к тому же ISO-виду, что и у ExcelJS.
  if (value.t === 'd') {
    return value.v instanceof Date ? isoFromDate(value.v) ?? '' : '';
  }
  if (value.v === null || value.v === undefined) {
    return '';
  }
  if (typeof value.v === 'number' || typeof value.v === 'string' || typeof value.v === 'boolean') {
    return String(value.v);
  }
  // На всё прочее отдаём отформатированное представление, если библиотека его дала.
  return typeof value.w === 'string' ? value.w : '';
}

/**
 * Прочитать старый бинарный .xls (BIFF8) в таблицу строк.
 *
 * Берётся первый лист — так же, как для .xlsx, — и сразу превращается в обычные
 * строки. Дальше по коду разбор колонок не знает, из какого формата пришли данные:
 * это и делает .xls полноценным источником, а не особым случаем в логике импорта.
 */
/**
 * Сигнатура файла .xls: контейнер OLE2 (Compound File Binary Format).
 *
 * Настоящий .xls начинается этими восемью байтами. Проверка обязательна: разбор
 * `.xls` нарочно выполняется в «мягком» режиме — иначе библиотека на любом мусоре
 * (переименованный .txt, обрывок загрузки) создаёт пустой лист «Sheet1» и импорт
 * молча считается успешным. Сверка сигнатуры отделяет настоящий файл от всего
 * остального до разбора.
 */
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function readLegacyXls(buffer: Buffer): string[][] {
  if (buffer.length < OLE2_SIGNATURE.length || !buffer.subarray(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE)) {
    throw new ValidationError(
      'Файл не похож на старый Excel (.xls): проверьте, что файл не переименован ' +
        'и не повреждён. Новый формат сохраняется как .xlsx, табличный — как .csv',
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      // Даты приходят объектами Date — иначе даты приходят числами (дни от 1899),
      // и «01.10.2026» превратилось бы в «46295».
      cellDates: true,
      // Значение формулы важнее самой формулы — читаем и то и другое.
      cellFormula: true,
    });
  } catch {
    throw new ValidationError(
      'Не удалось прочитать файл .xls: проверьте, что файл не повреждён и не переименован',
    );
  }
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) {
    throw new ValidationError('В файле Excel нет ни одного листа');
  }
  const range = sheet['!ref'];
  if (!range) {
    throw new ValidationError('Файл .xls пуст: в нём нет ни одной ячейки');
  }

  let bounds: XLSX.Range;
  try {
    bounds = XLSX.utils.decode_range(range);
  } catch {
    throw new ValidationError('Файл .xls повреждён: не удалось определить диапазон листа');
  }

  const rows: string[][] = [];
  for (let row = bounds.s.r; row <= bounds.e.r; row += 1) {
    const cells: string[] = [];
    for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      cells.push(legacyCellToText(sheet[address]));
    }
    rows.push(cells);
  }
  return rows;
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
  if (kind === 'xls') {
    rawRows = readLegacyXls(buffer);
  } else if (kind === 'xlsx') {
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
