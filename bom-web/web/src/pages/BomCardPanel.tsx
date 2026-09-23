/**
 * Карточка спецификации: сводка, позиции и исправление «Ошибки данных».
 *
 * Карточка открывается прямо в списке спецификаций, не уводя пользователя на
 * отдельную страницу: экономисту обычно нужно быстро сверить строки и тут же
 * доделать то, что не пришло из файла.
 *
 * Зачем здесь правка полей спецификации. Импорт СОЗНАТЕЛЬНО оставляет строки с
 * пустыми обязательными полями — иначе дефицит по ним исчез бы из отчётов, — но
 * до этого экрана исправить их было нечем: позиция оставалась «Ошибкой данных» до
 * следующей выгрузки файла. Теперь недостающие поля заполняются прямо в строке, а
 * сама строка помечена перечнем того, чего не хватает.
 *
 * Что осталось неизменным: статусы и количества берутся с сервера как есть —
 * правка описания не пересчитывает ключ материала, и сервер честно сообщает об
 * этом пояснением к операции.
 */

import { useMemo, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { PositionDto } from '../api/types.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDate, formatDateTime } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { DataTable } from '../ui/DataTable.js';
import { StatCard } from '../ui/StatCard.js';
import { useToast } from '../ui/ToastProvider.js';
import { buildBomCardColumns } from './bomCardColumns.js';
import { requiresFix, type SpecFieldName } from './bomSpecFields.js';

export function BomCardPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [onlyErrors, setOnlyErrors] = useState(false);

  const { data, loading, error, reload } = useLoader(`bom|${code}`, () => api.fetchBomCard(code));

  const canEdit = can('SOURCE_BOM_WRITE');
  const positions = useMemo(() => data?.positions ?? [], [data]);
  const brokenCount = useMemo(() => positions.filter(requiresFix).length, [positions]);
  const rows = useMemo(
    () => (onlyErrors ? positions.filter(requiresFix) : positions),
    [positions, onlyErrors],
  );

  /**
   * Сохранить поле спецификации.
   *
   * Возвращает `true` только при фактическом изменении: по этому признаку
   * редактируемое поле решает, оставлять ли введённое значение. Отказ правил
   * («позиция удалена», «нет прав») приходит обычным результатом, поэтому
   * пользователь видит причину, а поле возвращается к значению сервера.
   */
  const saveField = async (
    row: PositionDto,
    field: SpecFieldName,
    value: string | number | null,
  ): Promise<boolean> => {
    const reply = await run(() => api.setSpecField(row.positionId, field, value));
    if (!reply) {
      return false;
    }
    if (reply.status === 'blocked') {
      toast.error(reply.reason || 'Правка отклонена правилами');
      return false;
    }
    if (reply.status === 'already') {
      toast.info('Значение уже такое — изменений нет');
      return false;
    }
    // Пояснение сервера важнее короткого «сохранено»: оно объясняет, например,
    // почему ключ материала остался прежним и что будет при следующем импорте.
    if (reply.notice) {
      toast.info(reply.notice);
    } else {
      toast.success('Изменение сохранено');
    }
    reload();
    return true;
  };

  const columns = useMemo(
    () => buildBomCardColumns({ canEdit, busy, onSave: saveField }),
    // Набор колонок зависит от прав и от признака «идёт запрос»: вместе с ним
    // обновляются `disabled` у полей и заголовки-подсказки.
    [canEdit, busy, data],
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Карточка: {code}</h2>
          <div className="hint">
            {data ? data.statusText : 'Загружаю состояние…'}
            {data ? ` · обновлена ${formatDateTime(data.bom.updatedAt)}` : ''}
          </div>
          <div className="hint">
            {canEdit
              ? 'Поля спецификации правятся прямо в строке: Enter — сохранить, Escape — отменить. Каждая правка попадает в журнал с указанием автора.'
              : 'Спецификацию правит экономист: поля видны, но не редактируются.'}
          </div>
        </div>
        <div className="row tight">
          {brokenCount > 0 ? (
            <label
              className="check-line"
              title="Оставить только позиции с незаполненными обязательными полями"
            >
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(event) => setOnlyErrors(event.target.checked)}
              />
              Только с ошибкой ({brokenCount})
            </label>
          ) : (
            <span className="badge ok">Ошибок данных нет</span>
          )}
          <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
            Обновить
          </button>
          <button type="button" className="btn small" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
      {loading && !data ? <div className="empty-state">Загружаю карточку…</div> : null}

      {data ? (
        <>
          <div className="grid-cards">
            <StatCard title="Позиций" value={data.aggregate.total} />
            <StatCard title="Передано" value={data.aggregate.collected} />
            <StatCard
              title="На складе, ждёт отборки"
              value={data.aggregate.onShelf}
              kind={data.aggregate.onShelf > 0 ? 'accent' : 'plain'}
            />
            <StatCard title="Ждёт поставки" value={data.aggregate.awaitingSupply} />
            <StatCard
              title="Ошибок данных"
              value={data.aggregate.errors}
              kind={data.aggregate.errors > 0 ? 'alert' : 'plain'}
            />
            <StatCard title="Ближайший срок" value={formatDate(data.aggregate.minDeadline)} />
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.positionId}
            emptyText={onlyErrors ? 'Позиций с ошибкой данных нет' : 'В спецификации нет позиций'}
            rowBackground={(row) =>
              requiresFix(row)
                ? 'var(--row-gray)'
                : row.lifecycle === 'ARCHIVED'
                  ? 'var(--row-received)'
                  : undefined
            }
          />
        </>
      ) : null}
    </section>
  );
}
