/**
 * Пользователи: создание, роли, доступ, пароль.
 *
 * Два правила, которые видит администратор прямо в форме: нельзя отключить себя и
 * нельзя лишить прав последнего действующего администратора. Сервер эти правила
 * проверяет, а интерфейс подсказывает заранее — так администратор не доводит
 * систему до состояния «войти некому».
 *
 * Смена роли, доступа или пароля немедленно закрывает сессии пользователя: права
 * должны меняться сразу, а не после того, как истекут старые cookie.
 */

import { useState } from 'react';

import * as api from '../api/endpoints.js';
import type { UserView } from '../api/adminTypes.js';
import { useAction } from '../app/useAction.js';
import { useLoader } from '../app/useLoader.js';
import { formatDateTime } from '../format.js';
import { useSession } from '../session/SessionContext.js';
import { Column, DataTable } from '../ui/DataTable.js';
import { useToast } from '../ui/ToastProvider.js';
import { Icon } from '../ui/icons.js';

const ROLES: Array<{ value: string; label: string }> = [
  { value: 'admin', label: 'Администратор' },
  { value: 'economist', label: 'Экономист' },
  { value: 'procurement', label: 'Снабженец' },
  { value: 'warehouse', label: 'Кладовщик' },
  { value: 'production', label: 'Производство' },
  { value: 'viewer', label: 'Наблюдатель' },
];

export function UsersPanel() {
  const { user: me } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const { data, loading, error, reload } = useLoader('admin-users', api.fetchUsers);

  const [login, setLogin] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('viewer');
  const [password, setPassword] = useState('');

  const create = async (): Promise<void> => {
    const result = await run(() =>
      api.createUser({ login: login.trim(), fullName: fullName.trim(), role, password }),
    );
    if (!result) {
      return;
    }
    toast.success(`Создан пользователь «${result.user.login}»`);
    setLogin('');
    setFullName('');
    setPassword('');
    setRole('viewer');
    reload();
  };

  const changeRole = async (target: UserView, nextRole: string): Promise<void> => {
    const result = await run(() => api.updateUser(target.id, { role: nextRole }));
    if (!result) {
      return;
    }
    toast.success(`Роль «${target.login}» изменена на «${result.user.roleLabel}»`);
    reload();
  };

  const toggleActive = async (target: UserView): Promise<void> => {
    const result = await run(() => api.updateUser(target.id, { isActive: !target.isActive }));
    if (!result) {
      return;
    }
    toast.success(
      result.user.isActive
        ? `Доступ для «${target.login}» включён`
        : `Доступ для «${target.login}» отключён`,
    );
    reload();
  };

  const resetPassword = async (target: UserView): Promise<void> => {
    const next = window.prompt(
      `Новый пароль для «${target.login}» (не меньше 8 символов):`,
      '',
    );
    if (next === null) {
      return;
    }
    const result = await run(() => api.updateUser(target.id, { password: next }));
    if (!result) {
      return;
    }
    toast.success(`Пароль «${target.login}» изменён; его сессии закрыты`);
  };

  const columns: Array<Column<UserView>> = [
    {
      key: 'login',
      title: 'Логин',
      sortValue: (row) => row.login,
      render: (row) => <span className="mono">{row.login}</span>,
    },
    {
      key: 'fullName',
      title: 'ФИО',
      sortValue: (row) => row.fullName,
      render: (row) => row.fullName || <span className="muted">—</span>,
    },
    {
      key: 'role',
      title: 'Роль',
      sortValue: (row) => row.role,
      render: (row) => (
        <select
          value={row.role}
          disabled={busy}
          onChange={(event) => void changeRole(row, event.target.value)}
        >
          {ROLES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'active',
      title: 'Доступ',
      sortValue: (row) => (row.isActive ? 1 : 0),
      render: (row) =>
        row.isActive ? (
          <span className="badge ok">Включён</span>
        ) : (
          <span className="badge bad">Отключён</span>
        ),
    },
    {
      key: 'permissions',
      title: 'Права',
      render: (row) => (
        <div className="muted permissions-cell">
          {row.permissions.length ? row.permissions.join(', ') : 'только просмотр'}
        </div>
      ),
    },
    {
      key: 'createdAt',
      title: 'Создан',
      sortValue: (row) => row.createdAt,
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'actions',
      title: 'Действия',
      render: (row) => (
        <div className="row tight">
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => void toggleActive(row)}
            title={
              row.id === me?.id
                ? 'Нельзя отключить собственную учётную запись'
                : 'Включить или отключить доступ'
            }
          >
            {row.isActive ? 'Отключить' : 'Включить'}
          </button>
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => void resetPassword(row)}
          >
            <Icon name="key" size={14} />
            Пароль
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="stack">
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label htmlFor="new-login">Логин</label>
          <input
            id="new-login"
            type="text"
            value={login}
            placeholder="ivanov"
            onChange={(event) => setLogin(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-name">ФИО</label>
          <input
            id="new-name"
            type="text"
            value={fullName}
            placeholder="Иванов Иван"
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-role">Роль</label>
          <select id="new-role" value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-password">Пароль</label>
          <input
            id="new-password"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="не меньше 8 символов"
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn primary"
          disabled={busy || !login.trim() || !fullName.trim() || password.length < 8}
        >
          <Icon name="users" size={16} />
          Создать
        </button>
      </form>

      <div className="muted">
        Смена роли, доступа или пароля немедленно закрывает сессии этого пользователя —
        новые права начинают действовать сразу.
      </div>

      {error ? (
        <div className="error-text">
          {error}{' '}
          <button type="button" className="btn small" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {loading && !data ? <div className="empty-state">Загружаю пользователей…</div> : null}

      {data ? (
        <DataTable
          columns={columns}
          rows={data.users}
          rowKey={(row) => String(row.id)}
          emptyText="Пользователей нет"
        />
      ) : null}
    </div>
  );
}
