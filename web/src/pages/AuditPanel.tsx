/**
 * Журнал действий — кто, что и когда изменил, и возможность вернуть правку.
 *
 * Журнал нужен, чтобы разобраться в спорной ситуации: например, кто изменил заказ
 * или почему позиция снова стала активной. Записи объединены идентификатором
 * операции: если снабженец передал сразу несколько позиций, все записи одной
 * команды имеют одинаковый идентификатор и показаны вместе — и вернуть можно ровно
 * эту команду целиком, а не отдельную запись.
 *
 * Про кнопку «Вернуть». Список необратимых действий задан здесь, а последнее слово
 * остаётся за сервером: он возвращает прежние значения по журналу и отказывает там,
 * где правила возврата нет (передача производству, складской остаток, отметка
 * «Выполнено») или где строку изменили ПОСЛЕ откатываемой команды. Поэтому отказ
 * приходит причиной в сообщении, а не молчаливым пропуском.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { AuditRecord } from '../api/adminTypes.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDateTime } from '../format.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { useToast } from '../ui/ToastProvider.js';
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
  OPERATION_ROLLBACK: 'Возврат операции',
};

/**
 * Действия, для которых возврата нет.
 *
 * Передача производству меняет архив, склад и жизненный цикл сразу — «вернуть»
 * такую запись одной командой нельзя, её отменяют на экране отборки. Импорт
 * спецификации вообще не правка поля. Складской остаток вернули бы в обход
 * инвентаризации, поэтому кладовщик правит его вручную. Возврат операции исключён,
 * чтобы не запутать цепочку: у откатa свой идентификатор команды, и повторный
 * откат откатa уже ничего не значит.
 */
const NOT_REVERSIBLE = new Set([
  'PRODUCTION_HANDOFF',
  'RETURN_FROM_ARCHIVE',
  'WAREHOUSE_QTY_CHANGED',
  'BOM_IMPORT',
  'BOM_DONE',
  'BOM_RETURNED',
  'OPERATION_ROLLBACK',
]);

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
  const toast = useToast();
  const { busy, run } = useAction();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(200);
  const [rollbackTarget, setRollbackTarget] = useState<AuditRecord | null>(null);

  const { data, loading, error, reload } = useLoader(`audit|${limit}`, () =>
    api.fetchAudit(limit),
  );

  const rows = useMemo(
    () => (data?.events ?? []).filter((row) => matchesSearch(row, search)),
    [data, search],
  );

  /**
   * Вернуть команду целиком: откат идёт по идентификатору операции, а не по строке.
   *
   * Так одна вставка блока из Excel (одна команда на сотни ячеек) возвращается одним
   * действием — и в журнале появляется своя запись о возврате.
   */
  const rollback = async (record: AuditRecord, reason: string): Promise<void> => {
    setRollbackTarget(null);
    const reply = await run(() => api.rollbackOperation(record.operationId, reason));
    if (!reply) {
      return;
    }
    const firstReason = reply.results.find((item) => item.status === 'blocked')?.reason ?? '';
    if (reply.applied === 0 && reply.blocked > 0) {
      toast.error([`Отклонено записей: ${reply.blocked}`, firstReason].filter(Boolean).join(' · '));
      reload();
      return;
    }
    const parts = [`Возвращено изменений: ${reply.applied}`];
    if (reply.already) {
      parts.push(`уже было так: ${reply.already}`);
    }
    if (reply.blocked) {
      parts.push(`отклонено: ${reply.blocked}`);
    }
    toast.success([...parts, firstReason].filter(Boolean).join(' · '));
    reload();
  };

  const columns: Array<Column<AuditRecord>> = [
    {
      key: 'createdAt',
      title: 'Когда',
      sortValue: (row) => row.createdAt,
      text: (row) => formatDateTime(row.createdAt),
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'actor',
      title: 'Кто',
      sortValue: (row) => row.actor,
      text: (row) => row.actor,
      render: (row) => <span className="mono">{row.actor}</span>,
    },
    {
      key: 'action',
      title: 'Действие',
      sortValue: (row) => row.action,
      text: (row) => ACTION_LABELS[row.action] ?? row.action,
      render: (row) => ACTION_LABELS[row.action] ?? row.action,
    },
    {
      key: 'bom',
      title: 'Спецификация',
      sortValue: (row) => row.bomId,
      text: (row) => [row.bomId, row.positionId].filter(Boolean).join(' · '),
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
      text: (row) => row.field,
      render: (row) => row.field || '—',
    },
    {
      key: 'values',
      title: 'Было → стало',
      text: (row) => `${row.oldValue || '—'} → ${row.newValue || '—'}`,
      render: (row) => (
        <span className="mono">
          {row.oldValue || '—'} → {row.newValue || '—'}
        </span>
      ),
    },
    {
      key: 'reason',
      title: 'Комментарий',
      text: (row) => row.reason,
      render: (row) => row.reason || <span className="muted">—</span>,
    },
    {
      key: 'operation',
      title: 'Операция',
      text: (row) => row.operationId,
      render: (row) => (
        <span className="mono muted" title={row.operationId}>
          {row.operationId.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'rollback',
      title: 'Возврат',
      render: (row) =>
        NOT_REVERSIBLE.has(row.action) ? (
          <span className="muted">вручную</span>
        ) : (
          <button
            type="button"
            className="btn small ghost"
            disabled={busy}
            title={`Вернуть значения команды ${row.operationId.slice(0, 8)}`}
            onClick={() => setRollbackTarget(row)}
          >
            Вернуть
          </button>
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
        например, вставка блока из Excel или передача сразу нескольких позиций
        производству. «Вернуть» возвращает всю команду целиком и записывает свой возврат
        в журнал; строки, которые изменили после этой команды, не трогаются.
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

      {rollbackTarget ? (
        <ConfirmDialog
          title={`Вернуть операцию ${rollbackTarget.operationId.slice(0, 8)}?`}
          description={[
            'Будут возвращены прежние значения всех записей этой команды.',
            rollbackTarget.positionId ? `Строка: ${rollbackTarget.positionId}.` : '',
            'Если значение изменили после этой команды, строка останется как есть — её вернут вручную.',
          ]
            .filter(Boolean)
            .join(' ')}
          confirmText="Вернуть"
          reasonLabel="Причина возврата"
          busy={busy}
          onConfirm={(reason) => void rollback(rollbackTarget, reason)}
          onCancel={() => setRollbackTarget(null)}
        />
      ) : null}
    </div>
  );
}
