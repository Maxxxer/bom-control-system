/**
 * Окно «Все материалы доступны?» — развилка после импорта спецификации.
 *
 * Смысл вопроса: всё ли в файле готово к работе, или экономисту нужно сначала
 * дописать недостающие позиции. От ответа зависит только то, нужно ли открывать
 * правку, — в обоих случаях спецификация дальше идёт по обычному процессу
 * (дефицит → заказ → склад → отборка → передача производству).
 *
 * Важно: отметка «Выполнено» здесь НЕ ставится. Она означает, что материалы уже
 * переданы производству, и ставится на дашборде производством в самом конце.
 * Поставить её на этом шаге значило бы убрать свежую спецификацию из рабочего
 * списка, и её материалы никто бы не заказал.
 */

import { useEffect } from 'react';

interface AllMaterialsDialogProps {
  /** Код спецификации. */
  bomCode: string;
  /** Позиций всего в спецификации. */
  total: number;
  /** Позиций с незаполненными обязательными полями. */
  broken: number;
  /** Сколько позиций получили резерв из потребности. */
  reserved: number;
  busy?: boolean;
  /** Все материалы в наличии — спецификация уходит в процесс. */
  onYes: () => void;
  /** Нужно дописать позиции — открыть правку спецификации. */
  onFix: () => void;
}

export function AllMaterialsDialog({
  bomCode,
  total,
  broken,
  reserved,
  busy = false,
  onYes,
  onFix,
}: AllMaterialsDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onFix();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFix]);

  const ready = broken === 0;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Все материалы доступны?"
    >
      <div className="modal">
        <h3>Все материалы доступны?</h3>
        <p className="muted">
          Спецификация «{bomCode}»: позиций {total}
          {reserved > 0 ? `, резерв проставлен из потребности: ${reserved}` : ''}.
          {ready
            ? ' Все позиции заполнены полностью — можно отправлять спецификацию в работу.'
            : ` Не заполнены обязательные поля в ${broken} позициях — их нельзя передать производству.`}
        </p>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onFix} disabled={busy}>
            Ввести отсутствующие позиции
          </button>
          <button type="button" className="btn primary" onClick={onYes} disabled={busy}>
            Да
          </button>
        </div>
      </div>
    </div>
  );
}