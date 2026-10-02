/**
 * Дашборд — состояние спецификаций.
 *
 * Одна строка — одна спецификация. Внутри видно, сколько позиций собрано, сколько
 * ждёт отборки и сколько ещё в снабжении; в колонке «Не хватает» перечислены
 * материалы, которых не достаёт, с количеством и ожидаемой датой.
 *
 * Отметка «Выполнено» снимает спецификацию с дашборда (в прежней системе это был
 * лист EXCLUDED_BOMS). Сервер разрешает её только для полностью собранных
 * спецификаций — иначе «Выполнено» скрывало бы незакрытые позиции.
 */

import { useState } from 'react';

import * as api from '../api/endpoints.js';
import type { DashboardRow } from '../api/types.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDate, formatLines, formatQty } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { StatusBadge } from '../ui/Badge.js';
import { BomCell } from '../ui/Cells.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';

export function DashboardPage() {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useLoader('dashboard', api.fetchDashboard);

  const rows = (data?.rows ?? []).filter((row) => {
    const text = search.trim().toLowerCase();
    if (!text) {
      return true;
    }
    return `${row.bomName} ${row.projectCode}`.toLowerCase().includes(text);
  });

  const canDone = can('DASHBOARD_CHECKBOX');

  const markDone = async (row: DashboardRow): Promise<void> => {
    const result = await run(() => api.setBomDone(row.bomId, true));
    if (!result) {
      return;
    }
    toast.success(`Спецификация «${row.bomName}» отмечена выполненной`);
    reload();
  };

  const columns: Array<Column<DashboardRow>> = [
    {
      // Спецификация закреплена у левого края: по ней строка и опознаётся.
      key: 'bom',
      title: 'Спецификация',
      width: '220px',
      sticky: true,
      sortValue: (row) => row.bomName,
      render: (row) => <BomCell bomName={row.bomName} projectCode={row.projectCode} />,
    },
    {
      key: 'status',
      title: 'Состояние',
      width: '150px',
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge statusKey={row.status} text={row.statusText} />,
    },
    {
      key: 'total',
      title: 'Позиций',
      numeric: true,
      width: '88px',
      sortValue: (row) => row.totalPositions,
      render: (row) => row.totalPositions,
    },
    {
      key: 'collected',
      title: 'Передано',
      numeric: true,
      width: '96px',
      sortValue: (row) => row.collectedPositions,
      render: (row) => row.collectedPositions,
    },
    {
      key: 'onShelf',
      title: 'На складе',
      numeric: true,
      width: '96px',
      sortValue: (row) => row.onShelf,
      render: (row) => row.onShelf,
    },
    {
      key: 'awaiting',
      title: 'Ждёт поставки',
      numeric: true,
      width: '112px',
      sortValue: (row) => row.awaitingSupply,
      render: (row) => row.awaitingSupply,
    },
    {
      key: 'deadline',
      title: 'Ближайший срок',
      width: '124px',
      sortValue: (row) => row.deadline ?? '',
      render: (row) => formatDate(row.deadline),
    },
    {
      key: 'dateCreated',
      title: 'Создана',
      width: '116px',
      sortValue: (row) => row.dateCreated ?? '',
      render: (row) => formatDate(row.dateCreated),
    },
    {
      key: 'missing',
      title: 'Не хватает',
      width: '300px',
      render: (row) => {
        const lines = formatLines(row.missingText, '—');
        return (
          <div className="mono">
            {lines.map((line) => (
              <div key={`${row.bomId}|${line}`}>{line}</div>
            ))}
          </div>
        );
      },
    },
    {
      key: 'supply',
      title: 'В снабжении',
      width: '320px',
      render: (row) => (
        <div>
          {row.supplyEntries.length ? (
            row.supplyEntries.map((entry) => (
              <div key={`${row.bomId}|${entry.model}|${entry.expectedDate ?? ''}`}>
                {formatQty(entry.qty)} — {entry.model}
                {entry.expectedDate ? `, ждём ${formatDate(entry.expectedDate)}` : ''}
              </div>
            ))
          ) : (
            <span className="muted">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'done',
      title: 'Выполнено',
      width: '130px',
      render: (row) =>
        row.done ? (
          <span className="badge ok">Отмечена</span>
        ) : (
          <button
            type="button"
            className="btn small"
            disabled={!canDone || busy}
            title={
              canDone
                ? 'Отметить спецификацию выполненной'
                : 'Отметку «Выполнено» ставит производство'
            }
            onClick={() => void markDone(row)}
          >
            <Icon name="check" size={14} />
            Готово
          </button>
        ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Дашборд</h1>
          <div className="hint">
            Состояние спецификаций: сколько позиций уже передано производству, что ждёт
            отборки и что ещё в снабжении. Спецификации, отмеченные выполненными, в список
            не попадают.
          </div>
        </div>
        {data ? (
          <div className="row">
            <span className="badge neutral">Спецификаций: {data.totals.boms}</span>
            <span className={data.totals.onShelf > 0 ? 'badge stock' : 'badge neutral'}>
              Ждут отборки: {data.totals.onShelf}
            </span>
            <span className={data.totals.withErrors > 0 ? 'badge bad' : 'badge neutral'}>
              С ошибками: {data.totals.withErrors}
            </span>
          </div>
        ) : null}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="dashboard-search">Поиск</label>
          <input
            id="dashboard-search"
            type="text"
            value={search}
            placeholder="Спецификация или проект"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
          <Icon name="refresh" size={14} />
          Обновить
        </button>
      </div>

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю дашборд…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.bomId}
          emptyText="Нет спецификаций в работе"
          rowBackground={(row) =>
            row.status === 'READY'
              ? 'var(--row-green)'
              : row.status === 'ERROR'
                ? 'var(--row-gray)'
                : undefined
          }
        />
      ) : null}
    </div>
  );
}
