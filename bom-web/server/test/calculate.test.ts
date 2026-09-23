/**
 * Проверки расчётного движка — ядро системы.
 *
 * Здесь зафиксированы формулы и порядок определения состояний. Эти проверки —
 * страховка при любых будущих правках: если расчёт разойдётся с прежней
 * системой, тест это покажет.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculatePositionState } from '../src/domain/calculate.js';
import { FLAGS, PRODUCTION_STATE, SUPPLY_STATE } from '../src/domain/constants.js';
import type { CalculationInput, PositionIdentity } from '../src/domain/types.js';

/** Корректная «шапка» позиции, чтобы проверять именно арифметику, а не валидацию. */
const identity: PositionIdentity = {
  rowNo: 1,
  code: 'AB-12',
  manufacturer: 'Bosch',
  name: 'Резистор',
  model: 'R1',
  unit: 'шт',
  deadline: '2026-09-20',
};

function calc(overrides: Partial<CalculationInput> = {}) {
  return calculatePositionState({
    requiredQty: 10,
    reservedQty: 0,
    orderedQty: 0,
    realDeliveryQty: 0,
    receivedQty: 0,
    received: false,
    identity,
    ...overrides,
  });
}

test('дефицит считается от резерва и НЕ уменьшается на заказанное', () => {
  const result = calc({ requiredQty: 10, reservedQty: 3, orderedQty: 4 });
  assert.equal(result.deficitQty, 7, '10 − 3 = 7, заказ не вычитается');
  assert.equal(result.uncoveredNeed, 3, '7 − 4 = 3');
  assert.equal(result.overOrderedQty, 0);
});

test('перезаказ и недопоставка считаются отдельно', () => {
  const over = calc({ requiredQty: 10, reservedQty: 0, orderedQty: 15 });
  assert.equal(over.overOrderedQty, 5);
  assert.ok(over.flags.includes(FLAGS.OVER_ORDERED));

  const short = calc({ requiredQty: 10, reservedQty: 0, orderedQty: 10, realDeliveryQty: 4 });
  assert.equal(short.shortDeliveryQty, 6);
  assert.ok(short.flags.includes(FLAGS.SHORT_DELIVERY));
});

test('доступно для производства = резерв + реальная поставка (склад не участвует)', () => {
  const result = calc({ requiredQty: 10, reservedQty: 3, realDeliveryQty: 5 });
  assert.equal(result.availableForProduction, 8);
});

test('готовность к передаче: полностью обеспечено, валидно и ещё не передано', () => {
  assert.equal(calc({ requiredQty: 10, reservedQty: 8, realDeliveryQty: 2 }).readyForHandoff, true);
  assert.equal(calc({ requiredQty: 10, reservedQty: 8, realDeliveryQty: 1 }).readyForHandoff, false);
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 10, received: true }).readyForHandoff,
    false,
    'переданная позиция не может быть «готова к передаче»',
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 10, identity: { ...identity, model: '' } }).readyForHandoff,
    false,
    'невалидная позиция передаче не подлежит',
  );
});

test('состояние снабжения: порядок ветвлений', () => {
  assert.equal(calc({ requiredQty: 0 }).supplyState, SUPPLY_STATE.NO_REQUIREMENT);
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 10 }).supplyState,
    SUPPLY_STATE.RESERVED,
  );
  assert.equal(calc({ requiredQty: 10, reservedQty: 0 }).supplyState, SUPPLY_STATE.NOT_ORDERED);
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 0, orderedQty: 4 }).supplyState,
    SUPPLY_STATE.PARTIALLY_ORDERED,
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 0, orderedQty: 10 }).supplyState,
    SUPPLY_STATE.ORDERED,
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 0, orderedQty: 10, realDeliveryQty: 4 }).supplyState,
    SUPPLY_STATE.PARTIALLY_DELIVERED,
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 0, orderedQty: 10, realDeliveryQty: 10 }).supplyState,
    SUPPLY_STATE.DELIVERED,
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 10, orderedQty: 0 }).supplyState,
    SUPPLY_STATE.RESERVED,
    'резерв важнее отсутствия заказа',
  );
});

test('состояние производства', () => {
  assert.equal(calc({ requiredQty: 10 }).productionState, PRODUCTION_STATE.NOT_AVAILABLE);
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 4 }).productionState,
    PRODUCTION_STATE.PARTIALLY_AVAILABLE,
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 10 }).productionState,
    PRODUCTION_STATE.READY_FOR_HANDOFF,
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 10, received: true }).productionState,
    PRODUCTION_STATE.RECEIVED,
  );
  assert.equal(
    calc({ requiredQty: 10, reservedQty: 10, identity: { ...identity, unit: '' } }).productionState,
    PRODUCTION_STATE.PARTIALLY_AVAILABLE,
    'невалидная позиция не может быть готова к передаче',
  );
});

test('невалидная позиция помечается флагом CHANGED и признаком ошибки', () => {
  const result = calc({ identity: { ...identity, deadline: null } });
  assert.equal(result.valid, false);
  assert.ok(result.flags.includes(FLAGS.CHANGED));
  assert.equal(result.missing.deadline, true);
});
