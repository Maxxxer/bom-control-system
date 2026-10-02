/**
 * Русские подписи состояний позиции для карточки спецификации.
 *
 * Почему словарь здесь, а не на сервере: витрины присылают готовый текст
 * (`statusText`, `productionStateText`), и интерфейсу достаточно его показать.
 * Карточка BOM отдаёт позиции «как есть» — вместе с ключами состояний, — и без
 * этого словаря в русской таблице появлялись бы коды `ORDERED`,
 * `READY_FOR_HANDOFF`, `ACTIVE`.
 *
 * Значения совпадают с подписями сервера (`server/src/domain/constants.ts`:
 * `SUPPLY_STATE_LABEL`, `PRODUCTION_STATE_LABEL`, `LIFECYCLE_STATE_LABEL`) —
 * менять их нужно парой, как цвета строк в `tokens.css`.
 */

const SUPPLY_STATE_TEXT: Record<string, string> = {
  NO_REQUIREMENT: 'Потребности нет',
  RESERVED: 'Закрыто резервом',
  NOT_ORDERED: 'Не заказано',
  PARTIALLY_ORDERED: 'Заказано частично',
  ORDERED: 'Заказано',
  PARTIALLY_DELIVERED: 'Поставлено частично',
  DELIVERED: 'Поставлено',
};

const LIFECYCLE_TEXT: Record<string, string> = {
  ACTIVE: 'Активна',
  ARCHIVED: 'В производстве',
  REMOVED: 'Удалена',
};

/** Вид значка жизненного цикла: активная — нейтрально, остальные — со смыслом. */
const LIFECYCLE_KIND: Record<string, string> = {
  ACTIVE: 'neutral',
  ARCHIVED: 'ok',
  REMOVED: 'bad',
};

/** Текст состояния обеспечения; неизвестный ключ показывается как есть. */
export function supplyStateText(state: string): string {
  return SUPPLY_STATE_TEXT[state] ?? state;
}

/** Текст жизненного цикла позиции. */
export function lifecycleText(lifecycle: string): string {
  return LIFECYCLE_TEXT[lifecycle] ?? lifecycle;
}

/** Класс значка жизненного цикла. */
export function lifecycleKind(lifecycle: string): string {
  return LIFECYCLE_KIND[lifecycle] ?? 'neutral';
}
