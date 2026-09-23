/**
 * Выполнение действий: состояние «идёт запрос» и показ ошибок.
 *
 * Любое изменение данных на экране проходит через `run`: кнопка на время запроса
 * блокируется (исключая двойное нажатие), а сетевая ошибка показывается
 * пользователю. Отказы по правилам (например, «не хватает материала») приходят
 * обычным результатом и обрабатываются вызывающим кодом отдельно — это не ошибка
 * связи, а ответ системы.
 */

import { useCallback, useState } from 'react';

import { ApiError } from '../api/client.js';
import { useSession } from '../session/SessionContext.js';
import { useToast } from '../ui/ToastProvider.js';

interface ActionValue {
  /** Действие выполняется прямо сейчас. */
  busy: boolean;
  /** Выполнить действие; при ошибке вернётся `undefined` и покажется сообщение. */
  run: <Result>(action: () => Promise<Result>) => Promise<Result | undefined>;
}

export function useAction(): ActionValue {
  const [busy, setBusy] = useState(false);
  const { handleError } = useSession();
  const toast = useToast();
  const notifyError = toast.error;

  const run = useCallback(
    async <Result,>(action: () => Promise<Result>): Promise<Result | undefined> => {
      setBusy(true);
      try {
        return await action();
      } catch (error: unknown) {
        handleError(error);
        notifyError(
          error instanceof ApiError
            ? error.message
            : 'Не удалось выполнить действие: сервер недоступен',
        );
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [handleError, notifyError],
  );

  return { busy, run };
}
