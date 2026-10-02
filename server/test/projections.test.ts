/**
 * Проверки представлений: сводка дефицитов, WORKING BOM, отборка, снабжение.
 *
 * Здесь зафиксирован «что видит роль»: состав строк, порядок сортировки, цвета и
 * правило «передавать можно только готовые позиции».
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COLORS } from '../src/domain/constants.js';
import { buildPickingRows, buildProjectCodes, pickingDeliveryDate } from '../src/domain/picking.js';
import { buildDeficitRows, buildWorkingBomRows } from '../src/domain/projectionsRows.js';
import { buildSupplyRows } from '../src/domain/supply.js';
import { makePosition } from './helpers.js';

test('сводка дефицитов: состав строк', () => {
  const fullyCovered = makePosition({ quantities: { reservedQty: 10 } });
  const received = makePosition({
    quantities: { reservedQty: 10, received: true, receivedQty: 10 },
  });
  const deficit = makePosition({ quantities: { requiredQty: 10, reservedQty: 4 } });

  const rows = buildDeficitRows([fullyCovered, received, deficit]);
  assert.equal(rows.length, 1, 'в сводку попадает только позиция с дефицитом');
  assert.equal(rows[0]?.positionId, deficit.positionId);
  assert.equal(rows[0]?.deficitQty, 6);
  assert.equal(rows[0]?.projectCode, '1234.АБВ');
  assert.equal(rows[0]?.statusKey, 'NOT_ORDERED', 'без заказа — «не заказано»');
});

test('сводка дефицитов: ожидаемая дата и статус учитываются', () => {
  const position = makePosition({
    quantities: { requiredQty: 10, orderedQty: 10 },
    expectedDate: '2026-09-10',
  });
  const rows = buildDeficitRows([position]);
  assert.equal(rows[0]?.expectedDate, '2026-09-10');
  assert.equal(rows[0]?.statusKey, 'ON_TIME');
  assert.equal(rows[0]?.statusColor, COLORS.YELLOW);
});

test('WORKING BOM: только активные позиции, архивные не показываем', () => {
  const active = makePosition({ quantities: { requiredQty: 10 } });
  const archived = makePosition({
    positionId: 'other:key',
    quantities: { requiredQty: 10, received: true, receivedQty: 10 },
    lifecycle: 'ARCHIVED',
  });
  const rows = buildWorkingBomRows([active, archived]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.positionId, active.positionId);
});

test('отборка: фильтр по проекту и порядок «готовые сверху»', () => {
  const bomA = '1000.ААА Изделие';
  const bomB = '2000.БББ Изделие';
  const waiting = makePosition({
    positionId: `${bomA}:worst`,
    bomId: bomA,
    bomName: bomA,
    identity: { rowNo: 1, code: 'W-1', name: 'Ожидаемый' },
    materialKey: 'W-1|Bosch',
    quantities: { requiredQty: 10 },
  });
  const ready = makePosition({
    positionId: `${bomA}:ready`,
    bomId: bomA,
    bomName: bomA,
    identity: { rowNo: 2, code: 'R-1', name: 'Готовый' },
    materialKey: 'R-1|Bosch',
    quantities: { requiredQty: 10, reservedQty: 10 },
    realDeliveryDate: '2026-09-15',
  });
  const otherProject = makePosition({
    positionId: `${bomB}:x`,
    bomId: bomB,
    bomName: bomB,
    materialKey: 'X|Bosch',
    quantities: { requiredQty: 5, reservedQty: 5 },
  });

  const all = buildPickingRows([waiting, ready, otherProject]);
  assert.equal(all.length, 3);
  assert.equal(all[0]?.positionId, ready.positionId, 'готовая строка идёт первой внутри своего BOM');

  const filtered = buildPickingRows([waiting, ready, otherProject], { projectCode: '1000.ААА' });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((row) => row.projectCode === '1000.ААА'));

  const readyRow = filtered.find((row) => row.positionId === ready.positionId);
  assert.equal(readyRow?.canHandoff, true);
  assert.equal(readyRow?.color, COLORS.STOCK, 'готовые строки — голубые');
  assert.equal(readyRow?.deliveryDate, '2026-09-15', 'дата поставки — дата фактического прихода');

  const waitingRow = filtered.find((row) => row.positionId === waiting.positionId);
  assert.equal(waitingRow?.canHandoff, false);
  assert.equal(waitingRow?.color, COLORS.RED, 'не заказано — красная строка');
});

test('отборка: дата поставки приоритетом даёт дату создания BOM при закрытии резервом', () => {
  const coveredByReserve = makePosition({
    quantities: { requiredQty: 10, reservedQty: 10 },
    expectedDate: '2026-12-31',
  });
  assert.equal(pickingDeliveryDate(coveredByReserve, '2026-01-15'), '2026-01-15');

  const ordered = makePosition({
    quantities: { requiredQty: 10, reservedQty: 0, orderedQty: 10 },
    expectedDate: '2026-12-31',
  });
  assert.equal(pickingDeliveryDate(ordered, '2026-01-15'), '2026-12-31');
});

test('отборка: коды проектов для фильтра уникальны и отсортированы', () => {
  const codes = buildProjectCodes([
    makePosition({ bomId: '2000.БББ', bomName: '2000.БББ' }),
    makePosition({ bomId: '1000.ААА', bomName: '1000.ААА' }),
    makePosition({ bomId: '1000.ААА', bomName: '1000.ААА', positionId: 'dup' }),
  ]);
  assert.deepEqual(codes, ['1000.ААА', '2000.БББ']);
});

test('снабжение: агрегация по ключу материала и перечень проектов', () => {
  const sameMaterial = 'AB-12|Bosch';
  const positions = [
    makePosition({
      bomId: '1000.ААА',
      bomName: '1000.ААА',
      positionId: 'p1',
      materialKey: sameMaterial,
      identity: { rowNo: 1, code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт' },
      quantities: { requiredQty: 10, orderedQty: 0 },
    }),
    makePosition({
      bomId: '2000.БББ',
      bomName: '2000.БББ',
      positionId: 'p2',
      materialKey: sameMaterial,
      identity: {
        rowNo: 1,
        code: 'AB-12',
        name: 'Резистор',
        model: 'R1',
        unit: 'шт',
        deadline: '2026-10-01',
      },
      quantities: { requiredQty: 5, orderedQty: 5 },
      expectedDate: '2026-09-01',
    }),
  ];

  const rows = buildSupplyRows(positions);
  assert.equal(rows.length, 1, 'один материал — одна строка');
  const row = rows[0];
  assert.equal(row?.totalDeficit, 15);
  assert.equal(row?.totalOrdered, 5);
  assert.equal(row?.projects.length, 2);
  assert.equal(
    row?.projects[0]?.text,
    '10 - 1000.ААА - 20.09.2026',
    'проекты сортируются по возрастанию крайнего срока',
  );
  assert.equal(row?.projects[1]?.text, '5 - 2000.БББ - 01.10.2026');
});
