/**
 * Разбор и сборка табличного текста — того, что Excel кладёт в буфер обмена.
 *
 * Формат: ячейки разделены табуляцией, строки — переводом строки. Если внутри
 * ячейки встречается табуляция, перевод строки или кавычка, Excel заворачивает
 * такую ячейку в кавычки и удваивает кавычки внутри (`"` → `""`). Именно поэтому
 * здесь не «split по табуляции», а разборщик: наименование материала с кавычкой
 * («Кабель "витая пара"») при наивном разборе развалило бы всю вставку и сдвинуло
 * значения по строкам — то есть записало бы чужие количества в чужие позиции.
 *
 * Зачем вообще кавычки, если мы копируем только числа и даты: пользователь копирует
 * из своей таблицы, а не из нашей, и там в блоке рядом с количеством спокойно может
 * оказаться текст с кавычками. Разбирать надо то, что реально лежит в буфере.
 */

/** Размер блока (сколько строк и колонок пришло из буфера). */
export interface BlockSize {
  rows: number;
  columns: number;
}

/**
 * Разобрать текст из буфера обмена в матрицу ячеек.
 *
 * Пустой текст даёт пустой блок: вставлять нечего, и вызывающий код об этом узнает
 * по нулевой длине, а не по «блоку из одной пустой ячейки».
 */
export function parseGridText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index] as string;

    if (quoted) {
      if (char === '"') {
        // Две кавычки подряд — это одна кавычка внутри значения.
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === '\t') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      // Windows-перевод строки — один разделитель, а не два.
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Excel завершает скопированный блок переводом строки. Если после последнего
  // разделителя ничего не накопилось, лишнюю пустую строку НЕ добавляем: иначе в
  // конце вставки появилась бы пустая строка и сдвинула бы отчёт.
  if (field !== '' || row.length > 0) {
    endRow();
  }

  return rows;
}

/** Значение, которое нужно взять в кавычки (иначе оно «развалит» блок). */
function quoteCell(value: string): string {
  return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Собрать матрицу в текст для буфера обмена (Excel понимает его как таблицу). */
export function serializeGridText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quoteCell).join('\t')).join('\r\n');
}

/** Сколько строк и колонок в блоке. */
export function blockSize(block: readonly (readonly string[])[]): BlockSize {
  const columns = block.reduce((max, row) => Math.max(max, row.length), 0);
  return { rows: block.length, columns };
}

/** Значение ячейки блока или пустая строка, если колонок в строке меньше. */
export function blockValue(block: readonly (readonly string[])[], row: number, column: number): string {
  return block[row]?.[column] ?? '';
}
