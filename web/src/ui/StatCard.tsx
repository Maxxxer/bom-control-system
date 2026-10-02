/**
 * Карточка сводного показателя.
 *
 * Используется на главном экране и в шапках рабочих мест: крупное число плюс
 * пояснение. Вид карточки выбирается намеренно — «тревожная» подсвечивается,
 * чтобы проблема была видна до чтения подробностей.
 */

import type { ReactNode } from 'react';

export function StatCard({
  title,
  value,
  note,
  kind = 'plain',
}: {
  title: string;
  value: ReactNode;
  note?: ReactNode;
  kind?: 'plain' | 'accent' | 'alert';
}) {
  const className = kind === 'plain' ? 'card' : `card ${kind}`;
  return (
    <div className={className}>
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      {note ? <div className="card-note">{note}</div> : null}
    </div>
  );
}
