/**
 * WORKING BOM — рабочее место производства.
 *
 * Экран показывает, из чего складывается доступность материала: резерв по
 * спецификации, фактический приход и уже переданное количество. Передать можно
 * строки «На складе» — учебная система и здесь не даёт передать материал,
 * которого физически нет.
 *
 * В отличие от отборки, здесь нет выбора лота: производство работает по своей
 * спецификации и передаёт строки по одной.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { WorkingBomRow } from '../api/types.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDateTime, formatQty } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { ProductionBadge } from '../ui/Badge.js';
import { BomCell, MaterialCell } from '../ui/Cells.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { ProjectFilter } from '../ui/ProjectFilter.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';

/** Отбор строк по поисковой строке. */
function matchesSearch(row: WorkingBomRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) {
    return true;
  }
  return [row.model, row.materialCode, row.materialName, row.manufacturer, row.bomName]
    .join(' ')
    .toLowerCase()
    .includes(text);
}

export function WorkingBomPage() {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [project, setProject] = useState('');
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useLoader(
    `working-bom|${project}`,
    () => api.fetchWorkingBom(project),
  );

  const rows = useMemo(
    () => (data?.rows ?? []).filter((row) => matchesSearch(row, search)),
    [data, search],
  );

  const canHandoff = can('WORKING_BOM_CHECKBOX');

  const handoffOne = async (row: WorkingBomRow): Promise<void> => {
    const result = await run(() => api.handoff([row.positionId], 'WORKING BOM'));
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

  const columns: Array<Column<WorkingBomRow>> = [
    {
      // «№» и «Материал» закреплены у левого края: при горизонтальной прокрутке
      // строка остаётся опознаваемой (см. `DataTable`).
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
      sticky: true,
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
      key: 'reservedQty',
      title: 'Резерв',
      numeric: true,
      width: '96px',
      sortValue: (row) => row.reservedQty,
      render: (row) => formatQty(row.reservedQty),
    },
    {
      key: 'realDeliveryQty',
      title: 'Приход',
      numeric: true,
      width: '96px',
      sortValue: (row) => row.realDeliveryQty,
      render: (row) => formatQty(row.realDeliveryQty),
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
      key: 'receivedQty',
      title: 'Передано',
      numeric: true,
      width: '104px',
      sortValue: (row) => row.receivedQty,
      render: (row) => formatQty(row.receivedQty),
    },
    {
      key: 'state',
      title: 'Состояние',
      width: '176px',
      sortValue: (row) => row.productionState,
      render: (row) => (
        <ProductionBadge state={row.productionState} text={row.productionStateText} />
      ),
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
          <span className="muted">{row.productionStateText}</span>
        ),
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      width: '120px',
      sortValue: (row) => row.updatedAt,
      render: (row) => <span className="muted">{formatDateTime(row.updatedAt)}</span>,
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>WORKING BOM</h1>
          <div className="hint">
            Из чего складывается доступность материала: резерв по спецификации, приход по
            поставке и уже переданное производству. «Доступно» — это резерв плюс приход,
            но не больше потребности.
          </div>
        </div>
        {data ? (
          <div className="row">
            <span className="badge neutral">Строк: {data.totals.rows}</span>
            <span className={data.totals.canHandoff > 0 ? 'badge ok' : 'badge neutral'}>
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
        <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
          <Icon name="refresh" size={14} />
          Обновить
        </button>
        {!canHandoff ? (
          <span className="muted">Ваша роль не передаёт материал из WORKING BOM</span>
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

      {loading && !data ? <div className="empty-state">Загружаю WORKING BOM…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.positionId}
          emptyText="Нет позиций в работе"
        />
      ) : null}
    </div>
  );
}
