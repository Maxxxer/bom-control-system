/**
 * Отборка — рабочее место кладовщика и производства.
 *
 * Строки, готовые к передаче, показаны сверху и выделены цветом; их можно
 * отметить галочками и передать производству одним нажатием — так же, как в
 * прежней системе отборщик отмечал строки и отправлял лот. Передача выполняется
 * одной командой: сервер обрабатывает каждую позицию отдельно, поэтому одна
 * заблокированная строка не отменяет остальные, а причины отказа показываются
 * пользователю построчно.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { PickingRow } from '../api/types.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDate, formatQty } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { ProductionBadge } from '../ui/Badge.js';
import { BomCell, MaterialCell } from '../ui/Cells.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { ProjectFilter } from '../ui/ProjectFilter.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';

/** Отбор строк по поисковой строке. */
function matchesSearch(row: PickingRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) {
    return true;
  }
  return [row.model, row.materialCode, row.materialName, row.manufacturer, row.bomName]
    .join(' ')
    .toLowerCase()
    .includes(text);
}

export function PickingPage() {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [project, setProject] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, loading, error, reload } = useLoader(
    `picking|${project}`,
    () => api.fetchPicking(project),
  );

  const rows = useMemo(
    () => (data?.rows ?? []).filter((row) => matchesSearch(row, search)),
    [data, search],
  );

  const canHandoff = can('PICKING_CHECKBOX');
  const readyIds = useMemo(
    () => rows.filter((row) => row.canHandoff).map((row) => row.positionId),
    [rows],
  );

  const toggleRow = (positionId: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(positionId)) {
        next.delete(positionId);
      } else {
        next.add(positionId);
      }
      return next;
    });
  };

  const selectReady = (): void => setSelected(new Set(readyIds));

  const handoffSelected = async (): Promise<void> => {
    const ids = [...selected];
    if (!ids.length) {
      toast.info('Сначала отметьте строки для передачи');
      return;
    }
    const result = await run(() => api.handoff(ids, 'ОТБОРКА'));
    if (!result) {
      return;
    }
    if (result.handedOff > 0) {
      toast.success(`Передано производству позиций: ${result.handedOff}`);
    }
    const blocked = result.results.filter((item) => item.status === 'blocked');
    if (blocked.length) {
      toast.error(
        `Не передано (${blocked.length}): ` +
          blocked
            .map((item) => `${item.materialName} ${item.model} — ${item.reason ?? 'причина не указана'}`)
            .join('; '),
      );
    }
    setSelected(new Set());
    reload();
  };

  const handoffOne = async (row: PickingRow): Promise<void> => {
    const result = await run(() => api.handoff([row.positionId], 'ОТБОРКА'));
    if (!result) {
      return;
    }
    if (result.handedOff > 0) {
      toast.success(`Передано: ${row.materialName} ${row.model}`);
      reload();
      return;
    }
    const blocked = result.results.find((item) => item.status === 'blocked');
    if (blocked) {
      toast.error(blocked.reason ?? 'Передача отклонена правилами');
    } else if (result.skipped > 0) {
      toast.info('Позиция уже передана производству');
      reload();
    }
  };

  const selectedCount = selected.size;

  const columns: Array<Column<PickingRow>> = [
    {
      // Колонка галочек и «№» закреплены у левого края: при горизонтальной
      // прокрутке отмеченная строка остаётся опознаваемой (см. `DataTable`).
      key: 'select',
      title: '',
      width: '44px',
      sticky: true,
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.positionId)}
          disabled={!row.canHandoff || !canHandoff}
          title={
            row.canHandoff
              ? 'Отметить для передачи'
              : 'Передать можно только строки «На складе»'
          }
          aria-label={`Отметить ${row.materialName} ${row.model}`}
          onChange={() => toggleRow(row.positionId)}
        />
      ),
    },
    {
      key: 'rowNo',
      title: '№',
      numeric: true,
      width: '56px',
      sticky: true,
      sortValue: (row) => row.rowNo,
      render: (row) => row.rowNo,
    },
    {
      key: 'bom',
      title: 'Спецификация',
      width: '190px',
      sortValue: (row) => row.bomName,
      render: (row) => <BomCell bomName={row.bomName} projectCode={row.projectCode} />,
    },
    {
      key: 'material',
      title: 'Материал',
      width: '360px',
      sortValue: (row) => `${row.materialName} ${row.model}`,
      render: (row) => (
        <MaterialCell
          name={row.materialName}
          model={row.model}
          code={row.materialCode}
          manufacturer={row.manufacturer}
        />
      ),
    },
    {
      key: 'requiredQty',
      title: 'Нужно',
      numeric: true,
      width: '120px',
      sortValue: (row) => row.requiredQty,
      render: (row) => `${formatQty(row.requiredQty)} ${row.unit}`,
    },
    {
      key: 'available',
      title: 'Доступно',
      numeric: true,
      width: '104px',
      sortValue: (row) => row.availableForProduction,
      render: (row) => formatQty(row.availableForProduction),
    },
    {
      key: 'state',
      title: 'Состояние',
      width: '176px',
      sortValue: (row) => row.productionState,
      render: (row) => <ProductionBadge state={row.productionState} text={row.productionStateText} />,
    },
    {
      key: 'deliveryDate',
      title: 'Дата поставки',
      width: '116px',
      sortValue: (row) => row.deliveryDate ?? '',
      render: (row) => formatDate(row.deliveryDate),
    },
    {
      key: 'action',
      title: 'Действие',
      width: '140px',
      render: (row) =>
        row.canHandoff ? (
          <button
            type="button"
            className="btn small primary"
            disabled={!canHandoff || busy}
            onClick={() => void handoffOne(row)}
          >
            <Icon name="check" size={14} />
            Передать
          </button>
        ) : (
          <span className="muted">нет в наличии</span>
        ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Отборка</h1>
          <div className="hint">
            Передача материала производству. Строки «На складе» можно отметить и передать
            одним нажатием; строки без наличия передать нельзя — система объяснит причину.
          </div>
        </div>
        {data ? (
          <div className="row">
            <span className="badge neutral">Строк: {data.totals.rows}</span>
            <span
              className={data.totals.canHandoff > 0 ? 'badge ok' : 'badge neutral'}
            >
              Готово к передаче: {data.totals.canHandoff}
            </span>
          </div>
        ) : null}
      </div>

      <ProjectFilter
        projects={data?.projects ?? []}
        value={project}
        onChange={setProject}
        search={search}
        onSearchChange={setSearch}
        shownCount={rows.length}
        totalCount={data?.rows.length ?? 0}
      />

      <div className="action-bar">
        <span className="count">Отмечено: {selectedCount}</span>
        <button
          type="button"
          className="btn small"
          onClick={selectReady}
          disabled={busy}
        >
          Отметить готовые ({readyIds.length})
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => setSelected(new Set())}
          disabled={busy || selectedCount === 0}
        >
          Снять выбор
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!canHandoff || busy || selectedCount === 0}
          onClick={() => void handoffSelected()}
        >
          <Icon name="arrowRight" size={16} />
          Передать производству
        </button>
        <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
          <Icon name="refresh" size={14} />
          Обновить
        </button>
        {!canHandoff ? (
          <span className="muted">Ваша роль не передаёт материал производству</span>
        ) : null}
      </div>

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю список отборки…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.positionId}
          emptyText="Нет позиций для отборки"
          rowBackground={(row) => row.color}
        />
      ) : null}
    </div>
  );
}
