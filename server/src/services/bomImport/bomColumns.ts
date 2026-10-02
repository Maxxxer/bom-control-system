/**
 * Распознавание колонок исходной спецификации.
 *
 * Реальные файлы предприятия написаны людьми и десятилетиями, поэтому заголовки в
 * них исторически разные. По настоящим образцам предприятия:
 *
 *   Описание №2208-2211 | Модель       | Произв-тель | Артикул | ед.изм | К-во
 *   Наименование 2206   | Модель       | Производитель| Артикул | Кол-во
 *   Наименование 2206   | Обозначение  | К-ВО
 *
 * Отсюда три особенности, которые этот модуль обязан учитывать:
 *
 *   1. Обязателен только «Наименование» (и его варианты). Колонки «№ п/п» в
 *      боевых файлах нет вообще, и требовать её значило отвергать весь файл —
 *      номер строки тогда просто берётся по порядку в файле.
 *   2. Заголовок может быть длиннее синонима («Наименование 2206»), поэтому
 *      совпадение ищется и по началу строки. Одновременно совпадение, под которое
 *      подходят сразу две колонки («Наименование» и «Наименование позиции
 *      производителя»), не принимается: лучше не угадать и показать это в отчёте,
 *      чем молча приписать колонку не тому полю.
 *   3. Разделители в словах несут ничего: `К-во`, `К-ВО`, `Кол-во`, `Кол-во, шт`
 *      — это одна и та же колонка. Для сравнения заголовки сводятся к буквам и
 *      цифрам без разделителей и пробелов.
 *
 * Колонки, которые не сопоставлены ни с одним полем, возвращаются отдельно:
 * импорт показывает их в отчёте, чтобы человек увидел, что данные не потерялись
 * молча.
 */

import { norm } from '../../domain/values.js';

/**
 * Синонимы заголовков по колонкам. Порядок в списке — приоритет поиска.
 *
 * Список дополнен вариантами из настоящих файлов предприятия: сокращения
 * («Произв-тель», «К-во», «К-ВО», «Обозначение») и названия, которыми те же поля
 * подписаны в соседних системах.
 */
export const BOM_COLUMN_ALIASES = {
  rowNo: ['№ п/п', '№п/п', '№ позиции', '№ по спецификации', 'п/п', 'Строка', 'BOM_ROW'],
  code: ['Артикул', 'Арт', 'Арт.', 'Код', 'Код материала', 'Артикул производителя', 'CODE'],
  name: [
    'Наименование',
    'Наименование изделия',
    'Наименование материала',
    'Описание',
    'Название',
    'Номенклатура',
    'Наименование позиции',
    'NAME',
    'ITEM',
  ],
  model: ['Модель', 'Обозначение', 'Обозначение изделия', 'Тип', 'Тип изделия', 'MODEL', 'PART'],
  unit: ['Ед.изм', 'Ед. изм', 'Ед.изм.', 'Единица измерения', 'Единица', 'Ед', 'UNIT'],
  manufacturer: [
    'Производитель',
    'Производитель (бренд)',
    'Произв-тель',
    'Произв.',
    'Бренд',
    'Поставщик',
    'MANUFACTURER',
    'MAKER',
  ],
  requiredQty: [
    'Кол-во',
    'Кол-во, шт',
    'Кол-во (шт)',
    'К-во',
    'К-ВО',
    'Количество',
    'Кол-во требуется',
    'Требуется',
    'REQUIRED',
    'QTY',
  ],
  reservedQty: ['Зарезервировано', 'Резерв', 'Зарезервировано, шт', 'RESERVED'],
  deadline: [
    'Крайний срок поставки',
    'Крайний срок',
    'Срок поставки',
    'Срок',
    'Дата поставки',
    'Необходимо направить',
    'DEADLINE',
  ],
} as const;

/** Поля спецификации в том порядке, в котором перебираются заголовки. */
export const BOM_COLUMN_KEYS = [
  'rowNo',
  'code',
  'name',
  'model',
  'unit',
  'manufacturer',
  'requiredQty',
  'reservedQty',
  'deadline',
] as const;

export type BomColumnKey = (typeof BOM_COLUMN_KEYS)[number];

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

/** Найденные колонки и заголовки, которые остались нераспознанными. */
export interface ResolvedBomColumns {
  columns: BomColumnIndex;
  /** Заголовки колонок файла, не сопоставленные ни с одним полем. */
  ignored: string[];
}

/**
 * Свести заголовок к буквам и цифрам: `К-во` → `кво`, `Кол-во` → `колво`,
 * `№ п/п` → `пп`, `ед.изм` → `едизм`.
 *
 * Смысл: разделители, знаки номера и пробелы в заголовках ставятся произвольно, а
 * смысл слова — нет. Сравнение по такой форме делает «К-во» и «К-ВО» одним и тем
 * же заголовком, не заставляя перечислять каждую опечатку вручную.
 */
function canonical(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '');
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
 * Найти колонку по совпадению начала строки: `Наименование 2206` → «Наименование».
 *
 * Возвращает -1, если под заголовок подходит сразу несколько синонимов: такой
 * случай означает, что колонку невозможно определить однозначно, и угадывать
 * опаснее, чем показать её в отчёте как нераспознанную.
 */
function findHeaderIndexByPrefix(
  headers: readonly string[],
  candidates: readonly string[],
): number {
  const forms = headers.map((header) => canonical(String(header ?? '')));
  let found = -1;
  for (const candidate of candidates) {
    const form = canonical(candidate);
    // Короткие синонимы дают случайные совпадения («Модель» ⊂ «Моделирование»),
    // поэтому по началу строки ищем только по существенному началу слова.
    if (form.length < 4) {
      continue;
    }
    for (let index = 0; index < forms.length; index += 1) {
      if (forms[index] === form || !forms[index]?.startsWith(form)) {
        continue;
      }
      if (found !== -1 && found !== index) {
        return -1;
      }
      found = index;
    }
  }
  return found;
}

/**
 * Определить индексы колонок шапки спецификации.
 *
 * Возвращает `null`, если не найдено «Наименование»: это неспецификация, а не
 * ошибка в конкретной строке. Остальные колонки необязательны — в боевых файлах
 * их часть просто отсутствует, и импорт всё равно полезен.
 */
export function resolveBomColumns(headers: readonly string[]): BomColumnIndex | null {
  return resolveBomColumnsWithIgnored(headers)?.columns ?? null;
}

/**
 * То же, что `resolveBomColumns`, но дополнительно возвращает нераспознанные
 * колонки — импорт показывает их в отчёте.
 */
export function resolveBomColumnsWithIgnored(headers: readonly string[]): ResolvedBomColumns | null {
  const text = headers.map((header) => String(header ?? '').trim());
  const columns = Object.fromEntries(
    BOM_COLUMN_KEYS.map((key) => [key, -1]),
  ) as unknown as BomColumnIndex;

  const taken = new Set<number>();
  const assign = (key: BomColumnKey, index: number): void => {
    if (index !== -1 && !taken.has(index)) {
      columns[key] = index;
      taken.add(index);
    }
  };

  // Первый проход — точные совпадения: они всегда надёжнее догадок по началу.
  for (const key of BOM_COLUMN_KEYS) {
    assign(key, findHeaderIndex(text, BOM_COLUMN_ALIASES[key]));
  }

  // Второй проход — совпадение по началу, только для ещё не найденных колонок.
  for (const key of BOM_COLUMN_KEYS) {
    if (columns[key] === -1) {
      assign(key, findHeaderIndexByPrefix(text, BOM_COLUMN_ALIASES[key]));
    }
  }

  if (columns.name === -1) {
    return null;
  }

  const ignored = text.filter(
    (header, index) => header !== '' && !taken.has(index),
  );
  return { columns, ignored };
}