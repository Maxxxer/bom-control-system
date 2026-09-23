/**
 * Проверки нормализации значений: числа, даты, чекбоксы, коды проектов.
 *
 * Эти функции — «ворота» для всех внешних данных: числа из CSV, даты из Excel,
 * галочки из форм. Ошибка здесь ломает расчёт во всей системе, поэтому набор
 * проверок подробный.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareIsoDates,
  extractProjectCode,
  formatDateOnly,
  isChecked,
  isoFromDate,
  norm,
  toDate,
  toIsoDate,
  toNumber,
  toQty,
  trimmed,
} from '../src/domain/values.js';

test('toNumber: разделители тысяч и десятичные запятые', () => {
  assert.equal(toNumber('1,234.56'), 1234.56);
  assert.equal(toNumber('1.234,56'), 1234.56);
  assert.equal(toNumber('1,5'), 1.5);
  assert.equal(toNumber('1.234.567'), 1234567);
  assert.equal(toNumber('  42 '), 42);
  assert.equal(toNumber('12 шт'), 12);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber('нет данных'), 0);
  assert.equal(toNumber(7.5), 7.5);
  assert.equal(toNumber(true), 1);
});

test('toQty: количества не бывают отрицательными', () => {
  assert.equal(toQty(-5), 0);
  assert.equal(toQty('3'), 3);
  assert.equal(toQty(''), 0);
});

test('toDate/toIsoDate: форматы дат и серийные номера', () => {
  assert.equal(toIsoDate('20.09.2026'), '2026-09-20');
  assert.equal(toIsoDate('2026-09-20'), '2026-09-20');
  assert.equal(toIsoDate(''), null);
  assert.equal(toIsoDate(null), null);
  // Серийный номер таблиц: 0 = 30.12.1899, значит 2 = 01.01.1900.
  assert.equal(toIsoDate(2), '1900-01-01');
  assert.equal(toIsoDate(0), null, 'нулевой серийный номер — это «нет даты»');
  assert.ok(toDate('01.01.2020') instanceof Date);
  assert.equal(isoFromDate(null), null);
});

test('formatDateOnly: отображение даты по-русски', () => {
  assert.equal(formatDateOnly('2026-09-20'), '20.09.2026');
  assert.equal(formatDateOnly('20.09.2026'), '20.09.2026');
  assert.equal(formatDateOnly(''), '');
  assert.equal(formatDateOnly(null), '');
});

test('isChecked: чекбоксы из форм и таблиц', () => {
  assert.equal(isChecked(true), true);
  assert.equal(isChecked('TRUE'), true);
  assert.equal(isChecked('да'), true);
  assert.equal(isChecked('1'), true);
  assert.equal(isChecked(1), true);
  assert.equal(isChecked(false), false);
  assert.equal(isChecked(''), false);
  assert.equal(isChecked(null), false);
  assert.equal(isChecked('0'), false);
});

test('norm и trimmed: подготовка строк для сравнения и хранения', () => {
  assert.equal(norm('  ABC '), 'abc');
  assert.equal(norm(undefined), '');
  assert.equal(trimmed('  текст  '), 'текст');
  assert.equal(trimmed(null), '');
  assert.ok(trimmed('x'.repeat(1000)).length <= 500, 'длинные строки обрезаются');
});

test('extractProjectCode: код проекта из имени BOM', () => {
  assert.equal(extractProjectCode('1234.АБВ-5678 Щит'), '1234.АБВ');
  assert.equal(extractProjectCode('1234 АБВ'), '1234');
  assert.equal(extractProjectCode('1234_АБВ'), '1234');
  assert.equal(extractProjectCode(''), '');
  assert.equal(extractProjectCode(null), '');
});

test('compareIsoDates: пустая дата уходит в конец', () => {
  assert.equal(compareIsoDates(null, '2026-01-01'), 1);
  assert.equal(compareIsoDates('2026-01-01', null), -1);
  assert.equal(compareIsoDates('2026-01-01', '2026-01-02'), -1);
  assert.equal(compareIsoDates('2026-02-01', '2026-01-02'), 1);
  assert.equal(compareIsoDates(null, null), 0);
});
