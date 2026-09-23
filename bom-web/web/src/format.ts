/**
 * Форматирование значений для показа.
 *
 * Сервер отдаёт даты строками `ГГГГ-ММ-ДД`, а люди в системе работают с форматом
 * `ДД.ММ.ГГГГ` (как в прежней системе и в исходных спецификациях). Преобразование
 * делается строками, а не через `Date`, чтобы дата не «съезжала» на сутки из-за
 * часового пояса.
 */

/** Количество без лишних нулей: 10 → «10», 2.5 → «2,5». */
export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded).replace('.', ',');
}

/** Дата `ГГГГ-ММ-ДД` → `ДД.ММ.ГГГГ`. Пустое значение → «—». */
export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const iso = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return String(value);
  }
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

/**
 * Дата `ДД.ММ.ГГГГ` (или `ГГГГ-ММ-ДД`) → `ГГГГ-ММ-ДД` для отправки на сервер.
 * Возвращает `null`, если разобрать не удалось.
 */
export function parseDateInput(value: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.slice(0, 10));
  if (isoMatch) {
    return isoMatch[0];
  }
  const ruMatch = /^(\d{1,2})[.,/](\d{1,2})[.,/](\d{4})$/.exec(text);
  if (ruMatch) {
    const [, day, month, year] = ruMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

/** Дата и время для журнала: `ДД.ММ.ГГГГ ЧЧ:ММ`. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (num: number): string => String(num).padStart(2, '0');
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Только дата из отметки времени (для колонок с датой передачи). */
export function formatDay(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (num: number): string => String(num).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Многострочный текст (подсказка «недостающие материалы») → читаемые линии. */
export function formatLines(value: string | null | undefined, emptyText = '—'): string[] {
  const text = String(value ?? '').trim();
  if (!text) {
    return [emptyText];
  }
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Единица измерения в скобках: «шт» → «шт». */
export function formatUnit(unit: string): string {
  return String(unit ?? '').trim();
}
