/**
 * Проверки прав доступа — перенос матрицы прав прежней системы.
 *
 * Матрица — «кто что может править». Любая ошибка здесь означает либо потерю
 * доступа у роли (пользователь не может работать), либо лишние права
 * (роль может испортить чужие данные), поэтому проверяются обе стороны.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PERMISSION_LABEL } from '../src/domain/constants.js';
import {
  PermissionDeniedError,
  can,
  describeAccess,
  permissionsOf,
  requirePermission,
} from '../src/domain/permissions.js';
import type { Role } from '../src/domain/types.js';

test('матрица прав: снабженец правит заказ, но не склад', () => {
  assert.equal(can('procurement', 'ORDERED_QTY'), true);
  assert.equal(can('procurement', 'EXPECTED_DATE'), true);
  assert.equal(can('procurement', 'WAREHOUSE_QTY'), false);
  assert.equal(can('procurement', 'REAL_DELIVERY'), false, 'поставку отмечает экономист');
  assert.equal(can('procurement', 'ORDERED_QTY'), true);
});

test('матрица прав: экономист отмечает поставку и ведёт спецификации', () => {
  assert.equal(can('economist', 'REAL_DELIVERY'), true);
  assert.equal(can('economist', 'SOURCE_BOM_WRITE'), true);
  assert.equal(can('economist', 'DEADLINE'), true);
  assert.equal(can('economist', 'ORDERED_QTY'), false);
  assert.equal(can('economist', 'PICKING_CHECKBOX'), false);
});

test('матрица прав: кладовщик ведёт склад и передаёт материал', () => {
  assert.equal(can('warehouse', 'WAREHOUSE_QTY'), true);
  assert.equal(can('warehouse', 'PICKING_CHECKBOX'), true);
  assert.equal(can('warehouse', 'DASHBOARD_CHECKBOX'), false, 'выполнено отмечает производство');
  assert.equal(can('warehouse', 'REAL_DELIVERY'), false);
});

test('матрица прав: производство отмечает передачу и завершение проекта', () => {
  assert.equal(can('production', 'PICKING_CHECKBOX'), true);
  assert.equal(can('production', 'WORKING_BOM_CHECKBOX'), true);
  assert.equal(can('production', 'DASHBOARD_CHECKBOX'), true);
  assert.equal(can('production', 'ORDERED_QTY'), false);
});

test('матрица прав: администратор может всё, наблюдатель — ничего', () => {
  (Object.keys(PERMISSION_LABEL) as Array<keyof typeof PERMISSION_LABEL>).forEach((action) => {
    assert.equal(can('admin', action), true, `админ должен иметь право ${action}`);
    assert.equal(can('viewer', action), false, `наблюдатель не должен иметь право ${action}`);
  });
});

test('requirePermission бросает понятную ошибку', () => {
  assert.throws(
    () => requirePermission('viewer', 'ORDERED_QTY'),
    (error: unknown) => {
      if (!(error instanceof PermissionDeniedError)) {
        return false;
      }
      assert.equal(error.role, 'viewer');
      assert.equal(error.action, 'ORDERED_QTY');
      assert.match(error.message, /Недостаточно прав/);
      return true;
    },
  );
  assert.doesNotThrow(() => requirePermission('admin', 'ORDERED_QTY'));
});

test('permissionsOf и describeAccess дают полный список прав роли', () => {
  const warehouse = permissionsOf('warehouse');
  assert.deepEqual(warehouse.sort(), ['PICKING_CHECKBOX', 'WAREHOUSE_QTY']);

  const admin = permissionsOf('admin');
  assert.equal(admin.length, Object.keys(PERMISSION_LABEL).length, 'у админа перечислены все права');

  const description = describeAccess('economist');
  assert.equal(description.role, 'economist');
  assert.equal(description.roleLabel, 'Экономист');
  assert.ok(description.allowed.every((entry) => entry.label.length > 0));
});

test('неизвестная роль не получает прав', () => {
  assert.equal(can('unknown-role' as Role, 'ORDERED_QTY'), false);
  assert.deepEqual(permissionsOf('unknown-role' as Role), []);
});
