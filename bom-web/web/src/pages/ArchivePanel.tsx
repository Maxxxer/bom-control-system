/**
 * Панель архива передач: список и возврат в работу.
 *
 * Панель переиспользуется в двух местах — на отдельном экране «Архив» и во вкладке
 * администратора. Логика одна: отметить записи, указать причину возврата и
 * получить результат по каждой позиции.
 *
 * Возврат требует причины: он меняет состояние склада и производства, поэтому
 * причина попадает в журнал.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { ArchiveRecord } from '../api/adminTypes.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDateTime, formatQty } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';

/** Отбор записей архива по поисковой строке. */
function matchesSearch(row: ArchiveRecord, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) {
    return true;
  }
  return [row.name, row.model, row.code, row.manufacturer, row.bomName, row.receivedBy]
    .join(' ')
    .toLowerCase()
    .includes(text);
}

export function ArchivePanel() {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const { data, loading, error, reload } = useLoader('archive', () => api.fetchArchive(500));

  const rows = useMemo(
    () => (data?.rows ?? []).filter((row) => matchesSearch(row, search)),
    [data, search],
  );

  const canReturn = can('PICKING_CHECKBOX');

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

  const returnSelected = async (reason: string): Promise<void> => {
    const ids = [...selected];
    if (!ids.length) {
      toast.info('Отметьте записи, которые нужно вернуть в работу');
      return;
    }
    const result = await run(() => api.returnFromArchive(ids, reason));
    setConfirming(false);
    if (!result) {
      return;
    }
    if (result.returned > 0) {
      toast.success(`Возвращено в работу позиций: ${result.returned}`);
    }
    const blocked = result.results.filter((item) => item.status === 'blocked');
    if (blocked.length) {
      toast.error(
        `Не возвращено (${blocked.length}): ` +
          blocked.map((item) => item.reason ?? 'причина не указана').join('; '),
      );
    }
    setSelected(new Set());
    reload();
  };

  const columns: Array<Column<ArchiveRecord>> = [
    {
      key: 'select',
      title: '',
      width: '44px',
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.positionId)}
          disabled={!canReturn || busy}
          title={canReturn ? 'Отметить для возврата' : 'Возврат выполняет отборка'}
          aria-label={`Отметить ${row.name} ${row.model}`}
          onChange={() => toggleRow(row.positionId)}
        />
      ),
    },
    {
      key: 'receivedAt',
      title: 'Передано',
      sortValue: (row) => row.receivedAt ?? '',
      render: (row) => formatDateTime(row.receivedAt),
    },
    {
      key: 'bom',
      title: 'Спецификация',
      sortValue: (row) => row.bomName,
      render: (row) => (
        <div className="mono">
          {row.bomName}
          <div className="muted">строка {row.rowNo}</div>
        </div>
      ),
    },
    {
      key: 'material',
      title: 'Материал',
      sortValue: (row) => `${row.name} ${row.model}`,
      render: (row) => (
        <div>
          <div>{row.name}</div>
          <div className="mono muted">
            {row.model}
            {row.code ? ` · ${row.code}` : ''}
            {row.manufacturer ? ` · ${row.manufacturer}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'qty',
      title: 'Передано',
      numeric: true,
      sortValue: (row) => row.qty,
      render: (row) => `${formatQty(row.qty)} ${row.unit}`,
    },
    {
      key: 'receivedBy',
      title: 'Кто передал',
      sortValue: (row) => row.receivedBy,
      render: (row) => row.receivedBy,
    },
    {
      key: 'sourceUi',
      title: 'Откуда',
      sortValue: (row) => row.sourceUi,
      render: (row) => row.sourceUi,
    },
    {
      key: 'comment',
      title: 'Комментарий',
      render: (row) => row.comment || <span className="muted">—</span>,
    },
  ];

  return (
    <div className="stack">
      <div className="row">
        <div className="field">
          <label htmlFor="archive-search">Поиск</label>
          <input
            id="archive-search"
            type="text"
            value={search}
            placeholder="Материал, модель, спецификация, кто передал"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
          <Icon name="refresh" size={14} />
          Обновить
        </button>
        {data ? (
          <span className="badge neutral">
            Показано: {rows.length} из {data.rows.length}
          </span>
        ) : null}
      </div>

      <div className="action-bar">
        <span className="count">Отмечено: {selected.size}</span>
        <button
          type="button"
          className="btn primary"
          disabled={!canReturn || busy || selected.size === 0}
          onClick={() => setConfirming(true)}
        >
          <Icon name="arrowRight" size={16} />
          Вернуть в работу
        </button>
        {!canReturn ? <span className="muted">Возврат из архива выполняет отборка</span> : null}
      </div>

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю архив…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.id}|${row.positionId}`}
          emptyText="В архиве пока ничего нет"
        />
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Вернуть материалы в работу"
          description={`Будет возвращено записей: ${selected.size}. Материал снова станет активным, а склад увеличится на возвращённое количество.`}
          confirmText="Вернуть"
          reasonLabel="Причина возврата (обязательно)"
          busy={busy}
          onConfirm={(reason) => void returnSelected(reason)}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
