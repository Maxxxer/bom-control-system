/**
 * Проверки сущности позиции: производные значения и правила видимости.
 *
 * Правила видимости определяют, на каких экранах позиция появляется, а
 * `applyComputed` — единственное место, где пересчитываются производные значения
 * после правок. Ошибка здесь «прячет» или «задваивает» позиции у пользователей.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyComputed,
  isActive,
  isDeficitVisible,
  isReceived,
  isSupplyVisible,
  materialKeyOf,
} from '../src/domain/position.js';
import { makePosition } from './helpers.js';

test('applyComputed пересчитывает производные значения после правки количеств', () => {
  const before = makePosition({ quantities: { requiredQty: 10, reservedQty: 0 } });
  assert.equal(before.computed.deficitQty, 10);

  const after = applyComputed({
    ...before,
    quantities: { ...before.quantities, reservedQty: 6 },
  });
  assert.equal(after.computed.deficitQty, 4, 'дефицит пересчитан');
  assert.equal(after.computed.availableForProduction, 6);
  assert.equal(before.computed.deficitQty, 10, 'исходный объект не изменён');
});

test('materialKeyOf повторяет правило ключа материала', () => {
  const withCode = makePosition({
    identity: { code: 'AB-12', manufacturer: 'Bosch', name: 'Резистор', model: 'R1', unit: 'шт' },
  });
  assert.equal(materialKeyOf(withCode), 'AB-12|Bosch');

  const withoutCode = makePosition({
    identity: { code: '', manufacturer: 'Bosch', name: 'Резистор', model: 'R1', unit: 'шт' },
  });
  assert.equal(materialKeyOf(withoutCode), 'Резистор|R1|Bosch|шт');
});

test('isActive и isReceived различают жизненный цикл и факт передачи', () => {
  const active = makePosition();
  assert.equal(isActive(active), true);
  assert.equal(isReceived(active), false);

  const archived = makePosition({
    quantities: { received: true, receivedQty: 10 },
    lifecycle: 'ARCHIVED',
  });
  assert.equal(isActive(archived), false);
  assert.equal(isReceived(archived), true);
});

test('видимость в сводке дефицитов', () => {
  // Нужен заказ: есть дефицит и материал не обеспечен полностью.
  assert.equal(isDeficitVisible(makePosition({ quantities: { requiredQty: 10 } })), true);
  // Материал обеспечен резервом — в сводке не нужен.
  assert.equal(
    isDeficitVisible(makePosition({ quantities: { requiredQty: 10, reservedQty: 10 } })),
    false,
  );
  // Уже передано производству — позиция закрыта.
  assert.equal(
    isDeficitVisible(
      makePosition({
        quantities: { requiredQty: 10, reservedQty: 10, received: true, receivedQty: 10 },
        lifecycle: 'ARCHIVED',
      }),
    ),
    false,
  );
});

test('видимость в снабжении: дефицит не закрыт и материал не обеспечен', () => {
  assert.equal(isSupplyVisible(makePosition({ quantities: { requiredQty: 10 } })), true);
  assert.equal(
    isSupplyVisible(makePosition({ quantities: { requiredQty: 10, reservedQty: 3, realDeliveryQty: 7 } })),
    false,
    'материал обеспечен резервом и приходом',
  );
  assert.equal(
    isSupplyVisible(makePosition({ quantities: { requiredQty: 0 } })),
    false,
    'потребности нет — в снабжении нечего делать',
  );
});
