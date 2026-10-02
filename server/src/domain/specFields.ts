/**
 * Правка полей спецификации после импорта.
 *
 * Зачем это вообще нужно: спецификации ведут годами и загружают файлами, а
 * обязательные поля (модель, ед.изм, количество, крайний срок) в исходнике
 * иногда пусты. Импорт такие строки СОЗНАТЕЛЬНО не отбрасывает — иначе дефицит
 * по ним исчез бы из отчётов (см. `parseBomRows.ts`). Но исправить их было
 * нечем: позиция попадала в систему как «Ошибка данных» и оставалась такой до
 * следующей выгрузки файла.
 *
 * Здесь собраны ЧИСТЫЕ правила этой правки — какие поля можно менять, что
 * считать допустимым значением и какие поля влияют на ключ материала. Ни базы,
 * ни HTTP здесь нет: правила тестируются отдельно, а сервис только применяет их.
 *
 * Отдельно про ключ материала. `material_key` и `position_id` собираются из
 * артикула/производителя (а без артикула — из наименования, модели и ед.изм.,
 * см. `materialKeys.ts`). Значит, правка этих полей МЕНЯЕТ идентификатор
 * позиции, а вместе с ним отвязались бы склад, архив, журнал и история. Поэтому
 * принято решение: **правка не пересчитывает ключ** — описание материала
 * исправляется, а привязка к складу и истории остаётся прежней. Пользователю об
 * этом сообщают (`describeKeyNote`), чтобы он не ждал автоматической замены
 * материала на складе.
 */

import { buildMaterialKey, type MaterialParts } from './materialKeys.js';
import { toIsoDate, trimmed, toQty } from './values.js';

/**
 * Поля спецификации, доступные правке.
 *
 * Операционные поля (заказано, ожидаемая поставка, реальная поставка, передача)
 * здесь отсутствуют намеренно: у них свои операции и свои права ролей.
 */
export const EDITABLE_SPEC_FIELDS = [
  'rowNo',
  'code',
  'manufacturer',
  'name',
  'model',
  'unit',
  'requiredQty',
  'reservedQty',
  'deadline',
] as const;

export type SpecField = (typeof EDITABLE_SPEC_FIELDS)[number];

/** Подписи полей — те же, что видит пользователь в спецификации. */
export const SPEC_FIELD_LABEL: Record<SpecField, string> = {
  rowNo: '№ п/п',
  code: 'Артикул',
  manufacturer: 'Производитель',
  name: 'Наименование',
  model: 'Модель',
  unit: 'Ед.изм',
  requiredQty: 'Кол-во',
  reservedQty: 'Зарезервировано',
  deadline: 'Крайний срок поставки',
};

/** Поля, из которых собирается ключ материала. */
const KEY_FIELDS: readonly SpecField[] = ['code', 'manufacturer', 'name', 'model', 'unit'];

/** Является ли значение именем поля спецификации. */
export function isSpecField(value: unknown): value is SpecField {
  return typeof value === 'string' && (EDITABLE_SPEC_FIELDS as readonly string[]).includes(value);
}

/** Влияет ли правка поля на ключ материала (и, значит, на идентификатор позиции). */
export function specFieldAffectsMaterialKey(field: SpecField): boolean {
  return KEY_FIELDS.includes(field);
}

/** Результат проверки значения: либо приведённое значение, либо причина отказа. */
export type SpecFieldCheck =
  | { ok: true; value: string | number | null }
  | { ok: false; error: string };

/** Отказ с объяснением, что именно не так (пользователь видит этот текст). */
function reject(field: SpecField, hint: string): SpecFieldCheck {
  return { ok: false, error: `${SPEC_FIELD_LABEL[field]}: ${hint}` };
}

/**
 * Проверить и привести значение поля к тому виду, в котором оно хранится.
 *
 * Правила повторяют требования к спецификации (`validation.ts`), и это важно:
 * если разрешить сохранить пустую модель, «Ошибка данных» никуда не уйдёт, и
 * правка будет бесполезной. При этом проверяется ТОЛЬКО правимое поле — строка
 * может оставаться невалидной по другим полям, и её правят по шагам.
 */
export function normalizeSpecField(field: SpecField, value: unknown): SpecFieldCheck {
  switch (field) {
    case 'rowNo': {
      const rowNo = toQty(value);
      if (rowNo <= 0) {
        return reject(field, 'укажите положительный номер строки');
      }
      return { ok: true, value: rowNo };
    }
    case 'requiredQty': {
      const requiredQty = toQty(value);
      if (!(requiredQty > 0)) {
        return reject(field, 'количество должно быть больше 0');
      }
      return { ok: true, value: requiredQty };
    }
    case 'reservedQty': {
      // Резерв может быть нулевым — это нормальное состояние спецификации.
      return { ok: true, value: toQty(value) };
    }
    case 'deadline': {
      const deadline = toIsoDate(value);
      if (!deadline) {
        return reject(field, 'введите дату в формате ДД.ММ.ГГГГ, например 20.09.2026');
      }
      return { ok: true, value: deadline };
    }
    case 'name':
    case 'model':
    case 'unit': {
      const text = trimmed(value);
      if (!text) {
        return reject(field, 'поле обязательно — без него позиция остаётся «Ошибкой данных»');
      }
      return { ok: true, value: text };
    }
    case 'code':
    case 'manufacturer': {
      // Необязательные поля: пустое значение допустимо и означает «не указано».
      return { ok: true, value: trimmed(value) };
    }
  }
}

/** Описание материала позиции для построения ключа. */
export interface SpecIdentityLike extends MaterialParts {
  rowNo?: number;
  deadline?: string | null;
}

/** Собрать части материала из описательных полей (для проверки ключа). */
export function materialPartsOfSpec(identity: SpecIdentityLike): MaterialParts {
  return {
    code: identity.code,
    manufacturer: identity.manufacturer,
    name: identity.name,
    model: identity.model,
    unit: identity.unit,
  };
}

/**
 * Ключ, который получился бы, если бы ключ пересчитывали по новому описанию.
 *
 * Ключ НЕ применяется: он нужен только для предупреждения пользователю — «после
 * правки строка не совпадёт с исходным файлом». Так экономист видит последствие
 * сразу, а не узнаёт о нём при следующем импорте.
 */
export function wouldBeMaterialKey(identity: SpecIdentityLike): string {
  return buildMaterialKey(materialPartsOfSpec(identity));
}

/**
 * Текст предупреждения о судьбе ключа материала.
 *
 * Возвращает пустую строку, если сообщать нечего: правка не затронула ключ или
 * он и не должен был измениться.
 */
export function describeKeyNote(params: {
  field: SpecField;
  currentKey: string;
  nextIdentity: SpecIdentityLike;
}): string {
  if (!specFieldAffectsMaterialKey(params.field)) {
    return '';
  }
  const nextKey = wouldBeMaterialKey(params.nextIdentity);
  if (nextKey === params.currentKey) {
    return '';
  }
  return (
    `Поле «${SPEC_FIELD_LABEL[params.field]}» входит в ключ материала. ` +
    `Ключ оставлен прежним (${params.currentKey}), чтобы сохранить связь со складом, ` +
    `архивом и историей; при следующем импорте этого файла строка получит ключ ${nextKey}.`
  );
}
