/**
 * Редактируемое числовое поле в строке таблицы.
 *
 * Требования к поведению (заданы заказчиком): изменение применяется сразу, а
 * ошибка показывается явно и понятно.
 *
 * Как это устроено:
 *   * пока поле не редактируется, оно показывает значение, пришедшее с сервера;
 *   * по Enter или при уходе из поля значение проверяется здесь же (число, не
 *     отрицательное). Если проверка не прошла — сохранения НЕ происходит, под
 *     полем появляется текст ошибки;
 *   * после ответа сервера поле снова показывает то, что пришло с сервера: если
 *     правило не позволило сохранить, пользователь видит прежнее значение, а не
 *     своё несохранённое.
 */

import { useEffect, useState, type KeyboardEvent } from 'react';

import { formatQty, } from '../format.js';
import { numberOrZero } from '../api/client.js';

interface EditableNumberProps {
  value: number;
  /** Поле недоступно этой роли. */
  disabled?: boolean;
  title?: string;
  /** Сохранить значение. Возвращает `true`, если данные обновлены. */
  onSave: (next: number) => Promise<boolean>;
}

/** Проверить введённый текст: пусто → 0, иначе неотрицательное число. */
function validate(text: string): { value: number } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: 0 };
  }
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { error: 'Введите неотрицательное число, например 10 или 2,5' };
  }
  const value = numberOrZero(normalized);
  return { value };
}

export function EditableNumber({ value, disabled, title, onSave }: EditableNumberProps) {
  const [text, setText] = useState(() => formatQty(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * В подсказку добавляется текущее значение: в узкой колонке (и при сквозной
   * проверке нескольких спецификаций) важно видеть, что стоит в поле, не
   * заходя в него — особенно у недоступного этой роли поля.
   */
  const valueHint = `${title ?? 'Значение'}: ${formatQty(value)}`;

  // Вне редактирования поле всегда показывает состояние сервера.
  useEffect(() => {
    if (!editing) {
      setText(formatQty(value));
    }
  }, [value, editing]);

  const commit = async (): Promise<void> => {
    const checked = validate(text);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setError('');
    if (checked.value === value) {
      setEditing(false);
      setText(formatQty(value));
      return;
    }
    setBusy(true);
    try {
      await onSave(checked.value);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setError('');
      setEditing(false);
      setText(formatQty(value));
    }
  };

  return (
    <div>
      <input
        className="cell-input"
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled || busy}
        title={valueHint}
        aria-label={title ?? 'Значение'}
        aria-invalid={error ? true : undefined}
        onFocus={(event) => {
          setEditing(true);
          // Текущее значение выделяется целиком: иначе первый введённый символ
          // добавляется к прежнему числу (0 + 5 = 50) и снабженец сохраняет
          // неверное количество, не заметив этого.
          event.currentTarget.select();
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={handleKeyDown}
      />
      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}
