/**
 * Передача материала производству и возврат из архива (порт
 * `v12MarkReceivedByProduction`, `v12ReturnFromArchive` из `v12_handoff.js`).
 *
 * Правила, которые сохраняются дословно:
 *   * передать можно только ВАЛИДНУЮ позицию и только при полной доступности
 *     (`доступно >= потребность`). Частичная передача запрещена — иначе материал
 *     уходил бы в производство кусками и учёт дефицита терял бы смысл;
 *   * передача идемпотентна: повторная отметка уже переданной позиции ничего не
 *     меняет и отвечает «уже передано»;
 *   * передача снимает материал с физического склада (резерв уходит в
 *     производство), возврат — ставит его обратно;
 *   * передача архивирует позицию (жизненный цикл «в производстве»), возврат
 *     делает её снова активной и требует причину.
 *
 * Передача сразу нескольких позиций выполняется ОДНОЙ командой: общий
 * идентификатор операции, одна транзакция и одно сообщение в журнале на каждую
 * позицию — так видно, что это результат одного нажатия «Передать» на диапазоне.
 */

import type { Database } from '../db/Database.js';
import { LIFECYCLE_STATE, SOURCE_UI } from '../domain/constants.js';
import { PRODUCTION_STATE } from '../domain/constants.js';
import { requirePermission } from '../domain/permissions.js';
import { isRowHandoffAllowed } from '../domain/picking.js';
import type { Position } from '../domain/position.js';
import type { PermissionAction } from '../domain/constants.js';
import { ConflictError } from '../errors.js';
import { insertArchive, type ArchiveEntry } from '../repositories/archive.js';
import { adjustWarehouseQty } from '../repositories/materials.js';
import {
  findPositionByPositionId,
  updateOperatingFields,
} from '../repositories/positions.js';
import { AUDIT_ACTION, HISTORY_EVENT, recordChanges, type OperationContext } from './operationLog.js';

/** Итог обработки одной позиции в команде. */
export interface HandoffItemResult {
  positionId: string;
  bomName: string;
  materialName: string;
  model: string;
  status: 'handoff' | 'returned' | 'already' | 'blocked';
  reason?: string;
}

export interface HandoffBatchResult {
  results: HandoffItemResult[];
  handedOff: number;
  returned: number;
  skipped: number;
  blocked: number;
}

/** Источник отметки определяет проверяемое право. */
function permissionForHandoff(source: string): PermissionAction {
  return source === SOURCE_UI.WORKING_BOM ? 'WORKING_BOM_CHECKBOX' : 'PICKING_CHECKBOX';
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

/** Краткое описание позиции для ответа пользователю. */
function describe(position: Position): HandoffItemResult {
  return {
    positionId: position.positionId,
    bomName: position.bomName,
    materialName: position.identity.name,
    model: position.identity.model,
    status: 'blocked',
  };
}

/**
 * Передать позиции производству.
 *
 * Каждая позиция проверяется независимо: одна заблокированная строка не должна
 * отменять передачу остальных — иначе массовая передача превращалась бы в
 * «угадай, какая строка мешает».
 */
export async function markReceivedByProduction(
  db: Database,
  ctx: OperationContext,
  params: { positionIds: readonly string[]; source?: string },
): Promise<HandoffBatchResult> {
  const source = params.source ?? SOURCE_UI.PICKING;
  requirePermission(ctx.role, permissionForHandoff(source));

  if (!params.positionIds.length) {
    throw new ConflictError('Не выбрано ни одной позиции для передачи');
  }

  return db.transaction(async (tx) => {
    const results: HandoffItemResult[] = [];
    const archiveRows: ArchiveEntry[] = [];
    const acknowledged = new Set<string>();

    for (const positionId of params.positionIds) {
      if (acknowledged.has(positionId)) {
        continue;
      }
      acknowledged.add(positionId);

      const position = await findPositionByPositionId(tx, positionId);
      if (!position) {
        results.push({
          positionId,
          bomName: '',
          materialName: '',
          model: '',
          status: 'blocked',
          reason: 'Позиция не найдена',
        });
        continue;
      }

      const base = describe(position);
      const required = position.quantities.requiredQty;

      if (position.quantities.received && position.quantities.receivedQty >= required) {
        results.push({ ...base, status: 'already', reason: 'Позиция уже передана производству' });
        continue;
      }
      if (!position.computed.valid) {
        results.push({
          ...base,
          status: 'blocked',
          reason: 'Позиция невалидна: заполните обязательные поля спецификации',
        });
        continue;
      }
      if (!isRowHandoffAllowed(position)) {
        results.push({
          ...base,
          status: 'blocked',
          reason:
            `Не хватает доступного количества: необходимо ${required}, ` +
            `доступно ${position.computed.availableForProduction}`,
        });
        continue;
      }

      const receivedAt = new Date();
      await updateOperatingFields(tx, position.positionId, {
        received: true,
        receivedQty: required,
        receivedAt,
        receivedBy: ctx.actor,
        lifecycle: LIFECYCLE_STATE.ARCHIVED,
      });

      if (required !== 0) {
        await adjustWarehouseQty(tx, position.materialKey, -required, materialIdentity(position));
      }

      archiveRows.push({
        positionId: position.positionId,
        bomId: position.bomId,
        bomName: position.bomName,
        rowNo: position.identity.rowNo,
        code: position.identity.code,
        manufacturer: position.identity.manufacturer,
        name: position.identity.name,
        model: position.identity.model,
        unit: position.identity.unit,
        qty: required,
        receivedAt,
        receivedBy: ctx.actor,
        sourceUi: source,
      });

      results.push({ ...base, status: 'handoff' });
    }

    await insertArchive(tx, archiveRows);

    const changes = results
      .filter((result) => result.status === 'handoff')
      .map((result) => ({
        action: AUDIT_ACTION.HANDOFF,
        bomId: results.find((item) => item.positionId === result.positionId)?.bomName ?? '',
        positionId: result.positionId,
        field: 'RECEIVED_BY_PRODUCTION',
        oldValue: false,
        newValue: true,
        reason: `Передано производству из ${source}`,
        historyEvent: HISTORY_EVENT.HANDOFF,
      }));
    await recordChanges(tx, ctx, changes);

    return {
      results,
      handedOff: results.filter((result) => result.status === 'handoff').length,
      returned: 0,
      skipped: results.filter((result) => result.status === 'already').length,
      blocked: results.filter((result) => result.status === 'blocked').length,
    };
  });
}

/**
 * Вернуть позиции из архива в работу.
 *
 * Причина обязательна: возврат меняет состояние склада и производства, и по
 * журналу должно быть понятно, почему это сделано.
 */
export async function returnFromArchive(
  db: Database,
  ctx: OperationContext,
  params: { positionIds: readonly string[]; reason: string },
): Promise<HandoffBatchResult> {
  requirePermission(ctx.role, 'PICKING_CHECKBOX');

  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new ConflictError('Не указана причина возврата');
  }
  if (!params.positionIds.length) {
    throw new ConflictError('Не выбрано ни одной позиции для возврата');
  }

  return db.transaction(async (tx) => {
    const results: HandoffItemResult[] = [];
    const acknowledged = new Set<string>();

    for (const positionId of params.positionIds) {
      if (acknowledged.has(positionId)) {
        continue;
      }
      acknowledged.add(positionId);

      const position = await findPositionByPositionId(tx, positionId);
      if (!position) {
        results.push({
          positionId,
          bomName: '',
          materialName: '',
          model: '',
          status: 'blocked',
          reason: 'Позиция не найдена',
        });
        continue;
      }

      const base = describe(position);
      const returnedQty = position.quantities.receivedQty;

      await updateOperatingFields(tx, position.positionId, {
        received: false,
        receivedQty: 0,
        receivedAt: null,
        receivedBy: '',
        lifecycle: LIFECYCLE_STATE.ACTIVE,
      });

      if (returnedQty > 0) {
        await adjustWarehouseQty(
          tx,
          position.materialKey,
          returnedQty,
          materialIdentity(position),
        );
      }

      results.push({ ...base, status: 'returned' });
    }

    await recordChanges(
      tx,
      ctx,
      results
        .filter((result) => result.status === 'returned')
        .map((result) => ({
          action: AUDIT_ACTION.RETURN_FROM_ARCHIVE,
          bomId: result.bomName,
          positionId: result.positionId,
          field: 'RECEIVED_BY_PRODUCTION',
          oldValue: true,
          newValue: false,
          reason,
          historyEvent: HISTORY_EVENT.RETURN_FROM_ARCHIVE,
          historyComment: reason,
        })),
    );

    return {
      results,
      handedOff: 0,
      returned: results.filter((result) => result.status === 'returned').length,
      skipped: 0,
      blocked: results.filter((result) => result.status === 'blocked').length,
    };
  });
}

/**
 * Проверка «что будет, если передать» — для показа причины отказа в интерфейсе
 * до нажатия кнопки.
 */
export function handoffReadiness(position: Position): {
  allowed: boolean;
  reason: string;
  state: string;
} {
  if (position.quantities.received) {
    return { allowed: false, reason: 'Позиция уже передана производству', state: 'RECEIVED' };
  }
  if (position.lifecycle !== LIFECYCLE_STATE.ACTIVE) {
    return { allowed: false, reason: 'Позиция не активна', state: position.lifecycle };
  }
  if (!position.computed.valid) {
    return {
      allowed: false,
      reason: 'Позиция невалидна: заполните обязательные поля спецификации',
      state: PRODUCTION_STATE.NOT_AVAILABLE,
    };
  }
  if (!isRowHandoffAllowed(position)) {
    return {
      allowed: false,
      reason:
        `Не хватает доступного количества: необходимо ${position.quantities.requiredQty}, ` +
        `доступно ${position.computed.availableForProduction}`,
      state: position.computed.productionState,
    };
  }
  return { allowed: true, reason: '', state: PRODUCTION_STATE.READY_FOR_HANDOFF };
}
