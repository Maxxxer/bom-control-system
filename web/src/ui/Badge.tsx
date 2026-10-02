/**
 * Значок состояния.
 *
 * Тексты статусов приходят с сервера (они совпадают с формулировками прежней
 * системы), а цвет определяется здесь — по ключу статуса. Так одна и та же
 * строка «Ожидается поставка (Опаздывает)» выглядит одинаково на всех экранах.
 */

export type BadgeKind = 'ok' | 'wait' | 'late' | 'bad' | 'neutral' | 'stock';

/** Ключ статуса → вид значка. */
function kindFromKey(key: string): BadgeKind {
  switch (key) {
    case 'READY':
    case 'ON_TIME':
    case 'DELIVERED':
      return 'ok';
    case 'WAITING_ON_TIME':
    case 'PARTIALLY_ORDERED':
    case 'PARTIALLY_DELIVERED':
    case 'PARTIAL':
      return 'wait';
    case 'WAITING_LATE':
    case 'LATE':
      return 'late';
    case 'NOT_ORDERED':
    case 'ERROR':
      return 'bad';
    case 'ON_SHELF':
    case 'RESERVED':
      return 'stock';
    default:
      return 'neutral';
  }
}

export function Badge({ text, kind }: { text: string; kind: BadgeKind }) {
  return <span className={`badge ${kind}`}>{text}</span>;
}

/** Значок по ключу статуса и тексту, пришедшему с сервера. */
export function StatusBadge({ statusKey, text }: { statusKey: string; text: string }) {
  return <Badge text={text} kind={kindFromKey(statusKey)} />;
}

/** Значок для состояния производства. */
export function ProductionBadge({ state, text }: { state: string; text: string }) {
  const kind: BadgeKind =
    state === 'READY_FOR_HANDOFF' || state === 'RECEIVED'
      ? 'ok'
      : state === 'PARTIALLY_AVAILABLE'
        ? 'wait'
        : 'bad';
  return <Badge text={text} kind={kind} />;
}
