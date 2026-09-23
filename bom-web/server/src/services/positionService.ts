/**
 * Операции снабжения по позиции (порт `v12SetOrderedQty`, `v12SetExpectedDate`,
 * `v12SetRealDeliveryQty` из `v12_operations.js`).
 *
 * Что сохранено дословно:
 *   * «Заказано» и «Ожидаемая дата» на склад НЕ влияют;
 *   * «Реальная поставка» меняет склад на разницу (приход увеличивает остаток,
 *     отмена — уменьшает), а дата поставки ставится при первой положительной
 *     отметке и сбрасывается, когда количество обнуляют;
 *   * повторная установка того же значения ничего не меняет и не пишет в журнал
 *     (ответ «уже так» вместо «применено») — иначе журнал заполнялся бы шумом от
 *     двойных щелчков.
 *
 * Каждая операция выполняется в транзакции вместе со своими записями журнала и
 * истории: состояние и след правки появляются одновременно.
 */

import type { Database } from '../db/Database.js';
import { COLORS } from '../domain/constants.js';
import { requirePermission } from '../domain/permissions.js';
import { type Position } from '../domain/position.js';
import { deficitStatus, procurementOutcome } from '../domain/procurement.js';
import {
  describeKeyNote,
  isSpecField,
  normalizeSpecField,
  SPEC_FIELD_LABEL,
  type SpecField,
} from '../domain/specFields.js';
import { isChecked, toIsoDate, toQty } from '../domain/values.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { adjustWarehouseQty } from '../repositories/materials.js';
import {
  findPositionByPositionId,
  updateOperatingFields,
  updatePositionSpec,
  type PositionSpec,
} from '../repositories/positions.js';
import {
  AUDIT_ACTION,
  HISTORY_EVENT,
  recordChanges,
  type OperationContext,
} from './operationLog.js';

/** Результат операции по позиции. */
export interface OperationResult {
  status: 'applied' | 'already' | 'blocked';
  reason?: string;
  /**
   * Пояснение к применённому изменению (не отказ): показывается пользователю
   * после успеха, когда последствие правки неочевидно — например, ключ материала
   * остался прежним, хотя описание изменилось.
   */
  notice?: string;
  /** Актуальное состояние позиции после операции (для обновления строки). */
  position?: Position;
}

/** Данные материала позиции для записи на склад. */
function materialIdentity(position: Position) {
  return {
    code: position.identity.code,
    manufacturer: position.identity.manufacturer,
    name: position.identity.name,
    model: position.identity.model,
    unit: position.identity.unit,
  };
}

/** Загрузить позицию или объяснить, почему её нет. */
async function loadPosition(
  db: Database,
  positionId: string,
): Promise<{ position: Position } | { failure: OperationResult }> {
  const position = await findPositionByPositionId(db, positionId);
  if (!position) {
    return {
      failure: { status: 'blocked', reason: `Позиция не найдена: ${positionId}` },
    };
  }
  if (position.lifecycle === 'REMOVED') {
    return {
      failure: { status: 'blocked', reason: 'Позиция удалена из спецификации' },
    };
  }
  return { position };
}

/** Итог операции вместе с обновлённым состоянием позиции. */
async function finish(
  db: Database,
  positionId: string,
): Promise<OperationResult> {
  const position = await findPositionByPositionId(db, positionId);
  return { status: 'applied', position: position ?? undefined };
}

/**
 * Установить количество заказа (абсолютное значение, 0 — снять заказ).
 *
 * Право: «Заказано» в сводке дефицитов (снабженец, администратор).
 */
export async function setOrderedQty(
  db: Database,
  ctx: OperationContext,
  params: { positionId: string; qty: number },
): Promise<OperationResult> {
  requirePermission(ctx.role, 'ORDERED_QTY');
  const loaded = await loadPosition(db, params.positionId);
  if ('failure' in loaded) {
    return loaded.failure;
  }
  const { position } = loaded;

  const nextQty = toQty(params.qty);
  const previousQty = position.quantities.orderedQty;
  if (previousQty === nextQty) {
    return { status: 'already', position };
  }

  await db.transaction(async (tx) => {
    await updateOperatingFields(tx, position.positionId, { orderedQty: nextQty });
    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.ORDERED_QTY,
        bomId: position.bomId,
        positionId: position.positionId,
        field: 'ORDERED_QTY',
        oldValue: previousQty,
        newValue: nextQty,
        historyEvent: HISTORY_EVENT.ORDERED_QTY,
      },
    ]);
  });
  return finish(db, position.positionId);
}

/**
 * Установить ожидаемую дату поставки (пустое значение очищает).
 *
 * Право: «Ожидаемая поставка» в сводке дефицитов.
 */
export async function setExpectedDate(
  db: Database,
  ctx: OperationContext,
  params: { positionId: string; expectedDate: string | null },
): Promise<OperationResult> {
  requirePermission(ctx.role, 'EXPECTED_DATE');
  const loaded = await loadPosition(db, params.positionId);
  if ('failure' in loaded) {
    return loaded.failure;
  }
  const { position } = loaded;

  const nextDate = params.expectedDate ? toIsoDate(params.expectedDate) : null;
  if (params.expectedDate && !nextDate) {
    throw new ValidationError('Не удалось разобрать дату ожидаемой поставки');
  }
  if (position.expectedDate === nextDate) {
    return { status: 'already', position };
  }

  await db.transaction(async (tx) => {
    await updateOperatingFields(tx, position.positionId, { expectedDate: nextDate });
    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.EXPECTED_DATE,
        bomId: position.bomId,
        positionId: position.positionId,
        field: 'EXPECTED_DATE',
        oldValue: position.expectedDate,
        newValue: nextDate,
        historyEvent: HISTORY_EVENT.EXPECTED_DATE,
      },
    ]);
  });
  return finish(db, position.positionId);
}

/**
 * Зафиксировать реальную поставку количеством (0 — отмена поставки).
 *
 * Приход попадает на склад: остаток меняется на разницу между новым и прежним
 * количеством. Дата поставки ставится при первой положительной отметке и
 * сбрасывается при обнулении.
 *
 * Право: «Реальная поставка» (экономист, администратор).
 */
export async function setRealDeliveryQty(
  db: Database,
  ctx: OperationContext,
  params: { positionId: string; qty: number },
): Promise<OperationResult> {
  requirePermission(ctx.role, 'REAL_DELIVERY');
  const loaded = await loadPosition(db, params.positionId);
  if ('failure' in loaded) {
    return loaded.failure;
  }
  const { position } = loaded;

  const nextQty = toQty(params.qty);
  const previousQty = position.quantities.realDeliveryQty;
  if (previousQty === nextQty) {
    return { status: 'already', position };
  }

  const delta = nextQty - previousQty;
  const today = new Date().toISOString().slice(0, 10);
  const nextDate = nextQty > 0 ? position.realDeliveryDate ?? today : null;

  await db.transaction(async (tx) => {
    await updateOperatingFields(tx, position.positionId, {
      realDeliveryQty: nextQty,
      realDeliveryDate: nextDate,
    });
    if (delta !== 0) {
      await adjustWarehouseQty(tx, position.materialKey, delta, materialIdentity(position));
    }
    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.REAL_DELIVERY,
        bomId: position.bomId,
        positionId: position.positionId,
        field: 'REAL_DELIVERY_QTY',
        oldValue: previousQty,
        newValue: nextQty,
        historyEvent: HISTORY_EVENT.REAL_DELIVERY,
        reason: `${nextDate ? `Дата поставки: ${nextDate}. ` : ''}Склад изменён на ${delta}`,
      },
    ]);
  });
  return finish(db, position.positionId);
}

/**
 * Отметить «Реальную поставку» галочкой: приход в полном объёме потребности.
 *
 * Это тот же путь, что и ввод количества, — галочка лишь подставляет количество
 * и снимает его при выключении.
 */
export async function setRealDeliveryChecked(
  db: Database,
  ctx: OperationContext,
  params: { positionId: string; checked: boolean },
): Promise<OperationResult> {
  const loaded = await loadPosition(db, params.positionId);
  if ('failure' in loaded) {
    return loaded.failure;
  }
  const target = isChecked(params.checked) ? loaded.position.quantities.requiredQty : 0;
  return setRealDeliveryQty(db, ctx, { positionId: params.positionId, qty: target });
}

/**
 * Изменить крайний срок поставки (часть спецификации).
 *
 * Право: «Крайний срок поставки» — только экономист и администратор: срок влияет
 * на оценку «в срок / опаздывает» по всем ролям, поэтому его правка выделена
 * отдельно.
 */
export async function setDeadline(
  db: Database,
  ctx: OperationContext,
  params: { positionId: string; deadline: string | null },
): Promise<OperationResult> {
  requirePermission(ctx.role, 'DEADLINE');
  const loaded = await loadPosition(db, params.positionId);
  if ('failure' in loaded) {
    return loaded.failure;
  }
  const { position } = loaded;

  const nextDeadline = params.deadline ? toIsoDate(params.deadline) : null;
  if (!nextDeadline) {
    throw new ValidationError('Крайний срок обязателен: укажите дату в формате ДД.ММ.ГГГГ');
  }
  if (position.identity.deadline === nextDeadline) {
    return { status: 'already', position };
  }

  await db.transaction(async (tx) => {
    await updatePositionSpec(tx, position.positionId, {
      rowNo: position.identity.rowNo,
      code: position.identity.code,
      manufacturer: position.identity.manufacturer,
      name: position.identity.name,
      model: position.identity.model,
      unit: position.identity.unit,
      requiredQty: position.quantities.requiredQty,
      reservedQty: position.quantities.reservedQty,
      deadline: nextDeadline,
    });
    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.DEADLINE,
        bomId: position.bomId,
        positionId: position.positionId,
        field: 'DEADLINE',
        oldValue: position.identity.deadline,
        newValue: nextDeadline,
        historyEvent: HISTORY_EVENT.DEADLINE,
      },
    ]);
  });
  return finish(db, position.positionId);
}

/** Значение поля спецификации в текущем состоянии позиции. */
function currentSpecValue(position: Position, field: SpecField): string | number | null {
  switch (field) {
    case 'rowNo':
      return position.identity.rowNo;
    case 'code':
      return position.identity.code;
    case 'manufacturer':
      return position.identity.manufacturer;
    case 'name':
      return position.identity.name;
    case 'model':
      return position.identity.model;
    case 'unit':
      return position.identity.unit;
    case 'requiredQty':
      return position.quantities.requiredQty;
    case 'reservedQty':
      return position.quantities.reservedQty;
    case 'deadline':
      return position.identity.deadline;
  }
}

/**
 * Поля спецификации с одним изменённым значением.
 *
 * Ключ материала здесь НЕ пересчитывается: `updatePositionSpec` пишет только
 * описательные поля, а `material_key` и `position_id` остаются прежними. Так
 * правка описания не отвязывает позицию от склада, архива и истории.
 */
function specWithField(
  position: Position,
  field: SpecField,
  value: string | number | null,
): PositionSpec {
  const spec: PositionSpec = {
    rowNo: position.identity.rowNo,
    code: position.identity.code,
    manufacturer: position.identity.manufacturer,
    name: position.identity.name,
    model: position.identity.model,
    unit: position.identity.unit,
    requiredQty: position.quantities.requiredQty,
    reservedQty: position.quantities.reservedQty,
    deadline: position.identity.deadline,
  };
  switch (field) {
    case 'rowNo':
      return { ...spec, rowNo: Number(value) };
    case 'code':
      return { ...spec, code: String(value ?? '') };
    case 'manufacturer':
      return { ...spec, manufacturer: String(value ?? '') };
    case 'name':
      return { ...spec, name: String(value ?? '') };
    case 'model':
      return { ...spec, model: String(value ?? '') };
    case 'unit':
      return { ...spec, unit: String(value ?? '') };
    case 'requiredQty':
      return { ...spec, requiredQty: Number(value) };
    case 'reservedQty':
      return { ...spec, reservedQty: Number(value) };
    case 'deadline':
      return { ...spec, deadline: value === null ? null : String(value) };
  }
}

/**
 * Исправить поле спецификации после импорта.
 *
 * Зачем отдельная операция: импорт СОЗНАТЕЛЬНО сохраняет строки с пустыми
 * обязательными полями (иначе дефицит по ним исчез бы из отчётов), но исправить
 * их через интерфейс было нечем — позиция оставалась «Ошибкой данных» до
 * следующей выгрузки файла. Здесь это исправление и живёт.
 *
 * Правила:
 *   * право — `SOURCE_BOM_WRITE` (экономист и администратор): тот, кто отвечает
 *     за исходную спецификацию, тот её и правит;
 *   * проверяется только правимое поле: строка может чиниться по шагам, и
 *     промежуточное состояние «часть полей пуста» допустимо;
 *   * операционные данные (заказано, ожидаемая поставка, поставка, передача) не
 *     затрагиваются: `updatePositionSpec` пишет только поля спецификации;
 *   * ключ материала не пересчитывается — если правка его касается, пользователь
 *     получает пояснение (`notice`), а не молчаливое расхождение с файлом.
 */
export async function setSpecField(
  db: Database,
  ctx: OperationContext,
  params: { positionId: string; field: string; value: unknown },
): Promise<OperationResult> {
  requirePermission(ctx.role, 'SOURCE_BOM_WRITE');

  if (!isSpecField(params.field)) {
    throw new ValidationError(`Неизвестное поле спецификации: ${params.field}`);
  }
  const field = params.field;

  const loaded = await loadPosition(db, params.positionId);
  if ('failure' in loaded) {
    return loaded.failure;
  }
  const { position } = loaded;

  const checked = normalizeSpecField(field, params.value);
  if (!checked.ok) {
    throw new ValidationError(checked.error);
  }
  const nextValue = checked.value;

  const previousValue = currentSpecValue(position, field);
  if (previousValue === nextValue) {
    return { status: 'already', position };
  }

  const nextSpec = specWithField(position, field, nextValue);
  const notice = describeKeyNote({
    field,
    currentKey: position.materialKey,
    nextIdentity: nextSpec,
  });

  await db.transaction(async (tx) => {
    await updatePositionSpec(tx, position.positionId, nextSpec);
    await recordChanges(tx, ctx, [
      {
        action: AUDIT_ACTION.SPEC_FIELD,
        bomId: position.bomId,
        positionId: position.positionId,
        field: `SPEC.${field.toUpperCase()}`,
        oldValue: previousValue,
        newValue: nextValue,
        historyEvent: HISTORY_EVENT.SPEC_FIELD,
        reason: `Правка спецификации после импорта: «${SPEC_FIELD_LABEL[field]}»`,
      },
    ]);
  });

  const result = await finish(db, position.positionId);
  return notice ? { ...result, notice } : result;
}

/** Строка состояния позиции для карточки материала. */
export interface PositionDetail {
  position: Position;
  /** Текст статуса снабжения, привычный пользователям. */
  statusText: string;
  statusColor: string;
  outcome: string;
}

/**
 * Карточка позиции: данные, статус снабжения и цвет — как в сводке дефицитов.
 *
 * `loadPosition` недоступен снаружи, поэтому карточка строится здесь: иначе
 * интерфейс собирал бы статус самостоятельно и мог разойтись с проекциями.
 */
export async function getPositionDetail(
  db: Database,
  positionId: string,
): Promise<PositionDetail> {
  const position = await findPositionByPositionId(db, positionId);
  if (!position) {
    throw new NotFoundError(`Позиция не найдена: ${positionId}`);
  }
  const status = deficitStatus(
    {
      orderedQty: position.quantities.orderedQty,
      deficitQty: position.computed.deficitQty,
      expectedDate: position.expectedDate,
      deadline: position.identity.deadline,
    },
    position.computed.valid,
  );
  const outcome = procurementOutcome({
    orderedQty: position.quantities.orderedQty,
    deficitQty: position.computed.deficitQty,
    expectedDate: position.expectedDate,
    deadline: position.identity.deadline,
  });
  return {
    position,
    statusText: status.text,
    statusColor: status.color ?? COLORS.WHITE,
    outcome,
  };
}
