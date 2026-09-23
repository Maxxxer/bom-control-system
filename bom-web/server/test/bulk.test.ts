/**
 * Проверки массовой правки и отката на РЕАЛЬНОЙ базе (PGlite в памяти).
 *
 * Почему нужен именно такой тест, а не только проверки правил. Здесь живёт то, что
 * нельзя проверить на чистых функциях:
 *   * вся пачка применяется ОДНОЙ транзакцией и получает ОДИН идентификатор
 *     операции — иначе в журнале вставка блока выглядела бы как сотня независимых
 *     правок и разобраться в ней было бы нельзя;
 *   * повторное значение не пишет в журнал (вставка того же блока дважды не должна
 *     его раздувать);
 *   * «Поставлено» меняет склад НА ДЕЛЬТУ — значит, повторная вставка того же
 *     количества не должна начислять приход дважды;
 *   * откат возвращает прежние значения, но НЕ затирает то, что изменили позже.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { migrateSchema } from '../src/db/createDatabase.js';
import type { Database } from '../src/db/Database.js';
import { PgliteDatabase } from '../src/db/pgliteDatabase.js';
import { LIMITS } from '../src/domain/constants.js';
import type { Role } from '../src/domain/types.js';
import { listAuditByOperation } from '../src/repositories/auditLog.js';
import { findPositionByPositionId } from '../src/repositories/positions.js';
import { applyBulkChanges, type BulkChangeInput } from '../src/services/bulkService.js';
import { createOperationContext } from '../src/services/operationLog.js';
import { rollbackOperation } from '../src/services/rollbackService.js';
import { expectDefined } from './helpers.js';

const BOM_CODE = '9000.ТЕСТ Массовый ввод';

interface SeedItem {
  code: string;
  name: string;
  model: string;
  unit: string;
  requiredQty: number;
  manufacturer?: string;
}

/** Открыть пустую базу со схемой: состояние теста не переживает прогон. */
async function openDatabase(): Promise<Database> {
  const db = await PgliteDatabase.openInMemory();
  await migrateSchema(db);
  return db;
}

/** Завести спецификацию с позициями тем же набором полей, что даёт импорт. */
async function seedBom(db: Database, items: readonly SeedItem[]): Promise<string[]> {
  const bomRows = await db.query<{ id: string | number }>(
    `insert into boms (code, name) values ($1, $1) returning id`,
    [BOM_CODE],
  );
  const bomId = Number(bomRows[0]?.id ?? 0);
  const positionIds: string[] = [];

  for (const [index, item] of items.entries()) {
    const manufacturer = item.manufacturer ?? 'Bosch';
    const materialKey = `${item.code}|${manufacturer}`;
    const positionId = `${BOM_CODE}:${materialKey}`;
    await db.execute(
      `insert into bom_positions (
         bom_id, position_id, material_key, row_no, code, manufacturer,
         name, model, unit, required_qty, reserved_qty, deadline
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11)`,
      [
        bomId,
        positionId,
        materialKey,
        index + 1,
        item.code,
        manufacturer,
        item.name,
        item.model,
        item.unit,
        item.requiredQty,
        '2026-09-20',
      ],
    );
    positionIds.push(positionId);
  }
  return positionIds;
}

/** Контекст операции от имени роли. */
function contextOf(role: Role) {
  return createOperationContext(`user-${role}`, role);
}

/** Остаток материала на складе. */
async function warehouseQtyOf(db: Database, materialKey: string): Promise<number> {
  const rows = await db.query<{ warehouse_qty: number | string }>(
    `select warehouse_qty::float8 as warehouse_qty from materials where material_key = $1`,
    [materialKey],
  );
  return Number(rows[0]?.warehouse_qty ?? 0);
}

test('массовая правка применяет разные поля и позиции одной командой', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
      { code: 'CD-34', name: 'Конденсатор', model: 'C2', unit: 'шт', requiredQty: 4 },
    ]);
    const first = expectDefined(ids[0], 'первая позиция');
    const second = expectDefined(ids[1], 'вторая позиция');

    const changes: BulkChangeInput[] = [
      { positionId: first, field: 'orderedQty', value: '10' },
      { positionId: first, field: 'expectedDate', value: '20.09.2026' },
      { positionId: second, field: 'orderedQty', value: 4 },
    ];

    const result = await applyBulkChanges(db, contextOf('procurement'), { changes });

    assert.equal(result.applied, 3, 'применены все три изменения');
    assert.equal(result.blocked, 0);
    assert.equal(result.positions.length, 2, 'обновлённые позиции вернулись для перерисовки');

    const position = await findPositionByPositionId(db, first);
    assert.equal(position?.quantities.orderedQty, 10);
    assert.equal(position?.expectedDate, '2026-09-20');

    // Вся вставка — ОДНА операция в журнале, а не три независимые правки.
    const journal = await listAuditByOperation(db, result.operationId);
    assert.equal(journal.length, 3);
    assert.ok(journal.every((entry) => entry.operationId === result.operationId));
  } finally {
    await db.close();
  }
});

test('повторное значение не попадает в журнал', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');

    await applyBulkChanges(db, contextOf('procurement'), {
      changes: [{ positionId, field: 'orderedQty', value: 10 }],
    });
    const again = await applyBulkChanges(db, contextOf('procurement'), {
      changes: [{ positionId, field: 'orderedQty', value: '10' }],
    });

    assert.equal(again.applied, 0);
    assert.equal(again.already, 1, 'значение уже такое — это не ошибка');
    assert.equal(
      (await listAuditByOperation(db, again.operationId)).length,
      0,
      'шум от повторной вставки в журнал не пишется',
    );
  } finally {
    await db.close();
  }
});

test('право проверяется по каждому полю: снабженец не меняет крайний срок', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');

    const result = await applyBulkChanges(db, contextOf('procurement'), {
      changes: [
        { positionId, field: 'orderedQty', value: 7 },
        { positionId, field: 'deadline', value: '01.10.2026' },
      ],
    });

    assert.equal(result.applied, 1, 'разрешённое поле применено');
    assert.equal(result.blocked, 1, 'запрещённое поле отклонено, но не отменило остальные');
    const refused = result.results.find((item) => item.status === 'blocked');
    assert.match(refused?.reason ?? '', /Крайний срок/);

    const position = await findPositionByPositionId(db, positionId);
    assert.equal(position?.quantities.orderedQty, 7);
    assert.equal(position?.identity.deadline, '2026-09-20', 'крайний срок не тронут');
  } finally {
    await db.close();
  }
});

test('ячейка с мусором отклоняется, остальные применяются', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
      { code: 'CD-34', name: 'Конденсатор', model: 'C2', unit: 'шт', requiredQty: 4 },
    ]);
    const first = expectDefined(ids[0], 'первая позиция');
    const second = expectDefined(ids[1], 'вторая позиция');

    const result = await applyBulkChanges(db, contextOf('procurement'), {
      changes: [
        { positionId: first, field: 'orderedQty', value: '10' },
        { positionId: first, field: 'expectedDate', value: 'сентябрь' },
        { positionId: second, field: 'orderedQty', value: '3 шт' },
      ],
    });

    assert.equal(result.applied, 1);
    assert.equal(result.blocked, 2);
    const reasons = result.results
      .filter((item) => item.status === 'blocked')
      .map((item) => item.reason);
    assert.ok(reasons.some((reason) => /введите дату/.test(reason)));
    assert.ok(reasons.some((reason) => /неотрицательное число/.test(reason)));

    const position = await findPositionByPositionId(db, first);
    assert.equal(position?.quantities.orderedQty, 10);
    assert.equal(position?.expectedDate, null, 'неразобранная дата ничего не записала');
  } finally {
    await db.close();
  }
});

test('повтор ячейки в одной пачке: побеждает последнее значение', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');

    const result = await applyBulkChanges(db, contextOf('procurement'), {
      changes: [
        { positionId, field: 'orderedQty', value: '5' },
        { positionId, field: 'orderedQty', value: '9' },
      ],
    });

    assert.equal(result.results.length, 1, 'одна пара «позиция + поле» — один результат');
    assert.equal(result.applied, 1);
    const position = await findPositionByPositionId(db, positionId);
    assert.equal(position?.quantities.orderedQty, 9);
  } finally {
    await db.close();
  }
});

test('«Поставлено» меняет склад на дельту, а повтор не начисляет приход дважды', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');
    const materialKey = 'AB-12|Bosch';

    await applyBulkChanges(db, contextOf('economist'), {
      changes: [{ positionId, field: 'realDeliveryQty', value: 4 }],
    });
    assert.equal(await warehouseQtyOf(db, materialKey), 4);

    await applyBulkChanges(db, contextOf('economist'), {
      changes: [{ positionId, field: 'realDeliveryQty', value: 10 }],
    });
    assert.equal(await warehouseQtyOf(db, materialKey), 10, 'склад изменился на дельту');

    const again = await applyBulkChanges(db, contextOf('economist'), {
      changes: [{ positionId, field: 'realDeliveryQty', value: 10 }],
    });
    assert.equal(again.already, 1);
    assert.equal(await warehouseQtyOf(db, materialKey), 10, 'повтор приход не начислил');

    // Галочка «Поставлено» — та же операция: подставляется полный объём потребности.
    const checked = await applyBulkChanges(db, contextOf('economist'), {
      changes: [{ positionId, field: 'realDeliveryChecked', value: 'да' }],
    });
    assert.equal(checked.already, 1, 'объём уже был отмечен полностью');
  } finally {
    await db.close();
  }
});

test('пустой список и превышение лимита отклоняются с объяснением', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');

    await assert.rejects(
      () => applyBulkChanges(db, contextOf('procurement'), { changes: [] }),
      /Не выбрано ни одного изменения/,
    );

    const tooMany: BulkChangeInput[] = Array.from(
      { length: LIMITS.MAX_BULK_CHANGES + 1 },
      () => ({ positionId, field: 'orderedQty', value: 1 }),
    );
    await assert.rejects(
      () => applyBulkChanges(db, contextOf('procurement'), { changes: tooMany }),
      /Разделите вставку на части/,
    );
  } finally {
    await db.close();
  }
});

test('откат операции возвращает прежние значения и помечает записи своим действием', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');

    const applied = await applyBulkChanges(db, contextOf('procurement'), {
      changes: [
        { positionId, field: 'orderedQty', value: 10 },
        { positionId, field: 'expectedDate', value: '25.09.2026' },
      ],
    });
    assert.equal(applied.applied, 2);

    const rollback = await rollbackOperation(db, contextOf('procurement'), {
      operationId: applied.operationId,
      reason: 'ошиблись файлом',
    });

    assert.equal(rollback.applied, 2);
    assert.equal(rollback.blocked, 0);
    const position = await findPositionByPositionId(db, positionId);
    assert.equal(position?.quantities.orderedQty, 0, 'прежнее значение возвращено');
    assert.equal(position?.expectedDate, null);

    // Возврат — своя команда с своим действием: по журналу видно, что значение
    // вернули и по какой команде.
    const journal = await listAuditByOperation(db, rollback.operationId);
    assert.equal(journal.length, 2);
    assert.ok(journal.every((entry) => entry.action === 'OPERATION_ROLLBACK'));
    assert.notEqual(rollback.operationId, applied.operationId);
    assert.match(journal[0]?.reason ?? '', /ошиблись файлом/);
  } finally {
    await db.close();
  }
});

test('откат не затирает то, что изменили после операции', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');

    const firstOperation = await applyBulkChanges(db, contextOf('procurement'), {
      changes: [{ positionId, field: 'orderedQty', value: 10 }],
    });
    await applyBulkChanges(db, contextOf('procurement'), {
      changes: [{ positionId, field: 'orderedQty', value: 20 }],
    });

    const rollback = await rollbackOperation(db, contextOf('procurement'), {
      operationId: firstOperation.operationId,
      reason: 'передумали',
    });

    assert.equal(rollback.applied, 0);
    assert.equal(rollback.blocked, 1);
    assert.match(rollback.results[0]?.reason ?? '', /изменили после этой операции/);
    const position = await findPositionByPositionId(db, positionId);
    assert.equal(position?.quantities.orderedQty, 20, 'более поздняя правка сохранена');
  } finally {
    await db.close();
  }
});

test('запись журнала без правила возврата не откатывается', async () => {
  const db = await openDatabase();
  try {
    const ids = await seedBom(db, [
      { code: 'AB-12', name: 'Резистор', model: 'R1', unit: 'шт', requiredQty: 10 },
    ]);
    const positionId = expectDefined(ids[0], 'позиция');

    // Передача производству: откат требует работы с архивом и складом, поэтому
    // такая запись обязана получить отказ, а не «похожий» возврат.
    await db.execute(
      `insert into audit_log (
         operation_id, actor, action, bom_id, position_id, field, old_value, new_value, reason
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, '')`,
      ['handoff-operation', 'user', 'PRODUCTION_HANDOFF', BOM_CODE, positionId, 'RECEIVED_BY_PRODUCTION', 'нет', 'да'],
    );

    const rollback = await rollbackOperation(db, contextOf('production'), {
      operationId: 'handoff-operation',
      reason: 'вернуть в работу',
    });

    assert.equal(rollback.applied, 0);
    assert.equal(rollback.blocked, 1);
    assert.match(rollback.results[0]?.reason ?? '', /нет правила/);
  } finally {
    await db.close();
  }
});
