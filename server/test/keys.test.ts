/**
 * Проверки ключей и валидации: ключ материала, идентификатор позиции,
 * обязательные поля спецификации.
 *
 * Ключи — самая «долгоживущая» часть системы: на них завязаны история, архив и
 * ссылки в аудите. Правила обязаны совпадать с прежней системой дословно.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { basePositionId, buildMaterialKey, buildPositionId } from '../src/domain/materialKeys.js';
import { describeMissingFields, validatePosition } from '../src/domain/validation.js';

test('buildMaterialKey: артикул важнее наименования, производитель разделяет', () => {
  assert.equal(buildMaterialKey({ code: 'AB-12' }), 'AB-12');
  assert.equal(buildMaterialKey({ code: 'AB-12', manufacturer: 'Bosch' }), 'AB-12|Bosch');
  assert.equal(
    buildMaterialKey({ name: 'Резистор', model: 'R1', unit: 'шт' }),
    'Резистор|R1|шт',
  );
  assert.equal(
    buildMaterialKey({ name: 'Резистор', model: 'R1', unit: 'шт', manufacturer: 'Bosch' }),
    'Резистор|R1|Bosch|шт',
  );
  // Пробелы не должны влиять на ключ.
  assert.equal(buildMaterialKey({ code: '  AB-12  ', manufacturer: ' Bosch ' }), 'AB-12|Bosch');
});

test('buildPositionId: база и суффикс при повторе материала в BOM', () => {
  const taken = new Set<string>();
  const first = buildPositionId('1234.АБВ', 'AB-12', taken);
  assert.equal(first, '1234.АБВ:AB-12');
  assert.equal(basePositionId('1234.АБВ', 'AB-12'), first);

  taken.add(first);
  const second = buildPositionId('1234.АБВ', 'AB-12', taken);
  assert.equal(second, '1234.АБВ:AB-12#2');

  taken.add(second);
  assert.equal(buildPositionId('1234.АБВ', 'AB-12', taken), '1234.АБВ:AB-12#3');
});

test('buildPositionId: пустой ключ материала не ломает идентификатор', () => {
  assert.equal(basePositionId('BOM', ''), 'BOM:UNKNOWN');
});

test('validatePosition: обязательные поля спецификации', () => {
  const validIdentity = {
    rowNo: 1,
    code: '',            // артикул НЕ обязателен
    manufacturer: '',
    name: 'Резистор',
    model: 'R1',
    unit: 'шт',
    deadline: '2026-09-20',
  };

  const ok = validatePosition(validIdentity, 10);
  assert.equal(ok.valid, true, 'позиция без артикула валидна');
  assert.equal(describeMissingFields(ok.missing).length, 0);

  const noModel = validatePosition({ ...validIdentity, model: '' }, 10);
  assert.equal(noModel.valid, false);
  assert.deepEqual(describeMissingFields(noModel.missing), ['Модель']);

  const zeroQty = validatePosition(validIdentity, 0);
  assert.equal(zeroQty.valid, false);
  assert.deepEqual(describeMissingFields(zeroQty.missing), ['Кол-во (> 0)']);

  const noDeadline = validatePosition({ ...validIdentity, deadline: null }, 10);
  assert.equal(noDeadline.valid, false);
  assert.deepEqual(describeMissingFields(noDeadline.missing), ['Крайний срок поставки']);

  const emptyRow = validatePosition({ ...validIdentity, rowNo: 0, name: '   ' }, 10);
  assert.equal(emptyRow.valid, false);
  assert.deepEqual(describeMissingFields(emptyRow.missing), ['№ п/п', 'Наименование']);
});
