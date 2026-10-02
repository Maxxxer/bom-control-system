/**
 * Проверки исхода снабжения и статуса строки сводки дефицитов.
 *
 * Главное правило: заказ считается оформленным только когда заполнены ОБА поля —
 * количество И ожидаемая дата. Именно это правило чаще всего проверяют
 * пользователи, поэтому оно зафиксировано отдельными проверками.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deficitStatus, procurementOutcome } from '../src/domain/procurement.js';
import { COLORS, DEFICIT_STATUS } from '../src/domain/constants.js';

const base = {
  orderedQty: 10,
  deficitQty: 10,
  expectedDate: '2026-09-10',
  deadline: '2026-09-20',
};

test('без количества заказа — «не заказано»', () => {
  assert.equal(procurementOutcome({ ...base, orderedQty: 0 }), 'NOT_ORDERED');
});

test('количество без ожидаемой даты — «не заказано»', () => {
  assert.equal(procurementOutcome({ ...base, expectedDate: null }), 'NOT_ORDERED');
  assert.equal(procurementOutcome({ ...base, expectedDate: '' }), 'NOT_ORDERED');
});

test('без крайнего срока сопоставление невозможно — «не заказано»', () => {
  assert.equal(procurementOutcome({ ...base, deadline: null }), 'NOT_ORDERED');
});

test('заказано меньше дефицита — «заказано частично»', () => {
  assert.equal(procurementOutcome({ ...base, orderedQty: 4, deficitQty: 10 }), 'PARTIAL');
});

test('в срок и с опозданием', () => {
  assert.equal(procurementOutcome({ ...base, expectedDate: '2026-09-20' }), 'ON_TIME', 'ровно в срок');
  assert.equal(procurementOutcome({ ...base, expectedDate: '2026-09-21' }), 'LATE');
});

test('статус строки сводки: тексты и цвета как в прежней системе', () => {
  const notOrdered = deficitStatus({ ...base, orderedQty: 0 }, true);
  assert.equal(notOrdered.text, DEFICIT_STATUS.NOT_ORDERED);
  assert.equal(notOrdered.color, COLORS.RED);

  const partial = deficitStatus({ ...base, orderedQty: 4 }, true);
  assert.equal(partial.text, DEFICIT_STATUS.PARTIAL);
  assert.equal(partial.color, COLORS.RED);

  const onTime = deficitStatus(base, true);
  assert.equal(onTime.text, DEFICIT_STATUS.ON_TIME);
  assert.equal(onTime.color, COLORS.YELLOW);

  const late = deficitStatus({ ...base, expectedDate: '2026-10-01' }, true);
  assert.equal(late.text, DEFICIT_STATUS.LATE);
  assert.equal(late.color, COLORS.ORANGE);
});

test('ошибка данных важнее любого исхода снабжения', () => {
  const status = deficitStatus(base, false);
  assert.equal(status.key, 'ERROR');
  assert.equal(status.text, DEFICIT_STATUS.ERROR);
  assert.equal(status.color, COLORS.GRAY);
});
