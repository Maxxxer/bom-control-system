/**
 * Сводка дефицитов — рабочее место снабженца и экономиста.
 *
 * Здесь работа идёт прямо в строках таблицы: заказано, ожидаемая дата, реальная
 * поставка и крайний срок. Правка применяется сразу (без кнопки «Сохранить»),
 * потому что в прежней системе снабженец заполнял лист построчно и любая потеря
 * введённого при перезагрузке страницы была бы недопустима: сохранение идёт на
 * сервер, и только после его ответа поле показывает результат.
 *
 * Какое поле доступно — решает право роли. Остальные поля видны, но не
 * редактируются: снабженцу важно видеть срок и поставку, даже если менять их
 * может только экономист.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { DeficitRow, OperationReply } from '../api/types.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatQty } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { StatusBadge } from '../ui/Badge.js';
import { BomCell, MaterialCell } from '../ui/Cells.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { EditableCheckbox } from '../ui/EditableCheckbox.js';
import { EditableDate } from '../ui/EditableDate.js';
import { EditableNumber } from '../ui/EditableNumber.js';
import { ProjectFilter } from '../ui/ProjectFilter.js';
import { useToast } from '../ui/ToastProvider.js';

/** Отбор строк по поисковой строке (модель, артикул, наименование, производитель). */
function matchesSearch(row: DeficitRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) {
    return true;
  }
  return [row.model, row.materialCode, row.materialName, row.manufacturer, row.bomName]
    .join(' ')
    .toLowerCase()
    .includes(text);
}

export function DeficitPage() {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [project, setProject] = useState('');
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useLoader(
    `deficit|${project}`,
    () => api.fetchDeficit(project),
  );

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    return list.filter((row) => matchesSearch(row, search));
  }, [data, search]);

  /** Применить операцию и показать её исход; `true` — данные изменились. */
  const apply = async (action: () => Promise<OperationReply>): Promise<boolean> => {
    const reply = await run(action);
    if (!reply) {
      return false;
    }
    if (reply.status === 'blocked') {
      toast.error(reply.reason || 'Операция отклонена правилами');
      return false;
    }
    if (reply.status === 'already') {
      toast.info('Значение уже такое — изменений нет');
      return false;
    }
    toast.success('Изменение сохранено');
    reload();
    return true;
  };

  const canOrder = can('ORDERED_QTY');
  const canExpected = can('EXPECTED_DATE');
  const canDelivery = can('REAL_DELIVERY');
  const canDeadline = can('DEADLINE');

  const columns: Array<Column<DeficitRow>> = [
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
      key: 'unit',
      title: 'Ед.',
      width: '64px',
      render: (row) => row.unit,
    },
    {
      key: 'deficitQty',
      title: 'Потребность',
      numeric: true,
      width: '110px',
      sortValue: (row) => row.deficitQty,
      render: (row) => formatQty(row.deficitQty),
    },
    {
      key: 'orderedQty',
      title: 'Заказано',
      numeric: true,
      width: '100px',
      sortValue: (row) => row.orderedQty,
      render: (row) => (
        <EditableNumber
          value={row.orderedQty}
          disabled={!canOrder || busy}
          title={canOrder ? 'Заказано' : 'Заказано — меняет снабженец'}
          onSave={(next) => apply(() => api.setOrderedQty(row.positionId, next))}
        />
      ),
    },
    {
      key: 'expectedDate',
      title: 'Ожидаемая поставка',
      width: '120px',
      sortValue: (row) => row.expectedDate ?? '',
      render: (row) => (
        <EditableDate
          value={row.expectedDate}
          disabled={!canExpected || busy}
          title={canExpected ? 'Ожидаемая поставка' : 'Ожидаемая поставка — меняет снабженец'}
          onSave={(next) => apply(() => api.setExpectedDate(row.positionId, next))}
        />
      ),
    },
    {
      key: 'realDelivery',
      title: 'Поставлено',
      width: '96px',
      render: (row) => (
        <EditableCheckbox
          checked={row.realDelivery}
          disabled={!canDelivery || busy}
          title={canDelivery ? 'Реальная поставка' : 'Реальную поставку отмечает экономист'}
          onSave={(next) =>
            apply(() => api.setRealDeliveryChecked(row.positionId, next))
          }
        />
      ),
    },
    {
      key: 'deadline',
      title: 'Крайний срок',
      width: '120px',
      sortValue: (row) => row.deadline ?? '',
      render: (row) => (
        <EditableDate
          value={row.deadline}
          allowEmpty={false}
          disabled={!canDeadline || busy}
          title={canDeadline ? 'Крайний срок поставки' : 'Крайний срок — меняет экономист'}
          onSave={(next) => apply(() => api.setDeadline(row.positionId, next))}
        />
      ),
    },
    {
      key: 'status',
      title: 'Состояние',
      width: '176px',
      sortValue: (row) => row.statusKey,
      render: (row) => (
        <div>
          <StatusBadge statusKey={row.statusKey} text={row.statusText} />
          {row.uncoveredNeed > 0 ? (
            <div className="muted">не закрыто: {formatQty(row.uncoveredNeed)}</div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Сводка дефицитов</h1>
          <div className="hint">
            Потребность по позициям: что заказано, когда ждём поставку и что уже пришло.
            Изменения применяются сразу; если правило не позволяет сохранить — появится
            причина.
          </div>
        </div>
        {data ? (
          <div className="row">
            <span className="badge neutral">Позиций: {data.totals.rows}</span>
            <span className="badge bad">Дефицит: {formatQty(data.totals.deficitQty)}</span>
            <span className="badge wait">
              Не закрыто: {formatQty(data.totals.uncoveredNeed)}
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

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю позиции…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.positionId}
          emptyText="Нет позиций с потребностью — дефицита нет"
          rowBackground={(row) => (row.statusKey === 'ERROR' ? 'var(--row-gray)' : undefined)}
        />
      ) : null}

      <div className="muted">
        Формат даты: ДД.ММ.ГГГГ. Пустая ожидаемая дата означает «срок ещё не сообщён
        поставщиком». «Поставлено» отмечает фактический приход материала на склад.
      </div>
    </div>
  );
}
