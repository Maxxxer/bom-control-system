/**
 * Проверки правил массовой правки: какие поля доступны, каким правом это
 * разрешено и как приводится значение, вставленное из Excel.
 *
 * Почему это отдельные проверки, а не часть теста сервиса. Здесь живут ровно те
 * решения, из-за которых вставка блока или работает, или тихо портит данные:
 *   * мусор в количестве обязан стать ОТКАЗОМ, а не нулём — снабженец не должен
 *     узнать об опечатке только по нулю в отчёте;
 *   * пустая ячейка — это «ноль» для количества и «снять дату» для ожидаемой даты,
 *     но для крайнего срока это отказ (он обязателен);
 *   * у каждого поля своё право: крайний срок меняет только экономист, «Поставлено»
 *     — только он же, «Заказано» — снабженец.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  auditFieldToBulkField,
  BULK_FIELD_LABEL,
  bulkPermission,
  isBulkField,
  isOperatingBulkField,
  normalizeBulkValue,
} from '../src/domain/bulkFields.js';
import { EDITABLE_SPEC_FIELDS } from '../src/domain/specFields.js';

/** Разобрать значение или упасть с понятным сообщением. */
function valueOf(field: Parameters<typeof normalizeBulkValue>[0], value: unknown): unknown {
  const checked = normalizeBulkValue(field, value);
  assert.equal(checked.ok, true, `значение «${String(value)}» должно приниматься`);
  return checked.ok ? checked.value : null;
}

/** Проверить, что значение отклонено, и вернуть текст причины. */
function errorOf(field: Parameters<typeof normalizeBulkValue>[0], value: unknown): string {
  const checked = normalizeBulkValue(field, value);
  assert.equal(checked.ok, false, `значение «${String(value)}» должно быть отклонено`);
  return checked.ok ? '' : checked.error;
}

test('поля массовой правки: операционные и все поля спецификации', () => {
  assert.equal(isBulkField('orderedQty'), true);
  assert.equal(isBulkField('expectedDate'), true);
  assert.equal(isBulkField('realDeliveryQty'), true);
  assert.equal(isBulkField('realDeliveryChecked'), true);
  for (const field of EDITABLE_SPEC_FIELDS) {
    assert.equal(isBulkField(field), true, `поле спецификации «${field}» доступно правке`);
  }

  // Передача производству и её отметки — не «поле»: у неё своя операция и свой экран.
  assert.equal(isBulkField('received'), false);
  assert.equal(isBulkField('lifecycle'), false);
  assert.equal(isBulkField(''), false);
  assert.equal(isBulkField(undefined), false);

  assert.equal(isOperatingBulkField('orderedQty'), true);
  assert.equal(isOperatingBulkField('model'), false);
});

test('каждому полю соответствует своё право', () => {
  assert.equal(bulkPermission('orderedQty'), 'ORDERED_QTY');
  assert.equal(bulkPermission('expectedDate'), 'EXPECTED_DATE');
  assert.equal(bulkPermission('realDeliveryQty'), 'REAL_DELIVERY');
  assert.equal(bulkPermission('realDeliveryChecked'), 'REAL_DELIVERY');
  // Крайний срок влияет на оценку «в срок / опаздывает» по всем ролям, поэтому у
  // него собственное право, а не общее право правки спецификации.
  assert.equal(bulkPermission('deadline'), 'DEADLINE');
  assert.equal(bulkPermission('model'), 'SOURCE_BOM_WRITE');
  assert.equal(bulkPermission('requiredQty'), 'SOURCE_BOM_WRITE');
});

test('количество разбирается из форматов Excel, а мусор отклоняется', () => {
  assert.equal(valueOf('orderedQty', '10'), 10);
  assert.equal(valueOf('orderedQty', 10), 10);
  assert.equal(valueOf('orderedQty', '2,5'), 2.5);
  assert.equal(valueOf('orderedQty', '1 234,5'), 1234.5, 'пробел как разделитель разрядов');
  assert.equal(valueOf('orderedQty', '  7  '), 7);
  assert.equal(valueOf('orderedQty', ''), 0, 'пустая ячейка — ноль');

  // Мусор обязан стать отказом: `toQty` превратил бы его в ноль молча.
  assert.match(errorOf('orderedQty', 'abc'), /неотрицательное число/);
  assert.match(errorOf('orderedQty', '-5'), /неотрицательное число/);
  assert.match(errorOf('orderedQty', '10 шт'), /неотрицательное число/);
});

test('ожидаемая дата: пусто — «снять», иначе ДД.ММ.ГГГГ или ISO', () => {
  assert.equal(valueOf('expectedDate', '20.09.2026'), '2026-09-20');
  assert.equal(valueOf('expectedDate', '2026-09-20'), '2026-09-20');
  assert.equal(valueOf('expectedDate', ''), null);
  assert.equal(valueOf('expectedDate', null), null);
  assert.match(errorOf('expectedDate', 'сентябрь'), /введите дату/);
});

test('серийная дата Excel приводится к календарной', () => {
  // Excel копирует дату номером дня от 1899-12-30; серверная нормализация его
  // понимает, поэтому вставка «как есть» из таблицы не теряет дату.
  const fromSerial = valueOf('expectedDate', 45123);
  assert.match(String(fromSerial), /^2023-07-1[4-7]$/);
});

test('отметка «Поставлено» понимает «да», «1» и «TRUE»', () => {
  assert.equal(valueOf('realDeliveryChecked', 'да'), true);
  assert.equal(valueOf('realDeliveryChecked', '1'), true);
  assert.equal(valueOf('realDeliveryChecked', 'TRUE'), true);
  assert.equal(valueOf('realDeliveryChecked', ''), false);
  assert.equal(valueOf('realDeliveryChecked', 'нет'), false);
  assert.equal(valueOf('realDeliveryChecked', '0'), false);
});

test('поля спецификации проверяются теми же правилами, что одиночная правка', () => {
  assert.equal(valueOf('model', '  R-1  '), 'R-1');
  assert.equal(valueOf('name', 'Резистор'), 'Резистор');
  assert.equal(valueOf('code', ' '), '', 'артикул необязателен');
  assert.equal(valueOf('requiredQty', '2,5'), 2.5);
  assert.equal(valueOf('reservedQty', '0'), 0);
  assert.equal(valueOf('deadline', '20.09.2026'), '2026-09-20');
  assert.equal(valueOf('rowNo', '3'), 3);

  assert.match(errorOf('model', ''), /обязательно/);
  assert.match(errorOf('requiredQty', ''), /больше 0/);
  // Резерв может быть нулевым, но не «мусором»: иначе опечатка станет нулём.
  assert.match(errorOf('reservedQty', 'мусор'), /неотрицательное число/);
  assert.match(errorOf('rowNo', '0'), /положительный номер строки/);
  // Крайний срок обязателен: очистить его вставкой нельзя — это отказ.
  assert.match(errorOf('deadline', ''), /введите дату/);
});

test('имена полей журнала отображаются на поля правки', () => {
  assert.equal(auditFieldToBulkField('ORDERED_QTY'), 'orderedQty');
  assert.equal(auditFieldToBulkField('EXPECTED_DATE'), 'expectedDate');
  assert.equal(auditFieldToBulkField('REAL_DELIVERY_QTY'), 'realDeliveryQty');
  assert.equal(auditFieldToBulkField('DEADLINE'), 'deadline');
  assert.equal(auditFieldToBulkField('SPEC.MODEL'), 'model');
  assert.equal(auditFieldToBulkField('SPEC.REQUIREDQTY'), 'requiredQty');
  assert.equal(auditFieldToBulkField('SPEC.RESERVEDQTY'), 'reservedQty');

  // Для этих записей правила возврата нет — откат обязан честно отказать,
  // а не «вернуть» что-то похожее.
  assert.equal(auditFieldToBulkField('RECEIVED_BY_PRODUCTION'), null);
  assert.equal(auditFieldToBulkField('WAREHOUSE_QTY'), null);
  assert.equal(auditFieldToBulkField('Выполнено'), null);
  assert.equal(auditFieldToBulkField(''), null);
  assert.equal(auditFieldToBulkField('SPEC.UNKNOWN'), null);
});

test('подписи полей совпадают с теми, что видит пользователь', () => {
  assert.equal(BULK_FIELD_LABEL.orderedQty, 'Заказано');
  assert.equal(BULK_FIELD_LABEL.expectedDate, 'Ожидаемая поставка');
  assert.equal(BULK_FIELD_LABEL.realDeliveryChecked, 'Отметка «Поставлено»');
  assert.equal(BULK_FIELD_LABEL.deadline, 'Крайний срок поставки');
  assert.equal(BULK_FIELD_LABEL.model, 'Модель');
});
