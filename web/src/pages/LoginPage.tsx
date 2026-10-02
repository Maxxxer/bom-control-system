/**
 * Экран входа.
 *
 * Локальные логины: логин и пароль проверяет сервер, браузер получает cookie
 * сессии. Ошибка показывается прямо в форме; текст ошибки одинаков и для
 * неверного логина, и для неверного пароля — так нельзя подобрать существующие
 * учётные записи перебором.
 *
 * Оформление по брендбуку: тёмно-синий фон, белый знак MAIR, белая карточка
 * формы с оранжевой линией сверху.
 */

import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client.js';
import { useSession } from '../session/SessionContext.js';
import { BrandMark } from '../ui/BrandMark.js';

export function LoginPage() {
  const { signIn } = useSession();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!login.trim() || !password) {
      setError('Введите логин и пароль');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await signIn(login.trim(), password);
    } catch (failure: unknown) {
      const message =
        failure instanceof ApiError ? failure.message : 'Не удалось войти: сервер недоступен';
      setError(message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-top">
        <BrandMark className="brand-mark" />
        <div className="login-tagline">
          завод холодильного и климатического оборудования
        </div>
      </div>

      <main className="login-main">
        <form className="login-card" onSubmit={(event) => void submit(event)}>
          <div>
            <h1>Вход в систему</h1>
            <div className="hint">
              Управление обеспечением сборки: спецификации, потребность, заказы, склад и
              передача материалов производству.
            </div>
          </div>

          <div className="field">
            <label htmlFor="login">Логин</label>
            <input
              id="login"
              type="text"
              value={login}
              autoComplete="username"
              autoFocus
              onChange={(event) => setLogin(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? <div className="error-text">{error}</div> : null}

          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Проверяю…' : 'Войти'}
          </button>
        </form>
      </main>

      <footer className="login-footer">
        Учётные записи создаёт администратор. Если доступа нет — обратитесь к нему.
      </footer>
    </div>
  );
}
