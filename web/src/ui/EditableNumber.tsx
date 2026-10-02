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
 *
 * Ввод числа устроен так, чтобы человек не мог сохранить не то, что хотел:
 *   * Delete обнуляет ячейку и сразу сохраняет — ноль это осмысленное значение
 *     (остатка нет, резерва нет, заказа нет), а не пустая ячейка;
 *   * первая же цифра ЗАМЕНЯЕТ прежнее значение целиком. Это важно из-за разделителей
 *     разрядов: в поле «1 234» дописанная цифра дала бы «1 2345», а не 12345.
 *     Значение выделяется при входе в поле, но выделение снимается щелчком мыши
 *     внутри ячейки, поэтому одной замены через select() мало — текст
 *     очищается ещё и по первой введённой цифре.
 *   * дальнейшие цифры дописываются справа: это обычный набор числа.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

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
  /**
   * В поле пока не начали вводить: показанное значение — целиком то, что пришло
   * с сервера. По этому признаку первая введённая цифра заменяет содержимое
   * целиком. Флаг, а не сравнение `text` со значением: если человек заново наберёт
   * то же самое число, текст совпадёт с серверным, но вводить он продолжает
   * осмысленно — дописывать справа.
   */
  const [fresh, setFresh] = useState(true);
  /** Delete уже отправил значение: уход из поля не должен слать его второй раз. */
  const skipBlurCommit = useRef(false);

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
      setFresh(true);
    }
  }, [value, editing]);

  const commit = async (explicit?: number): Promise<void> => {
    const checked = explicit === undefined ? validate(text) : { value: explicit };
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setError('');
    if (checked.value === value) {
      setEditing(false);
      setText(formatQty(value));
      setFresh(true);
      return;
    }
    setBusy(true);
    try {
      await onSave(checked.value);
    } finally {
      setBusy(false);
      setEditing(false);
      setFresh(true);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setError('');
      setEditing(false);
      setText(formatQty(value));
      setFresh(true);
      return;
    }
    // Delete обнуляет ячейку и сохраняет сразу: ноль — это значение, а не пустое
    // поле. Событие гасится и не поднимается выше: у таблицы своя обработка
    // Delete для выделенного блока, и без остановки одно нажатие обнулило бы ещё
    // и весь блок.
    if (event.key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      setEditing(true);
      setText('0');
      setFresh(false);
      // Уход из поля после Delete не должен сохранять второй раз: к этому
      // моменту значение уже отправлено.
      skipBlurCommit.current = true;
      void commit(0);
      return;
    }
    // Первая цифра или разделитель заменяет прежнее значение целиком: иначе
    // «1 234» + «5» даст «1 2345». Дальше цифры дописываются как обычно.
    const startsNewValue = /^[0-9.,]$/.test(event.key);
    if (startsNewValue && fresh) {
      setText('');
      setFresh(false);
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
          setFresh(true);
          skipBlurCommit.current = false;
          // Текущее значение выделяется целиком: иначе первый введённый символ
          // добавляется к прежнему числу (0 + 5 = 50) и снабженец сохраняет
          // неверное количество, не заметив этого.
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setText(event.target.value);
          setFresh(false);
        }}
        onBlur={() => {
          if (skipBlurCommit.current) {
            skipBlurCommit.current = false;
            return;
          }
          void commit();
        }}
        onKeyDown={handleKeyDown}
      />
      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}
