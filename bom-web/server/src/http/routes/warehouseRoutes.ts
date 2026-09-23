/**
 * Маршруты кладовщика: складской остаток материалов.
 *
 *   GET  /api/warehouse             — остатки, резервы, свободный остаток
 *   GET  /api/warehouse/summary     — сводка (сколько строк, сколько проблемных)
 *   POST /api/warehouse/:materialKey — установить фактический остаток
 *
 * Ключ материала содержит вертикальную черту и кириллицу, поэтому клиент кодирует
 * его через `encodeURIComponent`.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import { ValidationError } from '../../errors.js';
import { listInconsistencies, listWarehouse, setWarehouseQuantity } from '../../services/warehouseService.js';
import { authenticate, authenticateWithContext, requireBody } from '../requestAuth.js';

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
