/**
 * Журнал действий — кто, что и когда изменил.
 *
 * Журнал нужен, чтобы разобраться в спорной ситуации: например, кто изменил заказ
 * или почему позиция снова стала активной. Записи объединены идентификатором
 * операции: если снабженец передал сразу несколько позиций, все записи одной
 * команды имеют одинаковый идентификатор и показаны вместе.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { AuditRecord } from '../api/adminTypes.js';
import { useLoader } from '../app/useLoader.js';
import { formatDateTime } from '../format.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { Icon } from '../ui/icons.js';

/** Человекочитаемые названия действий. */
const ACTION_LABELS: Record<string, string> = {
  ORDERED_QTY_CHANGED: 'Изменён заказ',
  EXPECTED_DATE_CHANGED: 'Изменена ожидаемая поставка',
  REAL_DELIVERY_RECORDED: 'Отмечена реальная поставка',
  DEADLINE_CHANGED: 'Изменён крайний срок',
  WAREHOUSE_QTY_CHANGED: 'Изменён складской остаток',
  PRODUCTION_HANDOFF: 'Передано производству',
  RETURN_FROM_ARCHIVE: 'Возврат из архива',
  BOM_IMPORT: 'Спецификация',
  BOM_DONE: 'Спецификация выполнена',
  BOM_RETURNED: 'Спецификация возвращена в работу',
};

/** Отбор записей журнала по поисковой строке. */
function matchesSearch(row: AuditRecord, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) {
    return true;
  }
  return [row.actor, row.action, row.bomId, row.positionId, row.field, row.newValue, row.reason]
    .join(' ')
    .toLowerCase()
    .includes(text);
}

export function AuditPanel() {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(200);
  const { data, loading, error, reload } = useLoader(`audit|${limit}`, () =>
    api.fetchAudit(limit),
  );

  const rows = useMemo(
    () => (data?.events ?? []).filter((row) => matchesSearch(row, search)),
    [data, search],
  );

  const columns: Array<Column<AuditRecord>> = [
    {
      key: 'createdAt',
      title: 'Когда',
      sortValue: (row) => row.createdAt,
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'actor',
      title: 'Кто',
      sortValue: (row) => row.actor,
      render: (row) => <span className="mono">{row.actor}</span>,
    },
    {
      key: 'action',
      title: 'Действие',
      sortValue: (row) => row.action,
      render: (row) => ACTION_LABELS[row.action] ?? row.action,
    },
    {
      key: 'bom',
      title: 'Спецификация',
      sortValue: (row) => row.bomId,
      render: (row) => (
        <span className="mono">
          {row.bomId || '—'}
          {row.positionId ? <div className="muted">строка: {row.positionId}</div> : null}
        </span>
      ),
    },
    {
      key: 'field',
      title: 'Поле',
      sortValue: (row) => row.field,
      render: (row) => row.field || '—',
    },
    {
      key: 'values',
      title: 'Было → стало',
      render: (row) => (
        <span className="mono">
          {row.oldValue || '—'} → {row.newValue || '—'}
        </span>
      ),
    },
    {
      key: 'reason',
      title: 'Комментарий',
      render: (row) => row.reason || <span className="muted">—</span>,
    },
    {
      key: 'operation',
      title: 'Операция',
      render: (row) => (
        <span className="mono muted" title={row.operationId}>
          {row.operationId.slice(0, 8)}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <div className="row">
        <div className="field">
          <label htmlFor="audit-search">Поиск</label>
          <input
            id="audit-search"
            type="text"
            value={search}
            placeholder="Пользователь, спецификация, поле, значение"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="audit-limit">Показать записей</label>
          <select
            id="audit-limit"
            value={String(limit)}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
          </select>
        </div>
        <button type="button" className="btn small ghost" onClick={reload}>
          <Icon name="refresh" size={14} />
          Обновить
        </button>
      </div>

      <div className="muted">
        Записи с одинаковым идентификатором операции сделаны одним нажатием кнопки —
        например, передача сразу нескольких позиций производству.
      </div>

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю журнал…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => String(row.id)}
          emptyText="Записей в журнале нет"
        />
      ) : null}
    </div>
  );
}
