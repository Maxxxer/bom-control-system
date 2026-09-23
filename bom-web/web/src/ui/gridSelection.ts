/**
 * Модель выделения диапазона ячеек — как в Excel.
 *
 * Зачем отдельный модуль. Выделение — это арифметика над координатами: якорь (где
 * начали), фокус (где закончили), прямоугольник между ними и обход ячеек в порядке
 * вставки. Ошибка здесь проявляется как «вставилось со сдвигом на строку» — и её
 * очень трудно заметить глазами, поэтому правила собраны в одном месте и описаны.
 *
 * Координаты:
 *   * `row` — индекс строки в ТОМ ПОРЯДКЕ, в котором строки видны на экране
 *     (с учётом сортировки). Иначе выделение «уезжало» бы после щелчка по заголовку;
 *   * `column` — индекс колонки в порядке объявления колонок на экране.
 *
 * Диапазон всегда нормализован (`top` ≤ `bottom`, `left` ≤ `right`): направление
 * протяжки не влияет ни на подсветку, ни на порядок вставки.
 */

/** Точка в таблице. */
export interface GridPoint {
  row: number;
  column: number;
}

/** Размер таблицы: сколько строк показано и сколько в ней колонок. */
export interface GridShape {
  rows: number;
  columns: number;
}

/** Нормализованный прямоугольник выделения. */
export interface GridRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Выделение: якорь (неподвижный угол) и фокус (подвижный угол). */
export interface GridSelection {
  anchor: GridPoint;
  focus: GridPoint;
}

/** Выделение из одной ячейки. */
export function selectionAt(point: GridPoint): GridSelection {
  return { anchor: point, focus: point };
}

/** Ограничить точку пределами таблицы. */
export function clampPoint(point: GridPoint, shape: GridShape): GridPoint {
  return {
    row: Math.min(Math.max(point.row, 0), Math.max(shape.rows - 1, 0)),
    column: Math.min(Math.max(point.column, 0), Math.max(shape.columns - 1, 0)),
  };
}

/** Прямоугольник между якорем и фокусом. */
export function rangeOf(selection: GridSelection): GridRange {
  const { anchor, focus } = selection;
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

/**
 * Сдвинуть выделение на указанное число строк и колонок.
 *
 * `keepAnchor = false` — обычные стрелки: выделение «переезжает» целиком (ячейка,
 * в которой стоит курсор, и есть выделение). `keepAnchor = true` — Shift+стрелки:
 * якорь остаётся на месте, растёт прямоугольник.
 */
export function movedSelection(
  selection: GridSelection,
  deltaRow: number,
  deltaColumn: number,
  shape: GridShape,
  keepAnchor: boolean,
): GridSelection {
  const focus = clampPoint(
    { row: selection.focus.row + deltaRow, column: selection.focus.column + deltaColumn },
    shape,
  );
  return keepAnchor ? { anchor: selection.anchor, focus } : { anchor: focus, focus };
}

/** Сколько ячеек в диапазоне. */
export function cellCount(range: GridRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

/** Диапазон из одной ячейки. */
export function isSingleCell(range: GridRange): boolean {
  return range.top === range.bottom && range.left === range.right;
}

/**
 * Обойти диапазон в порядке вставки: строки сверху вниз, внутри строки — слева
 * направо. Именно в этом порядке значения из буфера кладутся в ячейки.
 */
export function forEachPoint(range: GridRange, visit: (point: GridPoint) => void): void {
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      visit({ row, column });
    }
  }
}

/** Смещение точки внутри диапазона (от левого верхнего угла) или `null`, если точка вне. */
export function offsetInRange(
  range: GridRange,
  point: GridPoint,
): { rowOffset: number; columnOffset: number } | null {
  if (
    point.row < range.top ||
    point.row > range.bottom ||
    point.column < range.left ||
    point.column > range.right
  ) {
    return null;
  }
  return { rowOffset: point.row - range.top, columnOffset: point.column - range.left };
}

/**
 * Ячейка входит в диапазон.
 *
 * Отдельная функция нужна потому, что подсветка вызывается для КАЖДОЙ ячейки:
 * здесь важно обойтись без создания объектов и массивов.
 */
export function containsCell(range: GridRange, row: number, column: number): boolean {
  return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
}
