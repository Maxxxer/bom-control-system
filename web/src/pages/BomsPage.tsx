/**
 * Спецификации: импорт файлов, список и карточки.
 *
 * Наполнение гибридное: спецификация приходит файлом (Excel или CSV) либо
 * создаётся вручную, а позиции правятся через импорт. Код спецификации — это имя
 * файла без расширения, поэтому повторная загрузка того же файла обновляет ту же
 * спецификацию, а не создаёт вторую.
 *
 * Файлы можно перетащить в область на странице или выбрать диалогом — оба способа
 * равноправны: перетаскивание не работает с телефона, а у людей, ведущих архив
 * спецификаций в папке, диалог быстрее. Файлов за раз может быть несколько:
 * загружать спецификации по одной утомительно, а отчёт собирается по всем сразу.
 *
 * Сразу после импорта показывается отчёт: сколько позиций добавлено, обновлено и
 * какие строки требуют правки (например, без крайнего срока).
 */

import { useState } from 'react';

import * as api from '../api/endpoints.js';
import type { BomImportReport, BomSummary } from '../api/adminTypes.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDateTime } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { DropZone } from '../ui/DropZone.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';
import { BomCardPanel } from './BomCardPanel.js';

/** Форматы, которые принимает импорт. Порядок повторяет подсказку на экране. */
const IMPORT_ACCEPT = '.xls,.xlsx,.csv';

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
  const [reports, setReports] = useState<BomImportReport[]>([]);
  const [openCode, setOpenCode] = useState('');
  const [toDelete, setToDelete] = useState<BomSummary | null>(null);

  const { data, loading, error, reload } = useLoader('boms', api.fetchBoms);
  const canWrite = can('SOURCE_BOM_WRITE');
  const canDone = can('DASHBOARD_CHECKBOX');

  /**
   * Загрузить один файл и вернуть его отчёт (или undefined, если не вышло).
   *
   * Файлы обрабатываются по очереди, а не одновременно: каждый импорт — это
   * отдельная транзакция, и параллельная загрузка десяти файлов на слабом сервере
   * приводит к взаимным блокировкам и тайм-аутам.
   */
  const importFile = async (file: File): Promise<BomImportReport | undefined> =>
    run(async () => {
      const contentBase64 = await readFileAsBase64(file);
      return api.importBom(file.name, contentBase64);
    });

  const importFiles = async (files: File[]): Promise<void> => {
    if (!files.length) {
      return;
    }
    const collected: BomImportReport[] = [];
    let failed = 0;

    for (const file of files) {
      const result = await importFile(file);
      if (result) {
        collected.push(result);
      } else {
        failed += 1;
      }
    }

    if (collected.length) {
      setReports(collected);
      const added = collected.reduce((sum, report) => sum + report.inserted, 0);
      const updated = collected.reduce((sum, report) => sum + report.updated, 0);
      if (collected.length === 1) {
        toast.success(
          `Спецификация «${collected[0]?.bomCode}»: добавлено ${collected[0]?.inserted}, обновлено ${collected[0]?.updated}`,
        );
      } else {
        toast.success(
          `Загружено спецификаций: ${collected.length}. Добавлено позиций: ${added}, обновлено: ${updated}`,
        );
      }
    }

    // Отчёт об ошибке по каждому файлу уже показан тостом; здесь — только итог.
    if (failed) {
      toast.error(`Не загружено файлов: ${failed}`);
    }
    reload();
  };

  const onRejected = (names: string[]): void => {
    toast.error(
      `Не поддерживается: ${names.join(', ')}. Поддерживаются .xls, .xlsx и .csv`,
    );
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
            Загрузка спецификаций файлом Excel (включая старый формат .xls) или CSV.
            Колонки распознаются по заголовкам; обязательны «№ п/п» и «Наименование».
            Код спецификации — имя файла без расширения, поэтому повторная загрузка
            обновляет ту же спецификацию.
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn small ghost" onClick={reload} disabled={busy}>
            <Icon name="refresh" size={14} />
            Обновить
          </button>
        </div>
      </div>

      {canWrite ? (
        <DropZone
          accept={IMPORT_ACCEPT}
          multiple
          disabled={busy}
          title={
            busy
              ? 'Загружаю спецификации…'
              : 'Перетащите сюда файлы спецификаций'
          }
          hint="Можно отпустить сразу несколько файлов — они загрузятся по очереди. Поддерживаются .xls, .xlsx и .csv. Код спецификации берётся из имени файла."
          onFiles={(files) => void importFiles(files)}
          onRejected={onRejected}
        />
      ) : null}

      {reports.map((report) => (
        <div className="panel" key={report.bomCode}>
          <div className="panel-head">
            <h3>Отчёт об импорте: {report.bomCode}</h3>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => setReports(reports.filter((item) => item.bomCode !== report.bomCode))}
            >
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
                  <li key={`${report.bomCode}|${item.sourceLine}|${item.name}`}>
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
                  <li key={`${report.bomCode}|skip|${item.sourceLine}`}>
                    строка {item.sourceLine}: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ))}

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
