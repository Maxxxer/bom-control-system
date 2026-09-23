/**
 * Разметка приложения: шапка с логотипом MAIR, строка разделов, содержимое, подвал.
 *
 * Шапка несёт две важные функции: показывает, под какой ролью работает человек
 * (это частая причина «не вижу нужной кнопки»), и даёт выход из системы. Меню
 * строится из общего списка разделов, поэтому его невозможно «забыть» дополнить
 * при добавлении экрана.
 *
 * Оформление повторяет брендбук: тёмно-синяя полоса с белым знаком MAIR, ниже —
 * светлая строка разделов с оранжевым подчёркиванием активного пункта.
 */

import type { ReactNode } from 'react';

import { visibleItems } from '../app/navigation.js';
import { isActive, Link } from '../app/router.js';
import { useSession } from '../session/SessionContext.js';
import { BrandMark } from './BrandMark.js';
import { densityLabel, useDensity } from './density.js';
import { Icon } from './icons.js';

/** Логотип MAIR с названием системы — общий для шапки и экрана входа. */
export function BrandLockup({ withSubtitle = true }: { withSubtitle?: boolean }) {
  return (
    <Link href="/" className="brand" title="MAIR — управление обеспечением сборки">
      <BrandMark className="brand-mark" />
      <span className="brand-divider" aria-hidden="true" />
      <span className="brand-name">
        <span className="brand-title">BOM CONTROL SYSTEM</span>
        {withSubtitle ? (
          <span className="brand-sub">управление обеспечением сборки</span>
        ) : null}
      </span>
    </Link>
  );
}

export function Layout({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { user, can, signOut } = useSession();
  const items = visibleItems(can);
  const [density, setDensity] = useDensity();
  // Кнопка показывает, каким режим станет, а не каким он был: «Свободно» —
  // значит, нажатие сделает строки выше.
  const nextDensity = density === 'compact' ? 'roomy' : 'compact';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <BrandLockup />

          <div className="app-user">
            <button
              type="button"
              className="btn small"
              title="Плотность строк таблиц. «Плотно» — на экран помещается больше строк, «Свободно» — крупнее шрифт и выше строка. Выбор сохраняется в браузере."
              onClick={() => setDensity(nextDensity)}
            >
              <Icon name={nextDensity === 'roomy' ? 'roomy' : 'dense'} size={14} />
              {densityLabel(nextDensity)}
            </button>
            <span title="Текущая роль и пользователь">
              {user ? `${user.fullName} — ${user.roleLabel}` : ''}
            </span>
            <button type="button" className="btn small" onClick={() => void signOut()}>
              <Icon name="close" size={14} />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <nav className="app-nav" aria-label="Разделы">
        <div className="app-nav-inner">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(pathname, item.href) ? 'active' : undefined}
              title={item.title}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="app-main">{children}</main>

      <footer className="app-footer">
        BOM CONTROL SYSTEM — управление обеспечением сборки. Данные хранятся в базе
        предприятия; все изменения фиксируются в журнале с указанием автора.
      </footer>
    </div>
  );
}
