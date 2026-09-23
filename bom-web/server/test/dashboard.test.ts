/**
 * Проверки дашборда: агрегат по BOM, статусы и правило «Выполнено».
 *
 * Статус BOM — это сводка для производства, поэтому порядок приоритетов
 * (ошибка → собран → на складе → не заказано → опаздывает → в срок) зафиксирован
 * отдельными проверками: именно он определяет, что видит человек в списке.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregateBomStates, buildDashboardRows } from '../src/domain/dashboard.js';
import { computeBomStatus, isBomReadyForDone } from '../src/domain/bomStatus.js';
import { BOM_STATUS, COLORS } from '../src/domain/constants.js';
import { expectDefined, makePosition } from './helpers.js';

const BOM = '1234.АБВ-5678 Щит';

test('агрегат: ошибки, склад, снабжение и передача считаются раздельно', () => {
  const positions = [
    // Ошибка данных — модель не заполнена.
    makePosition({
      positionId: 'p-error',
      bomId: BOM,
      bomName: BOM,
      identity: { rowNo: 1, model: '' },
      materialKey: 'A',
    }),
    // Готово к передаче (на складе).
    makePosition({
      positionId: 'p-ready',
      bomId: BOM,
      bomName: BOM,
      identity: { rowNo: 2, code: 'B' },
      materialKey: 'B',
      quantities: { requiredQty: 10, reservedQty: 10 },
      realDeliveryDate: '2026-09-15',
    }),
    // Передано производству.
    makePosition({
      positionId: 'p-done',
      bomId: BOM,
      bomName: BOM,
      identity: { rowNo: 3, code: 'C' },
      materialKey: 'C',
      quantities: { requiredQty: 5, reservedQty: 5, received: true, receivedQty: 5 },
      receivedAt: '2026-09-18T12:30:00.000Z',
      lifecycle: 'ARCHIVED',
    }),
    // В снабжении: заказано в срок.
    makePosition({
      positionId: 'p-order',
      bomId: BOM,
      bomName: BOM,
      identity: { rowNo: 4, code: 'D' },
      materialKey: 'D',
      quantities: { requiredQty: 10, orderedQty: 10 },
      expectedDate: '2026-09-20',
    }),
  ];

  const agg = expectDefined(aggregateBomStates(positions).get(BOM), 'BOM присутствует в агрегате');
  assert.equal(agg.total, 4);
  assert.equal(agg.errors, 1);
  assert.equal(agg.onShelf, 1);
  assert.equal(agg.collected, 1);
  assert.equal(agg.awaitingSupply, 1);
  assert.equal(agg.onTime, 1);
  assert.equal(agg.minDeadline, '2026-09-20');
  assert.equal(agg.maxReceivedAt, '2026-09-18T12:30:00.000Z');
  assert.equal(
    agg.missing.length,
    2,
    'в недостачи попадают ошибка данных и позиция снабжения; материал на складе недостачей не считается',
  );
  assert.equal(agg.onShelfEntries.length, 1, 'позиция на складе попадает в подсказку «На складе»');
  assert.equal(agg.supplyEntries.length, 1, 'позиция снабжения попадает в подсказку «Ожидается поставка»');
});

test('статус BOM: приоритеты', () => {
  const base = {
    bomId: BOM,
    bomName: BOM,
    total: 2,
    collected: 0,
    onShelf: 0,
    awaitingSupply: 0,
    notOrdered: 0,
    partial: 0,
    late: 0,
    onTime: 0,
    errors: 0,
    missing: [],
    onShelfEntries: [],
    supplyEntries: [],
    minDeadline: null,
    maxReceivedAt: null,
  };

  assert.equal(computeBomStatus({ ...base, errors: 1, collected: 2 }), BOM_STATUS.ERROR);
  assert.equal(computeBomStatus({ ...base, collected: 2 }), BOM_STATUS.READY);
  assert.equal(computeBomStatus({ ...base, collected: 1, onShelf: 1 }), BOM_STATUS.ON_SHELF);
  assert.equal(
    computeBomStatus({ ...base, collected: 1, onShelf: 0, notOrdered: 1 }),
    BOM_STATUS.NOT_ORDERED,
  );
  assert.equal(computeBomStatus({ ...base, late: 1 }), BOM_STATUS.WAITING_LATE);
  assert.equal(computeBomStatus({ ...base, onTime: 1 }), BOM_STATUS.WAITING_ON_TIME);
});

test('галочка «Выполнено» доступна только при полном комплекте', () => {
  const readyAgg = expectDefined(
    aggregateBomStates([
      makePosition({
        bomId: BOM,
        bomName: BOM,
        quantities: { requiredQty: 5, reservedQty: 5, received: true, receivedQty: 5 },
        lifecycle: 'ARCHIVED',
      }),
    ]).get(BOM),
    'агрегат комплектного BOM',
  );
  assert.equal(isBomReadyForDone(readyAgg), true);

  const notReadyAgg = expectDefined(
    aggregateBomStates([
      makePosition({ bomId: BOM, bomName: BOM, quantities: { requiredQty: 5, reservedQty: 2 } }),
    ]).get(BOM),
    'агрегат некомплектного BOM',
  );
  assert.equal(isBomReadyForDone(notReadyAgg), false);
});

test('дашборд: выполненный BOM не показывается, комплектный помечается датой', () => {
  const done = makePosition({
    bomId: '1000.ГОТОВ',
    bomName: '1000.ГОТОВ',
    quantities: { requiredQty: 5, reservedQty: 5, received: true, receivedQty: 5 },
    receivedAt: '2026-09-18T12:30:00.000Z',
    lifecycle: 'ARCHIVED',
  });
  const pending = makePosition({
    bomId: '2000.ОЖИД',
    bomName: '2000.ОЖИД',
    quantities: { requiredQty: 5 },
  });

  const rows = buildDashboardRows([done, pending], {
    excludedBomIds: new Set(['1000.ГОТОВ']),
    bomCreatedDates: new Map([['2000.ОЖИД', '2026-01-10']]),
  });

  assert.equal(rows.length, 1, 'выполненный BOM исключён из активного списка');
  const row = expectDefined(rows[0], 'строка дашборда');
  assert.equal(row?.bomId, '2000.ОЖИД');
  assert.equal(row?.dateCreated, '2026-01-10');
  assert.equal(row?.status, BOM_STATUS.NOT_ORDERED);
  assert.equal(row?.statusColor, COLORS.RED);
  assert.equal(row?.done, false);
});

test('дашборд: комплектный BOM показывает отметку «Скомплектовано»', () => {
  const done = makePosition({
    bomId: '3000.СОБРАН',
    bomName: '3000.СОБРАН',
    quantities: { requiredQty: 5, reservedQty: 5, received: true, receivedQty: 5 },
    receivedAt: '2026-09-18T12:30:00.000Z',
    lifecycle: 'ARCHIVED',
  });
  const rows = buildDashboardRows([done]);
  // Время выводится в часовом поясе сервера, поэтому проверяем формат и дату.
  assert.match(rows[0]?.missingText ?? '', /^Скомплектовано - 18\.09\.2026 \d{2}:\d{2}$/);
});
