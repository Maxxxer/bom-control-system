/**
 * Общие построители для тестов: позиция спецификации и BOM-подобные данные.
 *
 * Помощник собирает валидную по умолчанию позицию, чтобы каждая проверка
 * задавала только то поле, которое действительно проверяет.
 */

import { applyComputed, type Position } from '../src/domain/position.js';
import type { PositionIdentity, PositionQuantities } from '../src/domain/types.js';

/** Поля, которые тест может переопределить. */
export interface PositionOverrides {
  positionId?: string;
  bomId?: string;
  bomName?: string;
  materialKey?: string;
  identity?: Partial<PositionIdentity>;
  quantities?: Partial<PositionQuantities>;
  expectedDate?: string | null;
  realDeliveryDate?: string | null;
  receivedAt?: string | null;
  receivedBy?: string | null;
  lifecycle?: Position['lifecycle'];
}

/** Собрать позицию с разумными значениями по умолчанию. */
export function makePosition(overrides: PositionOverrides = {}): Position {
  const bomId = overrides.bomId ?? '1234.АБВ-5678 Щит';
  const identity: PositionIdentity = {
    rowNo: 1,
    code: 'AB-12',
    manufacturer: 'Bosch',
    name: 'Резистор',
    model: 'R1',
    unit: 'шт',
    deadline: '2026-09-20',
    ...overrides.identity,
  };
  const quantities: PositionQuantities = {
    requiredQty: 10,
    reservedQty: 0,
    orderedQty: 0,
    realDeliveryQty: 0,
    receivedQty: 0,
    received: false,
    ...overrides.quantities,
  };
  const materialKey = overrides.materialKey ?? `${identity.code}|${identity.manufacturer}`;

  return applyComputed({
    id: 0,
    positionId: overrides.positionId ?? `${bomId}:${materialKey}`,
    bomId,
    bomName: overrides.bomName ?? bomId,
    materialKey,
    identity,
    quantities,
    expectedDate: overrides.expectedDate ?? null,
    realDeliveryDate: overrides.realDeliveryDate ?? null,
    receivedAt: overrides.receivedAt ?? null,
    receivedBy: overrides.receivedBy ?? null,
    lifecycle: overrides.lifecycle ?? 'ACTIVE',
    updatedAt: '2026-09-20T10:00:00.000Z',
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
  });
}
/**
 * Достать значение, которого тест ожидает обязательно.
 *
 * Нужен потому, что поиск по карте/массиву в типах возвращает `| undefined`, а
 * тест проверяет именно найденное значение: помощник делает проверку явной и
 * заодно убирает необязательность для компилятора.
 */
export function expectDefined<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
