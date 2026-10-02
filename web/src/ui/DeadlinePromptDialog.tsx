/**
 * Окно ввода требуемой даты поставки для всей спецификации.
 *
 * Показывается сразу после импорта, когда в файле не оказалось колонки
 * «Крайний срок поставки». Без срока позиция не может быть передана
 * производству, а проставлять его в каждой строке вручную нереально: в боевых
 * спецификациях срок обычно общий для всего заказа. Поэтому человек вводит дату
 * один раз, и она ставится всем незаполненным позициям одной командой.
 *
 * Позиции, у которых срок уже заполнен, не затрагиваются: дата из окна
 * проставляется только туда, где её нет.
 */

import { useEffect, useRef, useState } from 'react';

interface DeadlinePromptProps {
  /** Код спецификации — показывается в пояснении. */
  bomCode: string;
  /** Сколько позиций останется без срока после импорта. */
  count: number;
  busy?: boolean;
  /** Возвращает дату в виде `ГГГГ-ММ-ДД` (как отдаёт поле ввода). */
  onConfirm: (isoDate: string) => void;
  onCancel: () => void;
}

export function DeadlinePromptDialog({
  bomCode,
  count,
  busy = false,
  onConfirm,
  onCancel,
}: DeadlinePromptProps) {
  const [date, setDate] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const empty = !date;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Введите требуемую дату поставки">
      <div className="modal">
        <h3>Введите требуемую дату поставки</h3>
        <p className="muted">
          В спецификации «{bomCode}» срок поставки не указан ни в одной строке.
          Без него материал нельзя передать производству. Укажите дату — она будет
          проставлена всем позициям без срока ({count}{' '}
          {count === 1 ? 'позиции' : 'позициям'}). Позиции со сроком не изменятся.
        </p>

        <div className="field">
          <label htmlFor="deadline-prompt-date">Требуемая дата поставки</label>
          <input
            id="deadline-prompt-date"
            ref={inputRef}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          {empty ? (
            <div className="error-text">Дата обязательна — без неё срок не будет проставлен</div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Пропустить
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || empty}
            onClick={() => onConfirm(date)}
          >
            {busy ? 'Проставляю…' : 'Проставить всем'}
          </button>
        </div>
      </div>
    </div>
  );
}