/**
 * Состояние входа в систему.
 *
 * Интерфейс не хранит токен: он живёт в cookie, а приложение лишь спрашивает у
 * сервера «кто я». Поэтому после перезагрузки страницы доступ восстанавливается
 * сам, а выход — это один запрос, который удаляет сессию на сервере.
 *
 * Права приходят вместе с пользователем. Они используются, чтобы показать только
 * доступные поля и кнопки. Сервер проверяет права повторно: интерфейс не является
 * защитой, он лишь избавляет от попыток сделать запрещённое.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiError } from '../api/client.js';
import * as api from '../api/endpoints.js';
import type { SessionUser } from '../api/types.js';

interface SessionValue {
  user: SessionUser | null;
  /** Идёт первичная проверка сессии. */
  loading: boolean;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Есть ли у текущей роли указанное право. */
  can: (permission: string) => boolean;
  /** Сообщить о сетевой ошибке: если сессия истекла — выйти из системы. */
  handleError: (error: unknown) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchSession()
      .then((response) => {
        if (!cancelled) {
          setUser(response.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (login: string, password: string) => {
    const response = await api.login(login, password);
    setUser(response.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.changePassword(currentPassword, newPassword);
  }, []);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.isUnauthorized) {
      setUser(null);
    }
  }, []);

  const value = useMemo<SessionValue>(() => {
    const can = (permission: string): boolean =>
      Boolean(user?.permissions?.includes(permission));
    return { user, loading, signIn, signOut, changePassword, can, handleError };
  }, [user, loading, signIn, signOut, changePassword, handleError]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Доступ к состоянию сессии (вне провайдера — ошибка разработчика). */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession вызван вне SessionProvider');
  }
  return value;
}
