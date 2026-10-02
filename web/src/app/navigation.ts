/**
 * Описание разделов системы.
 *
 * Раздел — это рабочий экран конкретной роли. Список один на всё приложение:
 * разметка строит меню из него, а маршрутизация — выбирает экран. Так адрес,
 * подпись и значок раздела не могут разойтись между меню и содержимым.
 *
 * Поле `permission` не скрывает раздел от остальных ролей — оно лишь отмечает,
 * какие разделы являются чужим рабочим местом. Просмотр данных разрешён всем
 * вошедшим: витрины собираются из одного состояния, и скрывать их смысла нет.
 */

import type { IconName } from '../ui/icons.js';

export interface NavItem {
  href: string;
  label: string;
  title: string;
  icon: IconName;
  /** Раздел показывается всем, но помечается как рабочий для роли. */
  permission?: string;
  /** Раздел доступен только при наличии права (администрирование). */
  onlyWithPermission?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Обзор',
    title: 'Обзор системы',
    icon: 'overview',
  },
  {
    href: '/deficit',
    label: 'Дефицит',
    title: 'Сводка дефицитов — рабочее место снабженца и экономиста',
    icon: 'warning',
    permission: 'ORDERED_QTY',
  },
  {
    href: '/supply',
    label: 'Снабжение',
    title: 'Обеспечение по материалам с перечнем проектов',
    icon: 'truck',
  },
  {
    href: '/picking',
    label: 'Отборка',
    title: 'Отборка — передача материала производству',
    icon: 'checklist',
    permission: 'PICKING_CHECKBOX',
  },
  {
    href: '/working-bom',
    label: 'WORKING BOM',
    title: 'WORKING BOM — рабочее место производства',
    icon: 'wrench',
    permission: 'WORKING_BOM_CHECKBOX',
  },
  {
    href: '/dashboard',
    label: 'Дашборд',
    title: 'Дашборд — состояние спецификаций',
    icon: 'chart',
  },
  {
    href: '/warehouse',
    label: 'Склад',
    title: 'Склад — остатки и резервы',
    icon: 'warehouse',
    permission: 'WAREHOUSE_QTY',
  },
  {
    href: '/boms',
    label: 'Спецификации',
    title: 'Спецификации: импорт и карточки',
    icon: 'file',
  },
  {
    href: '/archive',
    label: 'Архив',
    title: 'Архив передач: что и когда ушло в производство',
    icon: 'archive',
    permission: 'PICKING_CHECKBOX',
  },
  {
    href: '/admin',
    label: 'Админ',
    title: 'Пользователи, журнал и архив',
    icon: 'users',
    permission: 'USER_ADMIN',
    onlyWithPermission: true,
  },
  {
    href: '/account',
    label: 'Мой доступ',
    title: 'Мой доступ и смена пароля',
    icon: 'key',
  },
];

/** Разделы, которые видит конкретная роль. */
export function visibleItems(hasPermission: (permission: string) => boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (!item.onlyWithPermission) {
      return true;
    }
    return item.permission ? hasPermission(item.permission) : true;
  });
}
