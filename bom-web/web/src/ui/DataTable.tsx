/**
 * Таблица данных с сортировкой по столбцам и липкими первыми колонками.
 *
 * Все рабочие экраны устроены одинаково: строки, столбцы, сортировка по щелчку на
 * заголовке. Поэтому таблица описана один раз — экран лишь перечисляет столбцы и
 * говорит, как отрисовать значение.
 *
 * Сортировка выполняется на клиенте: строк в витрине сотни, они уже загружены, а
 * мгновенный отклик на щелчок важнее экономии трафика.
 *
 * Про липкие колонки. Спецификация — широкая таблица: колонок много, и при
 * горизонтальной прокрутке «№» и «Материал» уезжают вместе с содержимым, так что
 * строка теряет опознаваемость. Поэтому первым колонкам можно включить
 * `sticky` — они остаются на месте, а остальные прокручиваются под ними.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

export interface Column<Row> {
  /** Устойчивый ключ столбца. */
  key: string;
  title: string;
  /** Значение для сортировки; если не задано — столбец не сортируется. */
  sortValue?: (row: Row) => string | number;
  /** Как показать значение. */
  render: (row: Row) => ReactNode;
  /** Числовой столбец: выравнивание вправо и моноширинный шрифт. */
  numeric?: boolean;
  width?: string;
  /**
   * Колонка прилипает к левому краю при горизонтальной прокрутке.
   *
   * Липкими могут быть только первые колонки, по порядку и без пропусков: если
   * оставить «щель», в неё будет видно уезжающее содержимое. Требуется ширина в
   * пикселях — по ней считается смещение следующей липкой колонки.
   */
  sticky?: boolean;
}

interface DataTableProps<Row> {
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyText?: string;
  /** Подсветка строки (например, цветом состояния из прежней системы). */
  rowBackground?: (row: Row) => string | undefined;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

/** Ширина колонки в пикселях: нужна для расчёта смещения липких колонок. */
function widthInPixels(width: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(String(width ?? '').trim());
  return match ? Number(match[1]) : 0;
}

/**
 * Общая ширина таблицы, когда ширины заданы у всех колонок.
 *
 * Ноль означает «ширины известны не все»: тогда таблица раскладывается браузером
 * и жёсткая раскладка не применяется — иначе колонки без ширины схлопнулись бы.
 */
function declaredWidthOf<Row>(columns: Array<Column<Row>>): number {
  let total = 0;
  for (const column of columns) {
    const width = widthInPixels(column.width);
    if (!width) {
      return 0;
    }
    total += width;
  }
  return total;
}

/**
 * Смещения липких колонок от левого края.
 *
 * Обход прекращается на первой нелипкой колонке: липкий «островок» в середине
 * таблицы бессмысленен — под ним всё равно прокручивается содержимое.
 */
function stickyOffsetsOf<Row>(columns: Array<Column<Row>>): Map<string, number> {
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const column of columns) {
    if (!column.sticky) {
      break;
    }
    offsets.set(column.key, offset);
    offset += widthInPixels(column.width);
  }
  return offsets;
}

/** Стиль ячейки: липкой колонке нужно ещё и смещение от края. */
function cellStyle(width: string | undefined, offset: number | undefined): CSSProperties | undefined {
  if (offset === undefined) {
    return width ? { width } : undefined;
  }
  return { width, left: `${offset}px` };
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  emptyText = 'Нет данных',
  rowBackground,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState>(null);

  const sortedRows = useMemo(() => {
    if (!sort) {
      return rows;
    }
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) {
      return rows;
    }
    const getValue = column.sortValue;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = getValue(left);
      const b = getValue(right);
      if (typeof a === 'number' && typeof b === 'number') {
        return (a - b) * factor;
      }
      return String(a).localeCompare(String(b), 'ru') * factor;
    });
  }, [rows, columns, sort]);

  const stickyOffsets = useMemo(() => stickyOffsetsOf(columns), [columns]);
  // Ширины всех колонок известны → таблица получает точную ширину, а раскладка
  // становится жёсткой: объявленные ширины совпадают с фактическими, и смещения
  // липких колонок точны.
  const tableWidth = useMemo(() => declaredWidthOf(columns), [columns]);

  const toggleSort = (key: string): void => {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' };
      }
      return current.direction === 'asc' ? { key, direction: 'desc' } : null;
    });
  };

  if (!rows.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="table-scroll">
      <table
        className={tableWidth ? 'data fixed' : 'data'}
        style={tableWidth ? { width: `${tableWidth}px` } : undefined}
      >
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = sort?.key === column.key;
              const arrow = isSorted ? (sort?.direction === 'asc' ? ' ↑' : ' ↓') : '';
              const offset = stickyOffsets.get(column.key);
              return (
                <th
                  key={column.key}
                  className={offset === undefined ? undefined : 'sticky-left'}
                  style={cellStyle(column.width, offset)}
                  aria-sort={
                    isSorted ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => toggleSort(column.key)}
                      title="Сортировать"
                    >
                      {column.title}
                      {arrow}
                    </button>
                  ) : (
                    column.title
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const background = rowBackground?.(row);
            return (
              <tr key={rowKey(row)} style={background ? { background } : undefined}>
                {columns.map((column) => {
                  const offset = stickyOffsets.get(column.key);
                  return (
                    <td
                      key={column.key}
                      className={
                        [
                          column.numeric ? 'num' : '',
                          offset === undefined ? '' : 'sticky-left',
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      style={cellStyle(column.width, offset)}
                    >
                      {column.render(row)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
