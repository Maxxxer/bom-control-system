/**
 * Распознавание колонок исходной спецификации (порт `v12ParseSourceRows`
 * и `v12FindHeader` из `v12_source.js`).
 *
 * Пользователи ведут спецификации годами, и заголовки в них исторически разные:
 * «Кол-во», «Количество», «Требуется». Поэтому для каждой колонки задан список
 * синонимов — импорт обязан читать и старые файлы, и новые, не требуя правки
 * исходников.
 *
 * Обязательны только «№ п/п» (или синоним) и «Наименование»: без них файл не
 * является спецификацией, и импорт честно сообщает об этом вместо того, чтобы
 * создать пустую запись.
 */

import { norm } from '../../domain/values.js';

/** Синонимы заголовков по колонкам. Порядок в списке — приоритет поиска. */
export const BOM_COLUMN_ALIASES = {
  rowNo: ['№ п/п', '№п/п', 'Строка', 'BOM_ROW', '№'],
  code: ['Артикул', 'Код', 'Код материала', 'CODE'],
  name: ['Наименование', 'Название', 'NAME'],
  model: ['Модель', 'MODEL'],
  unit: ['Ед.изм', 'Ед. изм', 'UNIT'],
  manufacturer: ['Производитель', 'Производитель (бренд)', 'MANUFACTURER', 'Произв.'],
  requiredQty: ['Кол-во', 'Количество', 'Требуется', 'REQUIRED', 'QTY'],
  reservedQty: ['Зарезервировано', 'RESERVED'],
  deadline: ['Крайний срок поставки', 'Крайний срок', 'Срок', 'DEADLINE'],
} as const;

/** Индексы колонок в прочитанной таблице (-1 — колонки нет). */
export interface BomColumnIndex {
  rowNo: number;
  code: number;
  name: number;
  model: number;
  unit: number;
  manufacturer: number;
  requiredQty: number;
  reservedQty: number;
  deadline: number;
}

/** Найти индекс колонки по списку синонимов (сначала точное совпадение). */
export function findHeaderIndex(headers: readonly string[], candidates: readonly string[]): number {
  const exact = headers.map((header) => String(header ?? '').trim());
  for (const candidate of candidates) {
    const index = exact.indexOf(candidate);
    if (index !== -1) {
      return index;
    }
  }
  const normalized = exact.map((header) => norm(header));
  for (const candidate of candidates) {
    const index = normalized.indexOf(norm(candidate));
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

/**
 * Определить индексы колонок шапки спецификации.
 *
 * Возвращает `null`, если обязательных колонок нет: это неспецификация, а не
 * ошибка в конкретной строке.
 */
export function resolveBomColumns(headers: readonly string[]): BomColumnIndex | null {
  const columns: BomColumnIndex = {
    rowNo: findHeaderIndex(headers, BOM_COLUMN_ALIASES.rowNo),
    code: findHeaderIndex(headers, BOM_COLUMN_ALIASES.code),
    name: findHeaderIndex(headers, BOM_COLUMN_ALIASES.name),
    model: findHeaderIndex(headers, BOM_COLUMN_ALIASES.model),
    unit: findHeaderIndex(headers, BOM_COLUMN_ALIASES.unit),
    manufacturer: findHeaderIndex(headers, BOM_COLUMN_ALIASES.manufacturer),
    requiredQty: findHeaderIndex(headers, BOM_COLUMN_ALIASES.requiredQty),
    reservedQty: findHeaderIndex(headers, BOM_COLUMN_ALIASES.reservedQty),
    deadline: findHeaderIndex(headers, BOM_COLUMN_ALIASES.deadline),
  };

  if (columns.rowNo === -1 || columns.name === -1) {
    return null;
  }
  return columns;
}
