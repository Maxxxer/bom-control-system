/**
 * Область для перетаскивания файлов.
 *
 * Перетаскивание — основной способ загрузить файл: обычный выбор в диалоге
 * требует лишних кликов и теряется в папках с архивами спецификаций. Диалог при
 * этом остаётся: перетаскивание недоступно с телефона и планшета, а также для
 * пользователей, работающих одной рукой на клавиатуре.
 *
 * Область сделана доступной с клавиатуры (Enter/Пробел открывают тот же диалог) и
 * объявляет состояние для программ экранного доступа.
 *
 * Файлы неподходящего типа не отправляются на сервер: импорт тратит время и
 * место на разбор заведомо негодного файла. Их имена возвращаются через
 * `onRejected`, чтобы интерфейс объяснил, что именно не принято.
 */

import { useCallback, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

import { Icon } from './icons.js';

export interface DropZoneProps {
  /** Расширения через запятую: `.xls,.xlsx,.csv`. Используется и в accept, и в проверке. */
  accept: string;
  /** Разрешено ли несколько файлов за один раз. */
  multiple?: boolean;
  /** Заблокирована ли область (нет права на импорт или идёт загрузка). */
  disabled?: boolean;
  /** Заголовок области. */
  title: string;
  /** Пояснение под заголовком: что именно сюда можно перетащить. */
  hint: string;
  /** Принятые файлы — уже отфильтрованные по расширению. */
  onFiles: (files: File[]) => void;
  /** Имена файлов, которые не подошли по расширению. */
  onRejected?: (names: string[]) => void;
}

/** Расширения из строки accept вида «.xls,.xlsx,.csv». */
function parseAccept(accept: string): string[] {
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.startsWith('.'));
}

/** Расширение имени файла в нижнем регистре с точкой. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export function DropZone({
  accept,
  multiple = false,
  disabled = false,
  title,
  hint,
  onFiles,
  onRejected,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isOver, setIsOver] = useState(false);
  // Счётчик вложенности: событие dragleave приходит и при проходе курсора над
  // дочерними элементами области, и без счётчика подсветка мигает.
  const depth = useRef(0);

  const extensions = useMemo(() => parseAccept(accept), [accept]);

  const submit = useCallback(
    (incoming: File[]) => {
      const accepted: File[] = [];
      const rejected: string[] = [];
      for (const file of incoming) {
        if (extensions.includes(extensionOf(file.name))) {
          accepted.push(file);
        } else {
          rejected.push(file.name);
        }
      }
      if (rejected.length && onRejected) {
        onRejected(rejected);
      }
      const list = multiple ? accepted : accepted.slice(0, 1);
      if (list.length) {
        onFiles(list);
      }
    },
    [extensions, multiple, onFiles, onRejected],
  );

  const openDialog = useCallback(() => {
    if (!disabled) {
      inputRef.current?.click();
    }
  }, [disabled]);

  const onDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    depth.current += 1;
    setIsOver(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    // Без preventDefault браузер не разрешит сброс, и файл просто не откроется.
    event.preventDefault();
    if (disabled) {
      return;
    }
    event.dataTransfer.dropEffect = 'copy';
    setIsOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) {
      setIsOver(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    depth.current = 0;
    setIsOver(false);
    if (disabled) {
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      submit(files);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDialog();
    }
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    // Сброс значения: без него повторный выбор того же файла не вызовет change.
    event.target.value = '';
    if (files.length) {
      submit(files);
    }
  };

  const className = ['drop-zone', isOver ? 'is-over' : '', disabled ? 'is-disabled' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={title}
      onClick={openDialog}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Icon name="file" size={22} />
      <div className="drop-zone-text">
        <div className="drop-zone-title">{title}</div>
        <div className="drop-zone-hint">{hint}</div>
      </div>
      {!disabled ? (
        <span className="btn small ghost drop-zone-action">
          <Icon name="file" size={14} />
          Выбрать файл{multiple ? 'ы' : ''}
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden-input"
        onChange={onInputChange}
      />
    </div>
  );
}