/**
 * Массовая правка полей: какие поля можно менять, каким правом это разрешено и
 * как привести присланное значение к хранимому виду.
 *
 * Зачем отдельный модуль. Одиночная правка живёт в `services/positionService.ts`
 * и опирается на `requirePermission` (бросок исключения → HTTP 403) — для одной
 * ячейки это верно. Массовая правка (вставка блока из Excel) обязана уметь
 * ЧАСТИЧНЫЙ УСПЕХ: одна запрещённая или неразбираемая ячейка не должна отменять
 * остальные. Поэтому права и проверка значений описаны здесь ЧИСТЫМИ функциями,
 * а сервис лишь применяет их результат построчно.
 *
 * Ни базы, ни HTTP здесь нет — правила тестируются отдельно (как `specFields.ts`).
 */

import type { PermissionAction } from './constants.js';
import {
  EDITABLE_SPEC_FIELDS,
  normalizeSpecField,
  SPEC_FIELD_LABEL,
  type SpecField,
  type SpecFieldCheck,
} from './specFields.js';
import { isChecked, toIsoDate, toQty } from './values.js';

/**
 * Операционные поля: их ведут роли на рабочих экранах, у каждого своё право.
 *
 * Обратите внимание: отметка «Поставлено» передаётся как `realDeliveryChecked`
 * (галочка) и как `realDeliveryQty` (количество). В системе это ОДНА операция
 * (`setRealDeliveryQty`): галочка лишь подставляет полный объём потребности.
 */
export const BULK_OPERATING_FIELDS = [
  'orderedQty',
  'expectedDate',
  'realDeliveryQty',
  'realDeliveryChecked',
] as const;

export type BulkOperatingField = (typeof BULK_OPERATING_FIELDS)[number];

/**
 * Все поля массовой правки: операционные и поля спецификации.
 *
 * Имена полей спецификации совпадают с `SpecField` (`rowNo`, `name`, `model`,
 * `requiredQty`, `deadline` и т. д.) — интерфейс передаёт их как есть, поэтому
 * одна таблица «поле → право → проверка» обслуживает и одиночную, и массовую
 * правку, и откат операции.
 */
export const BULK_FIELDS = [...BULK_OPERATING_FIELDS, ...EDITABLE_SPEC_FIELDS] as const;

export type BulkField = BulkOperatingField | SpecField;

/** Подписи полей — те же, что видит пользователь. Используются в причинах отказа. */
export const BULK_FIELD_LABEL: Record<BulkField, string> = {
  orderedQty: 'Заказано',
  expectedDate: 'Ожидаемая поставка',
  realDeliveryQty: 'Поставлено',
  realDeliveryChecked: 'Отметка «Поставлено»',
  ...SPEC_FIELD_LABEL,
};

/** Является ли значение именем поля массовой правки. */
export function isBulkField(value: unknown): value is BulkField {
  return typeof value === 'string' && (BULK_FIELDS as readonly string[]).includes(value);
}

/** Относится ли поле к операционным (всё остальное — поля спецификации). */
export function isOperatingBulkField(field: BulkField): field is BulkOperatingField {
  return (BULK_OPERATING_FIELDS as readonly string[]).includes(field);
}

const OPERATING_FIELD_PERMISSION: Record<BulkOperatingField, PermissionAction> = {
  orderedQty: 'ORDERED_QTY',
  expectedDate: 'EXPECTED_DATE',
  realDeliveryQty: 'REAL_DELIVERY',
  realDeliveryChecked: 'REAL_DELIVERY',
};

/**
 * Какое право нужно, чтобы записать это поле.
 *
 * Крайний срок выделен отдельно: он влияет на оценку «в срок / опаздывает» по
 * всем ролям, поэтому у него собственное право (`DEADLINE`), а не общее право
 * правки спецификации.
 */
export function bulkPermission(field: BulkField): PermissionAction {
  if (isOperatingBulkField(field)) {
    return OPERATING_FIELD_PERMISSION[field];
  }
  return field === 'deadline' ? 'DEADLINE' : 'SOURCE_BOM_WRITE';
}

/** Значение, которое можно записать в позицию. */
export type BulkValue = string | number | boolean | null;

/** Результат проверки значения: либо приведённое значение, либо причина отказа. */
export type BulkValueCheck = { ok: true; value: BulkValue } | { ok: false; error: string };

/**
 * Допустимые символы количества: цифры, разделитель разрядов (пробел) и
 * разделитель дробной части (`.` или `,`).
 *
 * Почему не «строгое» регулярное выражение вроде `^\d+(\.\d+)?$`: разделителей
 * разрядов в русской раскладке несколько (`1 234,56`, `1.234,56`, `1,234.56`), и
 * серверная нормализация `toNumber` их уже понимает — она же обслуживает импорт
 * спецификаций. Здесь важно отсечь не число, а мусор (`abc`, `-5`, `10шт`),
 * который при одиночном вводе отвергает `EditableNumber`.
 */
const QTY_CHARS = /^[\d\s\u00a0.,]+$/;

/**
 * Разобрать количество. Пусто — это ноль (как в одиночном поле), мусор — отказ.
 *
 * Отличие от `toQty`: там мусор молча становится нулём. При вставке блока это
 * недопустимо — снабженец не должен узнать об опечатке только по нулю в отчёте.
 */
function parseQty(value: unknown): BulkValueCheck {
  const text = String(value ?? '').trim();
  if (!text) {
    return { ok: true, value: 0 };
  }
  if (!QTY_CHARS.test(text) || !/\d/.test(text)) {
    return { ok: false, error: 'Введите неотрицательное число, например 10 или 2,5' };
  }
  return { ok: true, value: toQty(value) };
}

/**
 * Разобрать количество, введённое массово.
 *
 * Экспортируется для склада: у него своя таблица и своя операция (остаток по
 * материалу, а не по позиции), но правило разбора количества обязано быть ТЕМ ЖЕ —
 * иначе один и тот же текст, вставленный на разных экранах, давал бы разный
 * результат.
 */
export function parseBulkQuantity(value: unknown): BulkValueCheck {
  return parseQty(value);
}

/** Проверка поля спецификации: правила берём из `specFields.ts`, не дублируем. */
function normalizeSpecValue(field: SpecField, value: unknown): BulkValueCheck {
  const checked: SpecFieldCheck = normalizeSpecField(field, value);
  return checked.ok ? { ok: true, value: checked.value } : { ok: false, error: checked.error };
}

/** Поля спецификации, значения которых — количества (проверяются строже). */
const SPEC_QTY_FIELDS: readonly SpecField[] = ['rowNo', 'requiredQty', 'reservedQty'];

/**
 * Проверить и привести значение массовой правки к тому виду, в котором оно
 * хранится. Текст условия отказа — тот же, что видит пользователь при одиночном
 * вводе: правила не должны расходиться между способами правки.
 */
export function normalizeBulkValue(field: BulkField, value: unknown): BulkValueCheck {
  switch (field) {
    case 'orderedQty':
    case 'realDeliveryQty':
      return parseQty(value);
    case 'realDeliveryChecked':
      // Значение галочки: снимается — 0, ставится — полный объём потребности.
      // Сам объём известен только позиции, поэтому здесь возвращается флаг.
      return { ok: true, value: isChecked(value) };
    case 'expectedDate': {
      if (!String(value ?? '').trim()) {
        return { ok: true, value: null };
      }
      const iso = toIsoDate(value);
      if (!iso) {
        return {
          ok: false,
          error: `${BULK_FIELD_LABEL.expectedDate}: введите дату в виде ДД.ММ.ГГГГ, например 20.09.2026`,
        };
      }
      return { ok: true, value: iso };
    }
    default: {
      if (SPEC_QTY_FIELDS.includes(field)) {
        const qty = parseQty(value);
        return qty.ok ? normalizeSpecValue(field, qty.value) : qty;
      }
      return normalizeSpecValue(field, value);
    }
  }
}

/** Префикс поля спецификации в журнале действий (`SPEC.MODEL`). */
const SPEC_AUDIT_PREFIX = 'SPEC.';

/** Поля журнала, у которых правило возврата совпадает с полем правки. */
const AUDIT_OPERATING_FIELD: Record<string, BulkField> = {
  ORDERED_QTY: 'orderedQty',
  EXPECTED_DATE: 'expectedDate',
  REAL_DELIVERY_QTY: 'realDeliveryQty',
  DEADLINE: 'deadline',
};

/**
 * Имя поля в журнале действий → поле массовой правки.
 *
 * Нужно для отката операции: журнал хранит имена так, как их писала операция
 * (`ORDERED_QTY`, `SPEC.MODEL`), а вернуть значение можно только через операцию
 * правки. Возвращает `null`, если правила возврата нет — передача производству,
 * складской остаток, отметка «Выполнено»: их откат потребовал бы другой логики
 * (склад, архив), и делать вид, что он есть, нельзя.
 */
export function auditFieldToBulkField(field: unknown): BulkField | null {
  const text = String(field ?? '').trim();
  if (!text) {
    return null;
  }
  const operating = AUDIT_OPERATING_FIELD[text];
  if (operating) {
    return operating;
  }
  if (!text.startsWith(SPEC_AUDIT_PREFIX)) {
    return null;
  }
  const tail = text.slice(SPEC_AUDIT_PREFIX.length).toLowerCase();
  return EDITABLE_SPEC_FIELDS.find((name) => name.toLowerCase() === tail) ?? null;
}
