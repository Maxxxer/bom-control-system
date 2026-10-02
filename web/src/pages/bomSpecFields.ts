/**
 * Подписи и тексты, которыми карточка спецификации объясняет «Ошибку данных».
 *
 * Вынесено из самой карточки, потому что это словарь предметной области, а не
 * разметка: те же названия полей нужны и в сообщении «не заполнено», и в
 * подсказке у строки. Держать их рядом с таблицей — значит дублировать строки в
 * двух местах и однажды разойтись с сервером (`domain/specFields.ts`).
 */

import type { PositionDto, PositionMissingFields } from '../api/types.js';

/**
 * Поля спецификации, которые можно править прямо в карточке.
 *
 * Ключ — имя поля в API (`POST /api/positions/:id/spec`), значение — подпись в
 * интерфейсе. Операционных полей здесь нет: «Заказано» и поставку правят на
 * своих рабочих местах, у них другие права.
 */
export const SPEC_FIELD_LABEL = {
  rowNo: '№ п/п',
  name: 'Наименование',
  model: 'Модель',
  code: 'Артикул',
  manufacturer: 'Производитель',
  unit: 'Ед.изм',
  requiredQty: 'Кол-во',
  reservedQty: 'Зарезервировано',
  deadline: 'Крайний срок',
} as const;

export type SpecFieldName = keyof typeof SPEC_FIELD_LABEL;

/** Обязательные поля и их подписи — в том же порядке, что в спецификации. */
const MISSING_FIELD_LABEL: Array<[keyof PositionMissingFields, string]> = [
  ['rowNo', '№ п/п'],
  ['name', 'Наименование'],
  ['model', 'Модель'],
  ['unit', 'Ед.изм'],
  ['requiredQty', 'Кол-во'],
  ['deadline', 'Крайний срок'],
];

/** Позиция требует правки: сервер уже сказал, что именно не заполнено. */
export function requiresFix(row: PositionDto): boolean {
  return !row.computed.valid;
}

/** Короткий перечень незаполненных полей: «Модель, Ед.изм». */
export function missingSummary(row: PositionDto): string {
  return MISSING_FIELD_LABEL.filter(([key]) => row.computed.missing[key])
    .map(([, label]) => label)
    .join(', ');
}

/** Полный текст для подсказки: понятно, что именно нужно заполнить. */
export function missingHint(row: PositionDto): string {
  const summary = missingSummary(row);
  return summary
    ? `Не заполнено: ${summary}. Исправьте поле прямо в строке — после этого позиция сможет уйти производству.`
    : 'Позиция заполнена';
}

/** Подсказка по материалу: полный состав строки, если колонки обрезаны. */
export function materialHint(row: PositionDto): string {
  const parts = [row.identity.name, row.identity.model];
  if (row.identity.code) {
    parts.push(`артикул: ${row.identity.code}`);
  }
  if (row.identity.manufacturer) {
    parts.push(`производитель: ${row.identity.manufacturer}`);
  }
  return parts.filter(Boolean).join(' · ');
}

/**
 * Поля, из которых собирается ключ материала.
 *
 * Ключ — то, по чему система узнаёт «тот же материал»: к нему привязаны складской
 * остаток, снабжение и отборка. Правка этих полей НЕ пересчитывает ключ сама, и об
 * этом нужно сказать пользователю: иначе он будет ждать, что исправленный артикул
 * сразу «переедет» вместе со складским остатком.
 *
 * Список повторяет правило сервера (`domain/specFields.ts`): если артикула нет,
 * ключ собирается из наименования, модели, производителя и единицы измерения.
 */
export const MATERIAL_KEY_FIELDS: readonly SpecFieldName[] = [
  'code',
  'name',
  'model',
  'manufacturer',
  'unit',
];

/** Правка затронула поля, из которых собирается ключ материала. */
export function touchesMaterialKey(fields: readonly string[]): boolean {
  return fields.some((field) => MATERIAL_KEY_FIELDS.includes(field as SpecFieldName));
}
