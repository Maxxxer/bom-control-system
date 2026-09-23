/**
 * Нормализация значений — перенос `utils.js` и части `v12_utils.js`.
 *
 * Здесь собрано всё, что отвечает за разбор «грязных» значений: числа с
 * разделителями тысяч, даты в любом виде (включая серийные номера электронных
 * таблиц), чекбоксы в виде boolean/строки, обрезка текста. Функции чистые и не
 * зависят от базы или HTTP.
 */

import { LIMITS } from './constants.js';

/** Сериальная дата: номер дня от 1899-12-30 (как в электронных таблицах). */
const SERIAL_DATE_EPOCH = { year: 1899, month: 11, day: 30 } as const;
/** Верхняя граница «похоже на серийный номер даты, а не на timestamp». */
const MAX_SERIAL_DATE = 2_958_466;

/**
 * Безопасное приведение к числу с корректной обработкой разделителей:
 * `«1,234.56» → 1234.56`, `«1.234,56» → 1234.56`, `«1,5» → 1.5`.
 */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  let text = String(value).replace(/\s|\u00a0/g, '');
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const commaCount = (text.match(/,/g) || []).length;
  const dotCount = (text.match(/\./g) || []).length;

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (commaCount > 1) {
    text = text.replace(/,/g, '');
  } else if (dotCount > 1) {
    text = text.replace(/\./g, '');
  } else if (commaCount === 1) {
    text = text.replace(',', '.');
  }

  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

/** Неотрицательное количество (количества материалов отрицательными не бывают). */
export function toQty(value: unknown): number {
  const parsed = toNumber(value);
  return parsed > 0 ? parsed : 0;
}

/** Обрезка строки для сравнения ключей: без крайних пробелов, в нижнем регистре. */
export function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Строковое поле из интерфейса: обрезка пробелов и ограничение длины. */
export function trimmed(value: unknown): string {
  const text = String(value ?? '').trim();
  return text.length > LIMITS.MAX_TEXT_LENGTH ? text.slice(0, LIMITS.MAX_TEXT_LENGTH) : text;
}

/**
 * Значение чекбокса → boolean. Поддерживает boolean, `«TRUE»/«1»/«да»`
 * (в любом регистре) и числа.
 */
export function isChecked(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (value === false || value === null || value === undefined || value === '') {
    return false;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'истина' || text === 'да';
}

/**
 * Любое значение → Date или null.
 *
 * Поддерживает Date, серийный номер даты, timestamp и строки `«dd.MM.yyyy»`,
 * `«yyyy-MM-dd»` и ISO. Дата собирается в ЛОКАЛЬНОМ времени: сроки в системе —
 * календарные даты без времени, поэтому сдвиг часового пояса недопустим.
 */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  let serial: number | null = null;
  if (typeof value === 'number') {
    serial = value;
  } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    serial = Number(value.trim());
  }

  if (serial !== null) {
    if (!Number.isFinite(serial) || serial === 0) {
      return null;
    }
    if (serial > 0 && serial < MAX_SERIAL_DATE) {
      const date = new Date(
        SERIAL_DATE_EPOCH.year,
        SERIAL_DATE_EPOCH.month,
        SERIAL_DATE_EPOCH.day + Math.floor(serial),
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const fromTimestamp = new Date(serial);
    return Number.isNaN(fromTimestamp.getTime()) ? null : fromTimestamp;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const dotFormat = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotFormat) {
    return new Date(Number(dotFormat[3]), Number(dotFormat[2]) - 1, Number(dotFormat[1]));
  }

  const isoDayFormat = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDayFormat) {
    return new Date(Number(isoDayFormat[1]), Number(isoDayFormat[2]) - 1, Number(isoDayFormat[3]));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Date → `YYYY-MM-DD` (локальный календарный день) либо null. */
export function isoFromDate(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Любое значение → `YYYY-MM-DD` либо null (единый вход для дат из интерфейса). */
export function toIsoDate(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.trim().split('-').map(Number);
    return isoFromDate(new Date(year, month - 1, day));
  }
  return isoFromDate(toDate(value));
}

/** Формат «только дата» для интерфейса: `dd.MM.yyyy`. */
export function formatDateOnly(value: unknown): string {
  const date = toDate(value);
  if (!date) {
    return value === null || value === undefined || value === '' ? '' : String(value);
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

/** Формат «дата и время»: `dd.MM.yyyy HH:mm`. */
export function formatDateTime(value: unknown): string {
  const date = toDate(value);
  if (!date) {
    return value === null || value === undefined || value === '' ? '' : String(value);
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day}.${month}.${date.getFullYear()} ${time}`;
}

/**
 * Сравнение календарных дат для сортировок. Пустая дата «больше» любой
 * заполненной (неизвестный срок уходит в конец списка).
 */
export function compareIsoDates(a: string | null, b: string | null): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Код проекта из имени BOM: часть до первого разделителя (пробела, дефиса или
 * подчёркивания). Пример: `«1234.АБВ-5678 Щит» → «1234.АБВ»`.
 */
export function extractProjectCode(bomName: unknown): string {
  return String(bomName ?? '').split(/[\s\-_]/)[0].trim();
}

/** Похоже ли значение на адрес электронной почты (для логина). */
export function isEmailLike(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}
