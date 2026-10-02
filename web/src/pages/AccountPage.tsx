/**
 * «Мой доступ»: что можно делать под этой ролью и смена пароля.
 *
 * Раздел отвечает на самый частый вопрос пользователя — «почему у меня нет нужной
 * кнопки»: здесь перечислены права роли человеческими словами. Здесь же меняется
 * пароль; после смены сервер закрывает остальные сессии, чтобы старый пароль
 * больше нигде не действовал.
 */

import { useEffect, useState, type FormEvent } from 'react';

import * as api from '../api/endpoints.js';
import type { MetaResponse } from '../api/adminTypes.js';
import { useAction } from '../app/useAction.js';
import { useSession } from '../session/SessionContext.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';

/** Минимальная длина пароля (совпадает с проверкой на сервере). */
const MIN_PASSWORD_LENGTH = 8;

export function AccountPage() {
  const { user, changePassword, signOut } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .fetchMeta()
      .then((result) => {
        if (!cancelled) {
          setMeta(result);
        }
      })
      .catch(() => {
        // Справочник нужен только для подписей прав: без него страница работает.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!current || !next) {
      setError('Заполните текущий и новый пароль');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`Новый пароль должен содержать не меньше ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }
    if (next !== repeat) {
      setError('Новый пароль и подтверждение не совпадают');
      return;
    }
    setError('');
    const done = await run(() => changePassword(current, next));
    if (done === undefined) {
      return;
    }
    toast.success('Пароль изменён. Остальные сессии закрыты');
    setCurrent('');
    setNext('');
    setRepeat('');
  };

  const permissionLabels = meta?.permissions ?? {};

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Мой доступ</h1>
          <div className="hint">
            {user
              ? `Вы вошли как «${user.fullName}» (логин ${user.login}). Роль: ${user.roleLabel}.`
              : ''}
          </div>
        </div>
        <button type="button" className="btn" onClick={() => void signOut()}>
          <Icon name="close" size={16} />
          Выйти из системы
        </button>
      </div>

      <section className="stack">
        <h2>Что доступно этой роли</h2>
        {user?.permissions.length ? (
          <ul>
            {user.permissions.map((permission) => (
              <li key={permission}>
                {permissionLabels[permission] ?? permission}
                <span className="mono muted"> ({permission})</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            Роль «{user?.roleLabel ?? ''}» работает только на чтение: изменения не доступны
          </div>
        )}
        <div className="muted">
          Остальные разделы видны, но поля в них заблокированы — это ожидаемое поведение,
          а не ошибка. Права выдаёт администратор.
        </div>
      </section>

      <section className="stack">
        <h2>Смена пароля</h2>
        <form className="inline-form" onSubmit={(event) => void submit(event)}>
          {/*
            Скрытое поле логина: менеджеры паролей иначе не понимают, к какой
            учётной записи относится новая пара, и предлагают сохранить её вслепую.
          */}
          <input
            type="text"
            name="username"
            value={user?.login ?? ''}
            autoComplete="username"
            readOnly
            hidden
          />
          <div className="field">
            <label htmlFor="current-password">Текущий пароль</label>
            <input
              id="current-password"
              type="password"
              value={current}
              autoComplete="current-password"
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="next-password">Новый пароль</label>
            <input
              id="next-password"
              type="password"
              value={next}
              autoComplete="new-password"
              placeholder={`не меньше ${MIN_PASSWORD_LENGTH} символов`}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="repeat-password">Повторите новый пароль</label>
            <input
              id="repeat-password"
              type="password"
              value={repeat}
              autoComplete="new-password"
              onChange={(event) => setRepeat(event.target.value)}
            />
          </div>
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="key" size={16} />
            {busy ? 'Сохраняю…' : 'Сменить пароль'}
          </button>
        </form>
        {error ? <div className="error-text">{error}</div> : null}
        <div className="muted">
          После смены пароля все другие сессии этого пользователя закрываются: старый пароль
          перестаёт действовать сразу.
        </div>
      </section>
    </div>
  );
}
