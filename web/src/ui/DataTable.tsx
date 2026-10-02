/**
 * Таблица данных: сортировка по столбцам, липкие первые колонки и массовый ввод
 * выделением диапазона (как в Excel).
 *
 * Все рабочие экраны устроены одинаково: строки, столбцы, сортировка по щелчку на
 * заголовке. Поэтому таблица описана один раз — экран лишь перечисляет столбцы и
 * говорит, как отрисовать значение.
 *
 * Сортировка выполняется на клиенте: строк в витрине сотни, они уже загружены, а
 * мгновенный отклик на щелчок важнее экономии трафика. ВЫДЕЛЕНИЕ СЧИТАЕТСЯ ПО
 * ПОКАЗАННОМУ ПОРЯДКУ строк: иначе после щелчка по заголовку прямоугольник
 * охватывал бы уже другие строки, чем видел человек.
 *
 * Про липкие колонки. Спецификация — широкая таблица: колонок много, и при
 * горизонтальной прокрутке «№» и «Материал» уезжают вместе с содержимым, так что
 * строка теряет опознаваемость. Поэтому первым колонкам можно включить
 * `sticky` — они остаются на месте, а остальные прокручиваются под ними.
 *
 * Про массовый ввод. Два режима обращения с ячейкой:
 *   * обычный щелчок — вход в поле: стрелки двигают курсор, Ctrl+V вставляет текст
 *     в поле, и проверку показывает само поле;
 *   * Shift+щелчок или Shift+стрелки — выделение диапазона: Ctrl+C копирует блок,
 *     Ctrl+V вставляет блок, Delete очищает, Ctrl+D заполняет вниз, Ctrl+R — вправо,
 *     Escape снимает выделение.
 *
 * Такое разделение выбрано намеренно. Если бы вставка перехватывалась всегда, в поле
 * нельзя было бы вставить значение из другого окна — а правка одной ячейки остаётся
 * самым частым действием. Поэтому блок применяется только когда диапазон ВЫДЕЛЕН.
 *
 * Колонка участвует в массовом вводе, если у неё задано `bulkField` (имя поля,
 * которое понимает сервер). Ячейки без него пропускаются, а их число показывается
 * в отчёте — молча «съесть» часть вставки нельзя.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import { blockSize, blockValue, parseGridText, serializeGridText } from './clipboardGrid.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import {
  cellCount,
  containsCell,
  forEachPoint,
  movedSelection,
  rangeOf,
  selectionAt,
  type GridPoint,
  type GridRange,
  type GridSelection,
  type GridShape,
} from './gridSelection.js';
import { useToast } from './ToastProvider.js';

/** С какого размера блок подтверждается вопросом: крупную вставку легко сделать зря. */
const CONFIRM_CELLS = 50;

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
  /**
   * Значение ячейки текстом. Нужно для копирования и заполнения: у ячейки с
   * редактором значение лежит в форме, а не в тексте, и «взять текст» неоткуда.
   */
  text?: (row: Row) => string;
  /**
   * Имя поля массового ввода (то же, что понимает сервер: `orderedQty`,
   * `expectedDate`, `SPEC.MODEL`). Без него ячейка в выделение не попадает.
   */
  bulkField?: string;
  /** Роль не может менять это поле: ячейка видна, но ввод в неё не применяется. */
  readOnly?: boolean;
}

/** Одно изменение для массовой правки: строка, поле и текст значения. */
export interface GridChange {
  rowId: string;
  field: string;
  value: string;
}

/** Результат по одному изменению (форма ответа сервера). */
export interface GridItemResult {
  positionId?: string;
  materialKey?: string;
  field: string;
  status: string;
  reason: string;
}

/** Отчёт массовой правки: сколько применено, сколько уже так, сколько отклонено. */
export interface GridOutcome {
  applied: number;
  already: number;
  blocked: number;
  results: GridItemResult[];
}

/** Массовый ввод: как обратиться к серверу и что показать после ответа. */
export interface DataTableBulk<Row> {
  /** Идентификатор строки: позиция (сводка, карточка) или ключ материала (склад). */
  rowIdOf: (row: Row) => string;
  /** Отправить пачку изменений. `undefined` — ошибку уже показали пользователю. */
  submit: (changes: GridChange[]) => Promise<GridOutcome | undefined>;
  /** Общее предупреждение ко всей вставке (например, о ключе материала). */
  noticeOf?: (changes: GridChange[]) => string;
}

interface DataTableProps<Row> {
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyText?: string;
  /** Подсветка строки (например, цветом состояния из прежней системы). */
  rowBackground?: (row: Row) => string | undefined;
  /** Массовый ввод включён, если задан этот объект. */
  bulk?: DataTableBulk<Row>;
  /** Идёт запрос: вставка и очистка недоступны, чтобы не наслаивать команды. */
  busy?: boolean;
  /** Размер блока, начиная с которого спрашивают подтверждение. */
  confirmFrom?: number;
  /** Данные обновились — страница перечитывает их с сервера. */
  onApplied?: () => void;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

/** Крупное действие, ожидающее подтверждения. */
interface PendingAction {
  kind: 'paste' | 'clear' | 'fill';
  changes: GridChange[];
  /** Ячеек выделения без поля массового ввода — о них сообщаем после применения. */
  skipped: number;
}

/** Направление заполнения выделенного диапазона. */
type FillDirection = 'down' | 'right';

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

/** Колонка принимает массовый ввод. */
function isEditable<Row>(column: Column<Row> | undefined): boolean {
  return Boolean(column?.bulkField) && column?.readOnly !== true;
}

/** Узел, в котором сейчас стоит курсор (для правил клавиатуры). */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/** Ячейка, на которой произошло событие (по разметке `data-cell-*`). */
function cellFromEvent(target: EventTarget | null): GridPoint | null {
  const element = target instanceof Element ? target.closest('[data-cell-row]') : null;
  if (!element) {
    return null;
  }
  const row = Number(element.getAttribute('data-cell-row'));
  const column = Number(element.getAttribute('data-cell-col'));
  if (!Number.isInteger(row) || !Number.isInteger(column)) {
    return null;
  }
  return { row, column };
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  emptyText = 'Нет данных',
  rowBackground,
  bulk,
  busy = false,
  confirmFrom = CONFIRM_CELLS,
  onApplied,
}: DataTableProps<Row>) {
  const toast = useToast();
  const [sort, setSort] = useState<SortState>(null);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  /**
   * Признак «выделен диапазон».
   *
   * Обычный щелчок тоже запоминает ячейку (по ней видно, где стоит курсор), но
   * вставку перехватывает ТОЛЬКО выделение: иначе нельзя было бы вставить значение
   * в поле из другого окна.
   */
  const [rangeMode, setRangeMode] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  /*
   * Состав строк в виде строки-подписи.
   *
   * Сравнивать массивы строк бесполезно: страница создаёт колонки и строки заново
   * на каждой отрисовке, поэтому ссылки меняются всегда. Подпись же остаётся равной,
   * пока строки те же — и выделение не сбрасывается на пустом месте.
   */
  const gridKey = useMemo(
    () => sortedRows.map((row) => rowKey(row)).join('\u0000'),
    [sortedRows, rowKey],
  );

  // Данные перечитали или порядок строк изменился — прежний прямоугольник больше
  // не относится к тем строкам, которые видит человек.
  useEffect(() => {
    setSelection(null);
    setRangeMode(false);
  }, [gridKey, sort?.key, sort?.direction]);

  const shape: GridShape = { rows: sortedRows.length, columns: columns.length };
  const range = selection ? rangeOf(selection) : null;

  /** Сколько ячеек диапазона принимают массовый ввод. */
  const editableInRange = (target: GridRange): number => {
    let count = 0;
    forEachPoint(target, ({ column }) => {
      if (isEditable(columns[column])) {
        count += 1;
      }
    });
    return count;
  };

  /** Текст диапазона для буфера обмена. */
  const rangeText = (target: GridRange): string[][] => {
    const matrix: string[][] = [];
    for (let row = target.top; row <= target.bottom; row += 1) {
      const rowData = sortedRows[row];
      if (!rowData) {
        continue;
      }
      const line: string[] = [];
      for (let column = target.left; column <= target.right; column += 1) {
        line.push(columns[column]?.text?.(rowData) ?? '');
      }
      matrix.push(line);
    }
    return matrix;
  };

  const reportOutcome = (outcome: GridOutcome): void => {
    const firstReason = outcome.results.find((item) => item.status === 'blocked')?.reason ?? '';
    if (outcome.applied === 0 && outcome.blocked > 0) {
      toast.error(
        [`Отклонено: ${outcome.blocked}`, firstReason].filter(Boolean).join(' · '),
      );
      return;
    }
    const parts = [`Применено: ${outcome.applied}`];
    if (outcome.already) {
      parts.push(`без изменений: ${outcome.already}`);
    }
    if (outcome.blocked) {
      parts.push(`отклонено: ${outcome.blocked}`);
    }
    const text = [...parts, firstReason].filter(Boolean).join(' · ');
    if (outcome.applied) {
      toast.success(text);
    } else {
      toast.info(outcome.already ? text : 'Изменений нет: значения уже такие');
    }
  };

  const submitChanges = async (changes: GridChange[]): Promise<void> => {
    if (!bulk || !changes.length) {
      return;
    }
    const outcome = await bulk.submit(changes);
    if (!outcome) {
      return;
    }
    const notice = bulk.noticeOf?.(changes);
    if (notice) {
      toast.info(notice);
    }
    reportOutcome(outcome);
    onApplied?.();
  };

  /** Показать отчёт о пропущенных ячейках и выполнить действие. */
  const runPending = (action: PendingAction): void => {
    if (action.skipped) {
      toast.info(
        `Пропущено ячеек без массового ввода: ${action.skipped} — их значения не изменились`,
      );
    }
    void submitChanges(action.changes);
  };

  /** Выполнить действие: мелкое сразу, крупное — после подтверждения. */
  const requestAction = (action: PendingAction): void => {
    if (!action.changes.length) {
      toast.info('В выделенном диапазоне нет полей, доступных массовому вводу');
      return;
    }
    if (action.changes.length > confirmFrom) {
      setPending(action);
      return;
    }
    runPending(action);
  };

  /** Изменения из вставленного блока: значения кладутся от левого верхнего угла. */
  const pasteChanges = (
    target: GridRange,
    block: readonly (readonly string[])[],
  ): PendingAction => {
    const size = blockSize(block);
    const changes: GridChange[] = [];
    let skipped = 0;
    for (let rowOffset = 0; rowOffset < size.rows; rowOffset += 1) {
      const rowData = sortedRows[target.top + rowOffset];
      for (let columnOffset = 0; columnOffset < size.columns; columnOffset += 1) {
        const columnIndex = target.left + columnOffset;
        const column = columns[columnIndex];
        if (!rowData || !bulk || !isEditable(column)) {
          skipped += 1;
          continue;
        }
        changes.push({
          rowId: bulk.rowIdOf(rowData),
          field: column?.bulkField as string,
          value: blockValue(block, rowOffset, columnOffset),
        });
      }
    }
    return { kind: 'paste', changes, skipped };
  };

  /** Очистка диапазона: пустое значение сервер понимает как «ноль» или «снять дату». */
  const clearChanges = (target: GridRange): PendingAction => {
    const changes: GridChange[] = [];
    let skipped = 0;
    forEachPoint(target, ({ row, column }) => {
      const rowData = sortedRows[row];
      const columnData = columns[column];
      if (!rowData || !bulk || !isEditable(columnData)) {
        skipped += 1;
        return;
      }
      changes.push({
        rowId: bulk.rowIdOf(rowData),
        field: columnData?.bulkField as string,
        value: '',
      });
    });
    return { kind: 'clear', changes, skipped };
  };

  /**
   * Заполнение диапазона: вниз — из верхней строки, вправо — из левой колонки.
   *
   * Вправо заполнять можно только ВНУТРИ ОДНОГО ПОЛЯ: у каждой колонки своё поле
   * («Заказано», «Ожидаемая поставка», «Крайний срок»), и перенос даты в количество
   * был бы бессмыслицей. Поэтому разнородный диапазон получает объяснение, а не
   * молчаливую запись мусора.
   */
  const fillChanges = (target: GridRange, direction: FillDirection): PendingAction => {
    if (direction === 'right') {
      const fields = new Set<string>();
      for (let column = target.left; column <= target.right; column += 1) {
        const columnData = columns[column];
        if (isEditable(columnData)) {
          fields.add(String(columnData?.bulkField));
        }
      }
      if (fields.size !== 1) {
        toast.info(
          'Заполнение вправо работает внутри одного поля: в выделении разные столбцы',
        );
        return { kind: 'fill', changes: [], skipped: 0 };
      }
    }

    // Образец: при заполнении вниз — верхняя строка, вправо — левая колонка.
    // Ячейки-образцы не переписываются: их значения и есть источник.
    const sourceRow = direction === 'down' ? target.top : null;
    const sourceColumn = direction === 'right' ? target.left : null;

    const changes: GridChange[] = [];
    let skipped = 0;
    for (let column = target.left; column <= target.right; column += 1) {
      const columnData = columns[column];
      for (let row = target.top; row <= target.bottom; row += 1) {
        if (row === sourceRow || column === sourceColumn) {
          continue;
        }
        const rowData = sortedRows[row];
        const sample = sortedRows[sourceRow ?? row];
        const sampleColumn = columns[sourceColumn ?? column];
        if (!rowData || !sample || !bulk || !isEditable(columnData)) {
          skipped += 1;
          continue;
        }
        changes.push({
          rowId: bulk.rowIdOf(rowData),
          field: columnData?.bulkField as string,
          value: sampleColumn?.text?.(sample) ?? '',
        });
      }
    }
    return { kind: 'fill', changes, skipped };
  };

  const toggleSort = (key: string): void => {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' };
      }
      return current.direction === 'asc' ? { key, direction: 'desc' } : null;
    });
  };

  const onTableMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!bulk) {
      return;
    }
    const cell = cellFromEvent(event.target);
    if (!cell) {
      return;
    }
    if (event.shiftKey) {
      // Shift+щелчок не должен ставить курсор в поле: пользователь тянет диапазон.
      event.preventDefault();
      setRangeMode(true);
      setSelection((current) => (current ? { anchor: current.anchor, focus: cell } : selectionAt(cell)));
      containerRef.current?.focus();
      return;
    }
    setRangeMode(false);
    setSelection(selectionAt(cell));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!bulk || !selection) {
      return;
    }
    const inInput = isTextInput(event.target);

    if (event.key === 'Escape') {
      if (rangeMode) {
        event.preventDefault();
        setRangeMode(false);
        setSelection(null);
      }
      return;
    }

    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = arrows[event.key];
    if (delta) {
      // Внутри поля обычные стрелки двигают курсор — там распоряжается поле.
      if (!event.shiftKey && inInput) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        setRangeMode(true);
      }
      setSelection((current) =>
        current ? movedSelection(current, delta[0], delta[1], shape, event.shiftKey) : current,
      );
      if (event.shiftKey) {
        containerRef.current?.focus();
      }
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!rangeMode || !range) {
        return;
      }
      event.preventDefault();
      requestAction(clearChanges(range));
      return;
    }

    const shortcut = event.ctrlKey || event.metaKey;
    if (shortcut && (event.key === 'd' || event.key === 'D' || event.key === 'в' || event.key === 'В')) {
      if (!rangeMode || !range) {
        return;
      }
      event.preventDefault();
      requestAction(fillChanges(range, 'down'));
      return;
    }
    if (shortcut && (event.key === 'r' || event.key === 'R' || event.key === 'к' || event.key === 'К')) {
      if (!rangeMode || !range) {
        return;
      }
      event.preventDefault();
      requestAction(fillChanges(range, 'right'));
    }
  };

  const onCopy = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    if (!bulk || !rangeMode || !range) {
      return;
    }
    event.clipboardData.setData('text/plain', serializeGridText(rangeText(range)));
    event.preventDefault();
    toast.info(`Скопировано ячеек: ${cellCount(range)} — их можно вставить в Excel`);
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    if (!bulk || !rangeMode || !range) {
      return;
    }
    const block = parseGridText(event.clipboardData.getData('text/plain'));
    if (!block.length) {
      return;
    }
    event.preventDefault();
    requestAction(pasteChanges(range, block));
  };

  if (!rows.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  const selectedCells = range ? cellCount(range) : 0;
  const editableCells = range ? editableInRange(range) : 0;

  return (
    <div className="table-block">
      {bulk && rangeMode && range ? (
        <div className="grid-hint">
          Выделено ячеек: {selectedCells} · с массовым вводом: {editableCells} · Ctrl+C
          копировать · Ctrl+V вставить · Delete очистить · Ctrl+D вниз · Ctrl+R вправо · Esc
          снять выделение
        </div>
      ) : null}

      <div
        className="table-scroll"
        ref={containerRef}
        tabIndex={0}
        aria-label="Таблица: Shift+щелчок выделяет диапазон для массового ввода"
        onMouseDown={onTableMouseDown}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
      >
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
            {sortedRows.map((row, rowIndex) => {
              const background = rowBackground?.(row);
              return (
                <tr key={rowKey(row) || `row-${rowIndex}`} style={background ? { background } : undefined}>
                  {columns.map((column, columnIndex) => {
                    const offset = stickyOffsets.get(column.key);
                    const selected = range ? containsCell(range, rowIndex, columnIndex) : false;
                    const isAnchor =
                      selection?.anchor.row === rowIndex && selection?.anchor.column === columnIndex;
                    const cellClassNames = [
                      column.numeric ? 'num' : '',
                      offset === undefined ? '' : 'sticky-left',
                      selected ? 'cell-selected' : '',
                      isAnchor ? 'cell-anchor' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <td
                        key={column.key}
                        data-cell-row={bulk ? rowIndex : undefined}
                        data-cell-col={bulk ? columnIndex : undefined}
                        className={cellClassNames || undefined}
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

      {pending ? (
        <ConfirmDialog
          title={
            pending.kind === 'clear'
              ? 'Очистить выделенные ячейки?'
              : pending.kind === 'fill'
                ? 'Заполнить выделенные ячейки?'
                : 'Вставить блок в таблицу?'
          }
          description={[
            `Изменений будет: ${pending.changes.length}.`,
            pending.skipped
              ? `Ячеек без массового ввода пропускается: ${pending.skipped}.`
              : '',
            pending.kind === 'clear'
              ? 'Значения будут сняты: количества станут нулями, даты — пустыми.'
              : 'Каждое изменение будет записано в журнал одной командой — её потом можно вернуть.',
          ]
            .filter(Boolean)
            .join(' ')}
          confirmText={pending.kind === 'clear' ? 'Очистить' : 'Применить'}
          danger={pending.kind === 'clear'}
          busy={busy}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            runPending(action);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
