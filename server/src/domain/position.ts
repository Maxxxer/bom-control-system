/**
 * Сущность «Позиция спецификации» и её производные значения.
 *
 * Позиция хранит только ВХОДНЫЕ данные (описательные поля из BOM и количества,
 * которые меняют роли). Всё остальное — дефицит, состояния, доступность — это
 * `computed`: результат чистого расчёта, который никогда не вводится вручную.
 */

import { calculatePositionState } from './calculate.js';
import { LIFECYCLE_STATE } from './constants.js';
import { buildMaterialKey, type MaterialParts } from './materialKeys.js';
import type {
  CalculationResult,
  LifecycleState,
  PositionIdentity,
  PositionQuantities,
} from './types.js';

/** Позиция: хранимые поля плюс результат расчёта. */
export interface Position {
  /** Первичный ключ в базе (внутренний, интерфейсу не показывается). */
  id: number;
  /** Стабильный идентификатор позиции: `BOM ID:ключ материала` (+ `#N`). */
  positionId: string;
  bomId: string;
  bomName: string;
  materialKey: string;
  identity: PositionIdentity;
  quantities: PositionQuantities;
  /** Ожидаемая дата поставки — вводит снабженец (ISO либо null). */
  expectedDate: string | null;
  /** Дата фактического прихода (первая положительная отметка), ISO. */
  realDeliveryDate: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  lifecycle: LifecycleState;
  updatedAt: string;
  /** Производные значения: пересчитываются, не хранятся как истина. */
  computed: CalculationResult;
}

/** Пересчитать производные значения позиции (возвращает копию). */
export function applyComputed(position: Position): Position {
  const computed = calculatePositionState({
    ...position.quantities,
    identity: position.identity,
  });
  return { ...position, computed };
}

/** Части материала для построения ключа склада. */
export function materialPartsOf(position: Position): MaterialParts {
  return {
    code: position.identity.code,
    manufacturer: position.identity.manufacturer,
    name: position.identity.name,
    model: position.identity.model,
    unit: position.identity.unit,
  };
}

/** Ключ склада позиции (тот же, что хранится в MATERIAL_STATE). */
export function materialKeyOf(position: Position): string {
  return buildMaterialKey(materialPartsOf(position));
}

/** Позиция активна (её видит производство и учитывают проекции). */
export function isActive(position: Position): boolean {
  return position.lifecycle === LIFECYCLE_STATE.ACTIVE;
}

/** Позиция передана производству. */
export function isReceived(position: Position): boolean {
  return position.quantities.received;
}

/** Позиция видна в сводке дефицитов (нужен заказ и нет полного обеспечения). */
export function isDeficitVisible(position: Position): boolean {
  if (!isActive(position) || isReceived(position)) {
    return false;
  }
  const available =
    position.quantities.reservedQty + position.quantities.realDeliveryQty;
  if (available >= position.quantities.requiredQty) {
    return false;
  }
  return position.computed.deficitQty > 0;
}

/** Позиция входит в снабжение (дефицит ещё не закрыт заказом и поставкой). */
export function isSupplyVisible(position: Position): boolean {
  if (!isActive(position)) {
    return false;
  }
  if (position.computed.deficitQty <= 0) {
    return false;
  }
  const available =
    position.quantities.reservedQty + position.quantities.realDeliveryQty;
  return available < position.quantities.requiredQty;
}

/** Создать «пустую» позицию (используется тестами и построителями). */
export function createPosition(
  overrides: Partial<Omit<Position, 'computed'>> & { positionId: string; bomId: string },
): Position {
  const base: Position = {
    id: overrides.id ?? 0,
    positionId: overrides.positionId,
    bomId: overrides.bomId,
    bomName: overrides.bomName ?? overrides.bomId,
    materialKey: overrides.materialKey ?? '',
    identity: overrides.identity ?? {
      rowNo: 1,
      code: '',
      manufacturer: '',
      name: '',
      model: '',
      unit: '',
      deadline: null,
    },
    quantities: overrides.quantities ?? {
      requiredQty: 0,
      reservedQty: 0,
      orderedQty: 0,
      realDeliveryQty: 0,
      receivedQty: 0,
      received: false,
    },
    expectedDate: overrides.expectedDate ?? null,
    realDeliveryDate: overrides.realDeliveryDate ?? null,
    receivedAt: overrides.receivedAt ?? null,
    receivedBy: overrides.receivedBy ?? null,
    lifecycle: overrides.lifecycle ?? LIFECYCLE_STATE.ACTIVE,
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    computed: {
      deficitQty: 0,
      uncoveredNeed: 0,
      overOrderedQty: 0,
      shortDeliveryQty: 0,
      availableForProduction: 0,
      readyForHandoff: false,
      supplyState: 'NO_REQUIREMENT',
      productionState: 'NOT_AVAILABLE',
      flags: [],
      valid: false,
      missing: {
        rowNo: true,
        name: true,
        model: true,
        unit: true,
        requiredQty: true,
        deadline: true,
      },
    },
  };
  return applyComputed(base);
}
