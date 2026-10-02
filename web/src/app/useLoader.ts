/**
 * Загрузка данных экрана.
 *
 * Экран описывает, ЧТО загрузить, а хук отвечает за состояния «идёт загрузка»,
 * «ошибка», «данные» и за повторную загрузку. Ключ (`key`) определяет, когда
 * данные нужно перечитать: например, при смене фильтра по проекту.
 *
 * Загрузка не отменяет предыдущий запрос, но её результат игнорируется, если
 * ключ успел измениться — иначе на экране мог бы оказаться ответ от прошлого
 * фильтра.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client.js';
import { useSession } from '../session/SessionContext.js';

export interface LoaderState<Data> {
  data: Data | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

/** Показать ошибку загрузки человеческим языком. */
function describe(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return `Не удалось загрузить данные: ${error.message}`;
  }
  return 'Не удалось загрузить данные: сервер недоступен';
}

export function useLoader<Data>(key: string, load: () => Promise<Data>): LoaderState<Data> {
  const { handleError } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Функция загрузки пересоздаётся на каждом рендере: держим её в ссылке, чтобы
  // перезагрузка зависела только от ключа и явного запроса.
  const loadRef = useRef(load);
  loadRef.current = load;
  const handleErrorRef = useRef(handleError);
  handleErrorRef.current = handleError;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((failure: unknown) => {
        if (cancelled) {
          return;
        }
        handleErrorRef.current(failure);
        setError(describe(failure));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { data, loading, error, reload };
}
