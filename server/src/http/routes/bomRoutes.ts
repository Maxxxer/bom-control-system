/**
 * Маршруты спецификаций: гибридное наполнение и завершение проектов.
 *
 *   GET    /api/boms                — список спецификаций с числом позиций
 *   POST   /api/boms/import         — импорт из Excel/CSV (файл в base64)
 *   GET    /api/boms/:code          — карточка спецификации с позициями
 *   POST   /api/boms/:code/done     — «Выполнено» / возврат в работу
 *   DELETE /api/boms/:code          — удалить спецификацию с позициями
 *
 * Файл передаётся содержимым в base64, а не как multipart-загрузка: так сервер
 * не зависит от дополнительных плагинов, а браузер читает файл сам и присылает
 * его целиком. Размер файла ограничен константой `LIMITS.MAX_IMPORT_BYTES`.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import { requirePermission } from '../../domain/permissions.js';
import { ValidationError } from '../../errors.js';
import {
  deleteBom,
  getBomCard,
  importBomFromFile,
  listBomsWithCounts,
  setBomCompletion,
} from '../../services/bomService.js';
import { authenticate, authenticateWithContext, requireBody } from '../requestAuth.js';

/** Код спецификации из адреса запроса. */
function bomCodeOf(request: { params: unknown }): string {
  const value = (request.params as { code?: unknown })?.code;
  const code = String(value ?? '').trim();
  if (!code) {
    throw new ValidationError('Не указана спецификация');
  }
  return code;
}

export function registerBomRoutes(app: FastifyInstance, db: Database, _config: AppConfig): void {
  app.get('/api/boms', async (request) => {
    await authenticate(db, request);
    const boms = await listBomsWithCounts(db);
    return { boms };
  });

  app.get('/api/boms/:code', async (request) => {
    await authenticate(db, request);
    return getBomCard(db, bomCodeOf(request));
  });

  app.post('/api/boms/import', async (request, reply) => {
    const { user, ctx } = await authenticateWithContext(db, request);
    requirePermission(user.role, 'SOURCE_BOM_WRITE');

    const body = requireBody<{ fileName?: string; contentBase64?: string }>(request);
    const fileName = String(body.fileName ?? '').trim();
    if (!fileName) {
      throw new ValidationError('Не указано имя файла спецификации');
    }
    const contentBase64 = String(body.contentBase64 ?? '');
    if (!contentBase64) {
      throw new ValidationError('Файл не передан');
    }

    const report = await importBomFromFile(db, ctx, { fileName, contentBase64 });
    return reply.send(report);
  });

  app.post('/api/boms/:code/done', async (request, reply) => {
    const { user, ctx } = await authenticateWithContext(db, request);
    requirePermission(user.role, 'DASHBOARD_CHECKBOX');

    const body = requireBody<{ done?: boolean }>(request);
    const bom = await setBomCompletion(db, ctx, {
      bomCode: bomCodeOf(request),
      done: body.done !== false,
    });
    return reply.send({ bom });
  });

  app.delete('/api/boms/:code', async (request, reply) => {
    const { user, ctx } = await authenticateWithContext(db, request);
    requirePermission(user.role, 'SOURCE_BOM_WRITE');

    const result = await deleteBom(db, ctx, bomCodeOf(request));
    return reply.send(result);
  });
}
