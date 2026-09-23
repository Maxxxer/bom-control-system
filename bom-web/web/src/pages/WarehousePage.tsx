/**
 * Склад — остатки, резервы и свободный остаток.
 *
 * Кладовщик вводит только фактический остаток; резерв приходит из спецификаций, а
 * свободный остаток считается как «остаток − резерв». Строки, где резерв больше
 * остатка, выделены: это значит, что материал обещан производству в объёме,
 * которого физически нет, и это надо разрешить (довезти, пересчитать или сообщить
 * снабженцу).
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { WarehouseRow } from '../api/types.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { numberOrZero } from '../api/client.js';
import { formatQty } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { Column, DataTable, type DataTableBulk } from '../ui/DataTable.js';
import { EditableNumber } from '../ui/EditableNumber.js';
import { StatCard } from '../ui/StatCard.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';

/** Отбор строк по материалу. */
function matchesSearch(row: WarehouseRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) {
    return true;
  }
  return [row.name, row.model, row.code, row.manufacturer].join(' ').toLowerCase().includes(text);
}

export function WarehousePage() {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useLoader('warehouse', api.fetchWarehouse);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((row) => matchesSearch(row, search)),
    [data, search],
  );

  const canEdit = can('WAREHOUSE_QTY');

  /**
   * Массовый ввод остатков: одна команда на всю вставку столбца из Excel.
   *
   * У складской команды одно поле — остаток, поэтому `field` из таблицы здесь не
   * используется: он нужен таблице, чтобы знать, что колонка участвует в вводе.
   * Значение уходит текстом, разбирает его сервер (пробелы разрядов, запятая).
   */
  const bulk: DataTableBulk<WarehouseRow> = {
    rowIdOf: (row) => row.materialKey,
    submit: async (changes) => {
      const reply = await run(() =>
        api.applyWarehouseBulk(
          changes.map((change) => ({
            materialKey: change.rowId,
            quantity: change.value,
          })),
        ),
      );
      return reply;
    },
  };

  const saveQty = async (materialKey: string, quantity: number): Promise<boolean> => {
    const result = await run(() => api.setWarehouseQty(materialKey, quantity));
    if (!result) {
      return false;
    }
    if (result.previousQty === result.warehouseQty) {
      toast.info('Остаток не изменился');
    } else {
      toast.success(
        `Остаток сохранён: ${formatQty(result.previousQty)} → ${formatQty(result.warehouseQty)}; ` +
          `свободно ${formatQty(result.freeQty)}`,
      );
    }
    reload();
    return true;
  };

  const columns: Array<Column<WarehouseRow>> = [
    {
      key: 'material',
      title: 'Материал',
      sortValue: (row) => `${row.name} ${row.model}`,
      text: (row) => row.name,
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
    { key: 'unit', title: 'Ед.', text: (row) => row.unit, render: (row) => row.unit },
    {
      key: 'warehouseQty',
      title: 'Остаток',
      sortValue: (row) => row.warehouseQty,
      text: (row) => formatQty(row.warehouseQty),
      bulkField: 'warehouseQty',
      readOnly: !canEdit,
      render: (row) => (
        <EditableNumber
          value={row.warehouseQty}
          disabled={!canEdit || busy}
          title={canEdit ? 'Фактический остаток' : 'Остаток вводит кладовщик'}
          onSave={(next) => saveQty(row.materialKey, numberOrZero(String(next)))}
        />
      ),
    },
    {
      key: 'reservedQty',
      title: 'Резерв',
      numeric: true,
      sortValue: (row) => row.reservedQty,
      text: (row) => formatQty(row.reservedQty),
      render: (row) => formatQty(row.reservedQty),
    },
    {
      key: 'freeQty',
      title: 'Свободно',
      numeric: true,
      sortValue: (row) => row.freeQty,
      text: (row) => formatQty(row.freeQty),
      render: (row) => formatQty(row.freeQty),
    },
    {
      key: 'positions',
      title: 'Позиций',
      numeric: true,
      sortValue: (row) => row.positionsCount,
      text: (row) => String(row.positionsCount),
      render: (row) => row.positionsCount,
    },
    {
      key: 'requiredTotal',
      title: 'Потребность',
      numeric: true,
      sortValue: (row) => row.requiredTotal,
      text: (row) => formatQty(row.requiredTotal),
      render: (row) => formatQty(row.requiredTotal),
    },
    {
      key: 'flag',
      title: 'Состояние',
      sortValue: (row) => (row.inconsistent ? 0 : 1),
      render: (row) =>
        row.inconsistent ? (
          <span className="badge bad" title="Резерв больше фактического остатка">
            Резерв больше остатка
          </span>
        ) : row.hasRecord ? (
          <span className="badge ok">Учтено</span>
        ) : (
          <span className="badge neutral">Остаток не вводился</span>
        ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Склад</h1>
          <div className="hint">
            Остаток вводит кладовщик. Резерв складывается из потребностей активных
            спецификаций, свободный остаток — это остаток минус резерв. Массовый ввод:
            Shift+щелчок выделяет столбец ячеек, Ctrl+V вставляет значения из Excel.
          </div>
        </div>
        {data ? (
          <div className="row">
            <span className="badge neutral">Материалов: {data.totals.rows}</span>
            <span className={data.totals.inconsistent > 0 ? 'badge bad' : 'badge ok'}>
              Несоответствий: {data.totals.inconsistent}
            </span>
          </div>
        ) : null}
      </div>

      {data ? (
        <div className="grid-cards">
          <StatCard title="Остаток всего" value={formatQty(data.totals.warehouseQty)} />
          <StatCard title="Зарезервировано" value={formatQty(data.totals.reservedQty)} />
          <StatCard title="Свободно" value={formatQty(data.totals.freeQty)} kind="accent" />
          <StatCard
            title="Резерв больше остатка"
            value={data.totals.inconsistent}
            note="Требует внимания кладовщика"
            kind={data.totals.inconsistent > 0 ? 'alert' : 'plain'}
          />
        </div>
      ) : null}

      <div className="row">
        <div className="field">
          <label htmlFor="warehouse-search">Поиск</label>
          <input
            id="warehouse-search"
            type="text"
            value={search}
            placeholder="Материал, модель, артикул"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
          <Icon name="refresh" size={14} />
          Обновить
        </button>
        {!canEdit ? (
          <span className="muted">Остатки вводит кладовщик</span>
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

      {loading && !data ? <div className="empty-state">Загружаю склад…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.materialKey}
          emptyText="Материалов на складе нет"
          rowBackground={(row) => (row.inconsistent ? 'var(--row-red)' : undefined)}
          bulk={bulk}
          busy={busy}
          onApplied={reload}
        />
      ) : null}
    </div>
  );
}
