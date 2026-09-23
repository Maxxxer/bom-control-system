/**
 * Простейший роутер приложения.
 *
 * Система состоит из нескольких экранов с адресами вида `/deficit`, `/picking`,
 * `/admin`. Полноценная библиотека маршрутизации здесь не нужна: важны всего две
 * вещи — адрес отражает текущий экран (ссылку можно отправить коллеге) и кнопка
 * «Назад» в браузере работает ожидаемо.
 *
 * Реализация опирается на историю браузера: переход — это `pushState`, а
 * изменение адреса (в том числе назад/вперёд) сообщается всем подписчикам через
 * одно событие.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

const NAVIGATE_EVENT = 'bom:navigate';

/** Сообщить о смене адреса внутри приложения. */
function broadcast(): void {
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Перейти на другой экран. Повторный переход на тот же адрес ничего не делает. */
export function navigate(path: string): void {
  const target = path.startsWith('/') ? path : `/${path}`;
  if (window.location.pathname === target) {
    return;
  }
  window.history.pushState({}, '', target);
  broadcast();
}

/** Текущий адрес (путь) без параметров запроса. */
export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const update = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);

  return pathname;
}

/** Ссылка внутри приложения: обычный `<a>` с перехватом щелчка. */
export function Link({
  href,
  children,
  className,
  style,
  title,
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  onClick?: () => void;
}) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Средняя кнопка и «открыть в новой вкладке» должны работать как обычно.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
        return;
      }
      event.preventDefault();
      onClick?.();
      navigate(href);
    },
    [href, onClick],
  );

  return (
    <a href={href} className={className} style={style} title={title} onClick={handleClick}>
      {children}
    </a>
  );
}

/** Признак активного раздела для подсветки в навигации. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
