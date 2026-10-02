/**
 * Проверки правки полей спецификации.
 *
 * Это правила, которыми чинят «Ошибку данных» после импорта: если проверка
 * пропустит пустое обязательное поле, экономист будет уверен, что исправил
 * строку, а позиция останется невалидной и не сможет уйти производству. Если же
 * проверка окажется слишком строгой, исправить спецификацию будет нельзя вовсе —
 * и мы вернёмся к тому, с чего начали.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeKeyNote,
  EDITABLE_SPEC_FIELDS,
  isSpecField,
  normalizeSpecField,
  specFieldAffectsMaterialKey,
  wouldBeMaterialKey,
} from '../src/domain/specFields.js';

/** Разобрать значение или упасть с понятным сообщением. */
function valueOf(field: Parameters<typeof normalizeSpecField>[0], value: unknown): unknown {
  const checked = normalizeSpecField(field, value);
  assert.equal(checked.ok, true, `значение «${String(value)}» должно приниматься`);
  return checked.ok ? checked.value : null;
}

/** Проверить, что значение отклонено, и вернуть текст причины. */
function errorOf(field: Parameters<typeof normalizeSpecField>[0], value: unknown): string {
  const checked = normalizeSpecField(field, value);
  assert.equal(checked.ok, false, `значение «${String(value)}» должно быть отклонено`);
  return checked.ok ? '' : checked.error;
}

test('правке доступны только поля спецификации, но не операционные данные', () => {
  assert.deepEqual(
    [...EDITABLE_SPEC_FIELDS].sort(),
    [
      'code',
      'deadline',
      'manufacturer',
      'model',
      'name',
      'requiredQty',
      'reservedQty',
      'rowNo',
      'unit',
    ],
  );
  // Операционные поля правятся своими операциями: у них другие права и другие
  // последствия (склад, передача производству).
  assert.equal(isSpecField('orderedQty'), false);
  assert.equal(isSpecField('expectedDate'), false);
  assert.equal(isSpecField('received'), false);
  assert.equal(isSpecField('name'), true);
  assert.equal(isSpecField(undefined), false);
});

test('номер строки принимается только положительным', () => {
  assert.equal(valueOf('rowNo', '12'), 12);
  assert.equal(valueOf('rowNo', 12), 12);
  assert.match(errorOf('rowNo', '0'), /положительный номер строки/);
  assert.match(errorOf('rowNo', ''), /положительный номер строки/);
  assert.match(errorOf('rowNo', 'нет'), /положительный номер строки/);
});

test('количество нужно больше нуля, а резерв может быть нулевым', () => {
  assert.equal(valueOf('requiredQty', '2,5'), 2.5);
  assert.equal(valueOf('requiredQty', ' 10 '), 10);
  assert.match(errorOf('requiredQty', ''), /больше 0/);
  assert.match(errorOf('requiredQty', '-5'), /больше 0/);

  // Пустой резерв — нормальное состояние: у материала просто нет запаса.
  assert.equal(valueOf('reservedQty', ''), 0);
  assert.equal(valueOf('reservedQty', '3'), 3);
});

test('крайний срок принимается как «ДД.ММ.ГГГГ» и как ISO', () => {
  assert.equal(valueOf('deadline', '20.09.2026'), '2026-09-20');
  assert.equal(valueOf('deadline', '2026-09-20'), '2026-09-20');
  assert.match(errorOf('deadline', ''), /введите дату/);
  assert.match(errorOf('deadline', 'сентябрь'), /введите дату/);
});

test('обязательные текстовые поля не принимают пустое значение', () => {
  assert.equal(valueOf('name', '  Резистор  '), 'Резистор');
  assert.equal(valueOf('model', 'R1'), 'R1');
  assert.equal(valueOf('unit', 'шт'), 'шт');
  assert.match(errorOf('name', '   '), /обязательно/);
  assert.match(errorOf('model', ''), /обязательно/);
  assert.match(errorOf('unit', ''), /обязательно/);
});

test('артикул и производитель необязательны и очищаются до пустого значения', () => {
  assert.equal(valueOf('code', ' AB-12 '), 'AB-12');
  assert.equal(valueOf('code', ''), '');
  assert.equal(valueOf('manufacturer', '   '), '');
});

test('в ключ материала входят только описательные поля', () => {
  assert.equal(specFieldAffectsMaterialKey('code'), true);
  assert.equal(specFieldAffectsMaterialKey('name'), true);
  assert.equal(specFieldAffectsMaterialKey('unit'), true);
  assert.equal(specFieldAffectsMaterialKey('requiredQty'), false);
  assert.equal(specFieldAffectsMaterialKey('deadline'), false);
  assert.equal(specFieldAffectsMaterialKey('rowNo'), false);
});

test('предупреждение о ключе появляется только когда ключ действительно изменился', () => {
  // Артикул есть: ключ = «артикул + производитель», правка ед.изм. ключ не меняет.
  const withCode = { code: 'AB-12', manufacturer: 'Bosch', name: 'Резистор', model: 'R1', unit: 'шт' };
  assert.equal(wouldBeMaterialKey(withCode), 'AB-12|Bosch');
  assert.equal(
    describeKeyNote({ field: 'unit', currentKey: 'AB-12|Bosch', nextIdentity: { ...withCode, unit: 'компл' } }),
    '',
    'правка поля не из ключа — предупреждать не о чем',
  );
  assert.match(
    describeKeyNote({ field: 'code', currentKey: 'AB-12|Bosch', nextIdentity: { ...withCode, code: 'AB-99' } }),
    /входит в ключ материала/,
  );

  // Артикула нет: ключ собирается из наименования, модели, производителя и ед.изм.,
  // поэтому правка модели его меняет.
  const withoutCode = { code: '', manufacturer: 'Bosch', name: 'Резистор', model: 'R1', unit: 'шт' };
  assert.equal(wouldBeMaterialKey(withoutCode), 'Резистор|R1|Bosch|шт');
  assert.match(
    describeKeyNote({
      field: 'model',
      currentKey: 'Резистор|R1|Bosch|шт',
      nextIdentity: { ...withoutCode, model: 'R2' },
    }),
    /входит в ключ материала/,
  );

  // Правка количества на ключ не влияет никогда.
  assert.equal(
    describeKeyNote({ field: 'requiredQty', currentKey: 'Резистор|R1|Bosch|шт', nextIdentity: withoutCode }),
    '',
  );
});
