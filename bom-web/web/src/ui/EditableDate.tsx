/**
 * Редактируемое поле даты в строке таблицы.
 *
 * Поле принимает дату в привычном виде `ДД.ММ.ГГГГ` (так её вводят с клавиатуры)
 * и в виде календаря браузера. Введённое проверяется сразу: если дата не
 * разбирается, сохранения не происходит и под полем появляется подсказка с
 * форматом. Пустое значение допустимо — оно означает «дата не задана».
 */

import { useEffect, useState, type KeyboardEvent } from 'react';

import { formatDate, parseDateInput } from '../format.js';

interface EditableDateProps {
  /** Дата в формате `ГГГГ-ММ-ДД` или `null`. */
  value: string | null;
  disabled?: boolean;
  title?: string;
  /** Разрешено ли пустое значение (снять дату). */
  allowEmpty?: boolean;
  onSave: (next: string | null) => Promise<boolean>;
}

export function EditableDate({
  value,
  disabled,
  title,
  allowEmpty = true,
  onSave,
}: EditableDateProps) {
  const [text, setText] = useState(() => (value ? formatDate(value) : ''));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * Подсказка = назначение поля + текущая дата. Пустая дата называется словами:
   * «Ожидаемая поставка: не задана» читается однозначно, а пустая подсказка у
   * незаполненного поля не объясняет ничего.
   */
  const valueHint = `${title ?? 'Дата'}: ${value ? formatDate(value) : 'не задана'}`;

  useEffect(() => {
    if (!editing) {
      setText(value ? formatDate(value) : '');
    }
  }, [value, editing]);

  const commit = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (!allowEmpty) {
        setError('Дату нельзя оставить пустой');
        return;
      }
      if (value === null) {
        setEditing(false);
        return;
      }
      setBusy(true);
      try {
        await onSave(null);
      } finally {
        setBusy(false);
        setEditing(false);
      }
      return;
    }

    const iso = parseDateInput(trimmed);
    if (!iso) {
      setError('Введите дату в виде ДД.ММ.ГГГГ, например 20.09.2026');
      return;
    }
    setError('');
    if (iso === value) {
      setEditing(false);
      setText(formatDate(value));
      return;
    }
    setBusy(true);
    try {
      await onSave(iso);
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
      setText(value ? formatDate(value) : '');
    }
  };

  return (
    <div>
      <input
        className="cell-date"
        type="text"
        value={text}
        placeholder="ДД.ММ.ГГГГ"
        disabled={disabled || busy}
        title={valueHint}
        aria-label={title ?? 'Дата'}
        aria-invalid={error ? true : undefined}
        onFocus={(event) => {
          setEditing(true);
          // Дата выделяется целиком: иначе новая дата дописывается к старой
          // (например, «30.09.2026» + «1» = «130.09.2026») и ввод отвергается.
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
