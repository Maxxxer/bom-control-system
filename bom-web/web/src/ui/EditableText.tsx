/**
 * Редактируемое текстовое поле в строке таблицы.
 *
 * Появился потому, что спецификацию нужно исправлять прямо в карточке: строка,
 * загруженная без модели или единицы измерения, получает статус «Ошибка данных»
 * и не может уйти производству. Числового и календарного полей для этого мало —
 * правится именно текст.
 *
 * Поведение намеренно повторяет `EditableNumber` и `EditableDate`:
 *   * вне редактирования поле показывает значение, пришедшее с сервера;
 *   * Enter или уход из поля сохраняют, Escape отменяет;
 *   * на фокусе значение выделяется целиком — иначе первый символ дописывается к
 *     прежнему тексту и вместо «R-1» получается «R-1R»;
 *   * сервер остаётся источником истины: после ответа поле показывает то, что
 *     хранится в базе, а не то, что успел набрать пользователь.
 */

import { useEffect, useState, type KeyboardEvent } from 'react';

interface EditableTextProps {
  value: string;
  /** Поле недоступно этой роли (или идёт другая операция). */
  disabled?: boolean;
  title?: string;
  /** Название поля для сообщения об ошибке: «Модель», «Ед.изм» и т. п. */
  label: string;
  /** Пустое значение допустимо (артикул и производитель необязательны). */
  allowEmpty?: boolean;
  /** Подсказка внутри пустого поля. */
  placeholder?: string;
  /** Сохранить значение. Возвращает `true`, если данные обновлены. */
  onSave: (next: string) => Promise<boolean>;
}

export function EditableText({
  value,
  disabled,
  title,
  label,
  allowEmpty = false,
  placeholder,
  onSave,
}: EditableTextProps) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * Подсказка = назначение поля + текущее значение.
   *
   * В карточке спецификации колонки узкие (в одну строку), и длинное значение —
   * наименование, производитель — обрезается. Без значения в подсказке
   * пользователь видит «Алюминиевый проф…» и не может прочитать остаток, не
   * начиная правку.
   */
  const fieldLabel = title ?? label;
  const fieldTitle = value ? `${fieldLabel}: ${value}` : fieldLabel;

  // Вне редактирования поле всегда показывает состояние сервера.
  useEffect(() => {
    if (!editing) {
      setText(value);
    }
  }, [value, editing]);

  const commit = async (): Promise<void> => {
    const next = text.trim();
    if (!next && !allowEmpty) {
      setError(`${label}: поле обязательно — без него позиция остаётся «Ошибкой данных»`);
      return;
    }
    setError('');
    if (next === value) {
      setEditing(false);
      setText(value);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
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
      setText(value);
    }
  };

  return (
    <div>
      <input
        className="cell-text"
        type="text"
        value={text}
        placeholder={placeholder}
        disabled={disabled || busy}
        title={fieldTitle}
        aria-label={fieldLabel}
        aria-invalid={error ? true : undefined}
        onFocus={(event) => {
          setEditing(true);
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
