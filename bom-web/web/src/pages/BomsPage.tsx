/**
 * Спецификации: импорт файлов, список и карточки.
 *
 * Наполнение гибридное: спецификация приходит файлом (Excel или CSV) либо
 * создаётся вручную, а позиции правятся через импорт. Код спецификации — это имя
 * файла без расширения, поэтому повторная загрузка того же файла обновляет ту же
 * спецификацию, а не создаёт вторую.
 *
 * Сразу после импорта показывается отчёт: сколько позиций добавлено, обновлено и
 * какие строки требуют правки (например, без крайнего срока).
 */

import { useRef, useState } from 'react';

import * as api from '../api/endpoints.js';
import type { BomImportReport, BomSummary } from '../api/adminTypes.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDateTime } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';
import { BomCardPanel } from './BomCardPanel.js';

/** Прочитать выбранный файл и вернуть его содержимое в base64. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

export function BomsPage() {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [report, setReport] = useState<BomImportReport | null>(null);
  const [openCode, setOpenCode] = useState('');
  const [toDelete, setToDelete] = useState<BomSummary | null>(null);

  const { data, loading, error, reload } = useLoader('boms', api.fetchBoms);
  const canWrite = can('SOURCE_BOM_WRITE');
  const canDone = can('DASHBOARD_CHECKBOX');

  const importFile = async (file: File): Promise<void> => {
    const result = await run(async () => {
      const contentBase64 = await readFileAsBase64(file);
      return api.importBom(file.name, contentBase64);
    });
    if (!result) {
      return;
    }
    setReport(result);
    toast.success(
      `Спецификация «${result.bomCode}»: добавлено ${result.inserted}, обновлено ${result.updated}`,
    );
    reload();
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      void importFile(file);
    }
  };

  const setDone = async (bom: BomSummary, done: boolean): Promise<void> => {
    const result = await run(() => api.setBomDone(bom.code, done));
    if (!result) {
      return;
    }
    toast.success(done ? `«${bom.code}» отмечена выполненной` : `«${bom.code}» возвращена в работу`);
    reload();
  };

  const removeBom = async (bom: BomSummary): Promise<void> => {
    const result = await run(() => api.deleteBom(bom.code));
    setToDelete(null);
    if (!result) {
      return;
    }
    toast.success(`Удалено: «${bom.code}» и ${result.deletedPositions} поз.`);
    if (openCode === bom.code) {
      setOpenCode('');
    }
    reload();
  };

  const columns: Array<Column<BomSummary>> = [
    {
      key: 'code',
      title: 'Спецификация',
      sortValue: (row) => row.code,
      render: (row) => (
        <div className="mono">
          {row.code}
          <div className="muted">ревизия {row.revision}</div>
        </div>
      ),
    },
    {
      key: 'positions',
      title: 'Позиций',
      numeric: true,
      sortValue: (row) => row.positionCount,
      render: (row) => row.positionCount,
    },
    {
      key: 'source',
      title: 'Источник',
      render: (row) => row.sourceNote || <span className="muted">—</span>,
    },
    {
      key: 'done',
      title: 'Состояние',
      sortValue: (row) => (row.isDone ? 1 : 0),
      render: (row) =>
        row.isDone ? (
          <span className="badge ok">Выполнена</span>
        ) : (
          <span className="badge neutral">В работе</span>
        ),
    },
    {
      key: 'updatedAt',
      title: 'Обновлена',
      sortValue: (row) => row.updatedAt,
      render: (row) => formatDateTime(row.updatedAt),
    },
    {
      key: 'actions',
      title: 'Действия',
      render: (row) => (
        <div className="row tight">
          <button
            type="button"
            className="btn small"
            onClick={() => setOpenCode(openCode === row.code ? '' : row.code)}
          >
            {openCode === row.code ? 'Скрыть' : 'Карточка'}
          </button>
          {canDone ? (
            <button
              type="button"
              className="btn small"
              disabled={busy}
              title={
                row.isDone
                  ? 'Снять отметку и вернуть в работу'
                  : 'Отметить выполненной (только если всё передано)'
              }
              onClick={() => void setDone(row, !row.isDone)}
            >
              {row.isDone ? 'Вернуть в работу' : 'Готово'}
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              className="btn small danger"
              disabled={busy}
              onClick={() => setToDelete(row)}
            >
              Удалить
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Спецификации</h1>
          <div className="hint">
            Загрузка спецификаций файлом Excel или CSV. Колонки распознаются по
            заголовкам; обязательны «№ п/п» и «Наименование». Код спецификации — имя файла
            без расширения, поэтому повторная загрузка обновляет ту же спецификацию.
          </div>
        </div>
        <div className="row">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,text/csv"
            className="hidden-input"
            onChange={onFileChange}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!canWrite || busy}
            title={canWrite ? 'Загрузить спецификацию' : 'Импорт доступен экономисту'}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="file" size={16} />
            {busy ? 'Загружаю…' : 'Загрузить спецификацию'}
          </button>
          <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
            <Icon name="refresh" size={14} />
            Обновить
          </button>
        </div>
      </div>

      {report ? (
        <div className="panel">
          <div className="panel-head">
            <h3>Отчёт об импорте: {report.bomCode}</h3>
            <button type="button" className="btn small ghost" onClick={() => setReport(null)}>
              Закрыть отчёт
            </button>
          </div>
          <div className="row">
            <span className="badge neutral">В файле строк: {report.totalInFile}</span>
            <span className="badge ok">Добавлено: {report.inserted}</span>
            <span className="badge stock">Обновлено: {report.updated}</span>
            <span className="badge wait">Удалено: {report.deleted}</span>
            {report.markedRemoved > 0 ? (
              <span className="badge late">Помечено удалёнными: {report.markedRemoved}</span>
            ) : null}
          </div>
          <div className="muted">Распознаны колонки: {report.foundColumns.join(', ')}</div>
          {report.incomplete.length ? (
            <div>
              <strong>Требуют правки спецификации ({report.incomplete.length}):</strong>
              <ul>
                {report.incomplete.slice(0, 50).map((item) => (
                  <li key={`${item.sourceLine}|${item.name}`}>
                    строка {item.sourceLine}: {item.name} — {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.skipped.length ? (
            <div>
              <strong>Пропущены ({report.skipped.length}):</strong>
              <ul>
                {report.skipped.slice(0, 20).map((item) => (
                  <li key={`skip|${item.sourceLine}`}>
                    строка {item.sourceLine}: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю список спецификаций…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={data.boms}
          rowKey={(row) => row.code}
          emptyText="Спецификаций пока нет — загрузите файл"
        />
      ) : null}

      {openCode ? <BomCardPanel code={openCode} onClose={() => setOpenCode('')} /> : null}

      {toDelete ? (
        <ConfirmDialog
          title={`Удалить спецификацию «${toDelete.code}»?`}
          description={`Будет удалено позиций: ${toDelete.positionCount}. Архив, история и журнал сохранятся — следы переданных материалов не удаляются.`}
          confirmText="Удалить"
          danger
          busy={busy}
          onConfirm={() => void removeBom(toDelete)}
          onCancel={() => setToDelete(null)}
        />
      ) : null}
    </div>
  );
}
