/**
 * Набор пиктограмм для интерфейса.
 *
 * Только векторные значки, без эмодзи: эмодзи выглядят по-разному в разных
 * системах и не подчиняются цвету текста, а контурные значки одинаковы везде и
 * наследуют цвет (например, белый в тёмной шапке). Все контуры нарисованы в
 * координатах 24×24 и масштабируются размером.
 */

export type IconName =
  | 'overview'
  | 'warning'
  | 'truck'
  | 'checklist'
  | 'wrench'
  | 'chart'
  | 'warehouse'
  | 'archive'
  | 'file'
  | 'users'
  | 'key'
  | 'refresh'
  | 'dense'
  | 'roomy'
  | 'check'
  | 'close'
  | 'arrowRight';

const PATHS: Record<IconName, string> = {
  overview: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  warning: 'M12 3l9 18H3zM12 9v5M12 17v1',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7zM6 20v-2M17 20v-2',
  checklist: 'M4 5h3l1 2h2M4 12h3l1 2h2M4 19h3l1 2h2M13 6h8M13 13h8M13 20h8',
  wrench: 'M14 3l-4 8 3 3 8-4-3-3zM10 11l-6 6 3 3 6-6',
  chart: 'M4 20V4M4 20h16M8 20v-6M12 20v-9M16 20v-4M20 20v-12',
  warehouse: 'M3 21V8l9-5 9 5v13M7 21v-7h10v7M7 17h10',
  archive: 'M3 7h18v4H3zM5 11v10h14V11M9 15h6',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  users: 'M8 11a4 4 0 100-8 4 4 0 000 8zM16 11a3 3 0 100-6 3 3 0 000 6zM2 21c0-3 3-5 6-5s6 2 6 5M16 16c3 0 6 2 6 5',
  key: 'M15 3a6 6 0 014 10l-9 9-4-4 9-9a6 6 0 010-6zM8 16l2 2',
  refresh: 'M20 12a8 8 0 11-3-6M20 4v5h-5',
  // Плотность строк: четыре линии — «плотно», две — «свободно»
  dense: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  roomy: 'M4 8h16M4 16h16',
  check: 'M4 13l5 5L20 6',
  close: 'M6 6l12 12M18 6L6 18',
  arrowRight: 'M5 12h14M13 5l7 7-7 7',
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
