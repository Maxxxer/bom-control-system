/**
 * Маршруты кладовщика: складской остаток материалов.
 *
 *   GET  /api/warehouse             — остатки, резервы, свободный остаток
 *   GET  /api/warehouse/summary     — сводка (сколько строк, сколько проблемных)
 *   POST /api/warehouse/bulk        — МАССОВАЯ установка остатков (вставка столбца
 *                                     из Excel: одна команда на всю пачку)
 *   POST /api/warehouse/:materialKey — установить фактический остаток
 *
 * Ключ материала содержит вертикальную черту и кириллицу, поэтому клиент кодирует
 * его через `encodeURIComponent`.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import { ValidationError } from '../../errors.js';
import {
  listInconsistencies,
  listWarehouse,
  setWarehouseQuantity,
  setWarehouseQuantitiesBulk,
  type WarehouseBulkChange,
} from '../../services/warehouseService.js';
import { sendBulkReply } from '../operationReply.js';
import { authenticate, authenticateWithContext, requireBody } from '../requestAuth.js';

/**
 * Прочитать список остатков из тела запроса.
 *
 * Значения здесь НЕ приводятся: их проверяет сервис (`parseBulkQuantity`), чтобы
 * правило разбора количества оставалось в одном месте. Маршрут следит только за
 * формой — «список объектов с полями materialKey, quantity».
 */
function readBulkQuantities(value: unknown): WarehouseBulkChange[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('Не передан список остатков');
  }
  return value.map((item) => {
    const entry = (item ?? {}) as { materialKey?: unknown; quantity?: unknown };
    return {
      materialKey: String(entry.materialKey ?? '').trim(),
      quantity: entry.quantity ?? null,
    };
  });
}

/** Ключ материала из адреса запроса. */
function materialKeyOf(request: { params: unknown }): string {
  const value = (request.params as { materialKey?: unknown })?.materialKey;
  const materialKey = String(value ?? '').trim();
  if (!materialKey) {
    throw new ValidationError('Не указан материал');
  }
  return materialKey;
}

export function registerWarehouseRoutes(
  app: FastifyInstance,
  db: Database,
  _config: AppConfig,
): void {
  app.get('/api/warehouse', async (request) => {
    await authenticate(db, request);
    const rows = await listWarehouse(db);
    return {
      rows,
      inconsistencies: listInconsistencies(rows),
      totals: {
        rows: rows.length,
        warehouseQty: rows.reduce((sum, row) => sum + row.warehouseQty, 0),
        reservedQty: rows.reduce((sum, row) => sum + row.reservedQty, 0),
        freeQty: rows.reduce((sum, row) => sum + row.freeQty, 0),
        inconsistent: rows.filter((row) => row.inconsistent).length,
      },
    };
  });

  app.get('/api/warehouse/summary', async (request) => {
    await authenticate(db, request);
    const rows = await listWarehouse(db);
    return {
      rows: rows.length,
      withStock: rows.filter((row) => row.warehouseQty > 0).length,
      inconsistent: listInconsistencies(rows).length,
      reservedTotal: rows.reduce((sum, row) => sum + row.reservedQty, 0),
      freeTotal: rows.reduce((sum, row) => sum + row.freeQty, 0),
    };
  });

  /**
   * Массовая установка остатков.
   *
   * Объявлен ДО `/api/warehouse/:materialKey` намеренно: у адресов одинаковый
   * префикс, и объявление после параметрического маршрута рисковало бы принять
   * «bulk» за ключ материала.
   */
  app.post('/api/warehouse/bulk', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ changes?: unknown }>(request);
    const result = await setWarehouseQuantitiesBulk(db, ctx, {
      changes: readBulkQuantities(body.changes),
    });
    return sendBulkReply(reply, result);
  });

  app.post('/api/warehouse/:materialKey', async (request, reply) => {
    const { ctx } = await authenticateWithContext(db, request);
    const body = requireBody<{ quantity?: number | string }>(request);
    const result = await setWarehouseQuantity(db, ctx, {
      materialKey: materialKeyOf(request),
      quantity: Number(body.quantity ?? 0),
    });
    return reply.send(result);
  });
}
