/**
 * Диалог подтверждения с обязательным пояснением.
 *
 * Используется там, где действие необратимо или требует причины: возврат позиции
 * из архива (причина обязательна) и удаление спецификации. Пока причина не
 * введена, кнопка подтверждения заблокирована — сервер такую операцию всё равно
 * отклонит, но пользователю лучше увидеть это сразу в форме.
 */

import { useEffect, useRef, useState } from 'react';

interface ConfirmDialogProps {
  title: string;
  description?: string;
  /** Подпись кнопки подтверждения. */
  confirmText?: string;
  /** Запрашивать причину (тогда она обязательна). */
  reasonLabel?: string;
  /** Опасное действие — кнопка красная. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmText = 'Подтвердить',
  reasonLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

  const reasonMissing = Boolean(reasonLabel) && !reason.trim();

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <h3>{title}</h3>
        {description ? <p className="muted">{description}</p> : null}

        {reasonLabel ? (
          <div className="field">
            <label htmlFor="confirm-reason">{reasonLabel}</label>
            <textarea
              id="confirm-reason"
              ref={inputRef}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {reasonMissing ? (
              <div className="error-text">Причина обязательна — без неё операция не выполняется</div>
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn primary'}
            disabled={busy || reasonMissing}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? 'Выполняется…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
