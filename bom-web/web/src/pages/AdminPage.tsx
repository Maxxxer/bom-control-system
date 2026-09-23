/**
 * Раздел администратора: пользователи, журнал действий и архив.
 *
 * Вкладки разделяют разные задачи: настройка доступов, разбор истории изменений и
 * просмотр переданных материалов. Раздел доступен только роли с правом
 * «управление пользователями и доступами»; если права нет, страница объясняет это
 * и не пытается загрузить данные (сервер всё равно ответит отказом).
 */

import { useState } from 'react';

import { useSession } from '../session/SessionContext.js';
import { ArchivePanel } from './ArchivePanel.js';
import { AuditPanel } from './AuditPanel.js';
import { UsersPanel } from './UsersPanel.js';

type Tab = 'users' | 'audit' | 'archive';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'users', label: 'Пользователи' },
  { key: 'audit', label: 'Журнал действий' },
  { key: 'archive', label: 'Архив передач' },
];

export function AdminPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('users');
  const allowed = can('USER_ADMIN');

  if (!allowed) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Администрирование</h1>
            <div className="hint">
              Раздел доступен администратору. Здесь настраиваются учётные записи и доступы,
              просматривается журнал изменений и архив переданных материалов.
            </div>
          </div>
        </div>
        <div className="empty-state">
          Недостаточно прав: управление пользователями доступно администратору
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Администрирование</h1>
          <div className="hint">
            Учётные записи и права, журнал изменений и архив переданных материалов. Все
            изменения в системе фиксируются с указанием автора.
          </div>
        </div>
      </div>

      <div className="row" role="tablist" aria-label="Разделы администрирования">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? 'btn primary' : 'btn'}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'users' ? <UsersPanel /> : null}
      {tab === 'audit' ? <AuditPanel /> : null}
      {tab === 'archive' ? <ArchivePanel /> : null}
    </div>
  );
}
