/**
 * Валидация позиции спецификации — перенос `v12ValidatePosition` (`v12_utils.js`).
 *
 * Обязательны: номер строки, наименование, модель, единица измерения,
 * количество > 0 и крайний срок поставки. Артикул НЕ обязателен — так
 * зафиксировано в исходных требованиях, и это важно: спецификации без артикула
 * должны работать и передаваться производству.
 *
 * Позиция с ошибкой данных не может быть передана производству.
 */

import { toNumber } from './values.js';
import type { PositionIdentity, ValidationResult } from './types.js';

/** Проверить обязательные поля позиции. */
export function validatePosition(
  identity: Partial<PositionIdentity>,
  requiredQty: unknown,
): ValidationResult {
  const deadline = identity.deadline;
  const missing = {
    rowNo: !(toNumber(identity.rowNo) > 0),
    name: !String(identity.name ?? '').trim(),
    model: !String(identity.model ?? '').trim(),
    unit: !String(identity.unit ?? '').trim(),
    requiredQty: !(toNumber(requiredQty) > 0),
    deadline: !(typeof deadline === 'string' && deadline.trim() !== ''),
  };

  return {
    valid: !(
      missing.rowNo ||
      missing.name ||
      missing.model ||
      missing.unit ||
      missing.requiredQty ||
      missing.deadline
    ),
    missing,
  };
}

/** Человекочитаемый список незаполненных обязательных полей. */
export function describeMissingFields(missing: ValidationResult['missing']): string[] {
  const labels: Array<[keyof ValidationResult['missing'], string]> = [
    ['rowNo', '№ п/п'],
    ['name', 'Наименование'],
    ['model', 'Модель'],
    ['unit', 'Ед.изм'],
    ['requiredQty', 'Кол-во (> 0)'],
    ['deadline', 'Крайний срок поставки'],
  ];
  return labels.filter(([key]) => missing[key]).map(([, label]) => label);
}
