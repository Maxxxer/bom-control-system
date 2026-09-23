/**
 * Лист «Снабжение» — свод по материалам.
 *
 * В отличие от сводки дефицитов, где строка — это позиция одной спецификации,
 * здесь строка — материал, а внутри показаны все проекты, которым он нужен, с
 * количеством и сроком. Это ответ на вопрос снабженца «сколько всего заказывать»:
 * один и тот же материал в разных спецификациях объединяется.
 *
 * Экран только читает данные: заказы и поставки вносятся в сводке дефицитов, а
 * здесь видно, как они складываются по всем проектам вместе.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { SupplyRow } from '../api/types.js';
import { useLoader } from '../app/useLoader.js';
import { formatDate, formatQty } from '../format.js';
import { MaterialCell, ProjectLines } from '../ui/Cells.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { ProjectFilter } from '../ui/ProjectFilter.js';

/** Отбор строк по материалу. */
function matchesSearch(row: SupplyRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) {
    return true;
  }
  return [row.materialName, row.model, row.materialCode, row.manufacturer]
    .join(' ')
    .toLowerCase()
    .includes(text);
}

export function SupplyPage() {
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useLoader('supply', api.fetchSupply);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((row) => matchesSearch(row, search)),
    [data, search],
  );

  const columns: Array<Column<SupplyRow>> = [
    {
      // Материал закреплён у левого края: он и есть строка этой витрины.
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
    { key: 'unit', title: 'Ед.', width: '64px', render: (row) => row.unit },
    {
      key: 'totalDeficit',
      title: 'Нужно всего',
      numeric: true,
      width: '120px',
      sortValue: (row) => row.totalDeficit,
      render: (row) => formatQty(row.totalDeficit),
    },
    {
      key: 'totalOrdered',
      title: 'Заказано',
      numeric: true,
      width: '108px',
      sortValue: (row) => row.totalOrdered,
      render: (row) => formatQty(row.totalOrdered),
    },
    {
      key: 'totalRealDelivery',
      title: 'Поставлено',
      numeric: true,
      width: '116px',
      sortValue: (row) => row.totalRealDelivery,
      render: (row) => formatQty(row.totalRealDelivery),
    },
    {
      key: 'projects',
      title: 'Проекты и сроки',
      width: '420px',
      render: (row) => (
        <ProjectLines
          lines={row.projects.map(
            (entry) =>
              `${entry.projectCode} — ${formatQty(entry.deficitQty)} ${row.unit}, ` +
              `срок: ${formatDate(entry.deadline)}`,
          )}
        />
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Снабжение</h1>
          <div className="hint">
            Один материал — все проекты, где он нужен. Показаны суммарная потребность,
            заказ и фактический приход, а также сроки по каждому проекту.
          </div>
        </div>
        {data ? (
          <div className="row">
            <span className="badge neutral">Материалов: {data.totals.rows}</span>
            <span className="badge bad">
              Нужно: {formatQty(data.totals.totalDeficit)}
            </span>
            <span className="badge wait">
              Заказано: {formatQty(data.totals.totalOrdered)}
            </span>
            <span className="badge ok">
              Поставлено: {formatQty(data.totals.totalRealDelivery)}
            </span>
          </div>
        ) : null}
      </div>

      <ProjectFilter
        projects={[]}
        value=""
        onChange={() => undefined}
        search={search}
        onSearchChange={setSearch}
        shownCount={rows.length}
        totalCount={data?.rows.length ?? 0}
      />

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю материалы…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.materialKey}
          emptyText="Материалов с потребностью нет"
        />
      ) : null}
    </div>
  );
}
