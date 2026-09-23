/**
 * Всплывающие сообщения о результате действий.
 *
 * Каждое действие показывает исход: «применено», «уже так» или причину отказа.
 * Отказ по правилам показывается ДОЛЬШЕ и другим цветом — пользователю важно
 * успеть прочитать, почему строка не принята.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Icon } from './icons.js';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastValue {
  notify: (kind: ToastKind, text: string) => void;
  info: (text: string) => void;
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

/** Сколько держать сообщение на экране (мс). */
const DURATION: Record<ToastKind, number> = {
  info: 5000,
  success: 5000,
  error: 9000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, text: string) => {
      const message = String(text ?? '').trim();
      if (!message) {
        return;
      }
      const id = nextId.current++;
      setToasts((current) => [...current, { id, kind, text: message }]);
      window.setTimeout(() => remove(id), DURATION[kind]);
    },
    [remove],
  );

  const value = useMemo<ToastValue>(
    () => ({
      notify,
      info: (text: string) => notify('info', text),
      success: (text: string) => notify('success', text),
      error: (text: string) => notify('error', text),
    }),
    [notify],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.text}
            <button
              type="button"
              className="toast-close"
              aria-label="Закрыть сообщение"
              title="Закрыть сообщение"
              onClick={() => remove(toast.id)}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Доступ к сообщениям (вне провайдера — ошибка разработчика). */
export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast вызван вне ToastProvider');
  }
  return value;
}
