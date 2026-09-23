/**
 * Сборка HTTP-приложения.
 *
 * Здесь собирается всё вместе: cookie-сессии, обработчик ошибок, маршруты по
 * ролям и раздача собранного интерфейса. Функция возвращает готовый экземпляр,
 * поэтому её же используют автотесты — проверяется ровно то приложение, которое
 * увидит пользователь.
 *
 * Раздача интерфейса включается ТОЛЬКО если каталог сборки существует. В режиме
 * разработки интерфейс отдаёт Vite, а сервер отвечает лишь на `/api/*` — так
 * горячая перезагрузка фронтенда работает, а поведение API не меняется.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import type { Database } from '../db/Database.js';
import { registerErrorHandler } from './errors.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerBomRoutes } from './routes/bomRoutes.js';
import { registerHandoffRoutes } from './routes/handoffRoutes.js';
import { registerPositionRoutes } from './routes/positionRoutes.js';
import { registerProjectionRoutes } from './routes/projectionRoutes.js';
import { registerWarehouseRoutes } from './routes/warehouseRoutes.js';

/** Собрать приложение с подключённой базой. */
export async function buildServer(config: AppConfig, db: Database): Promise<FastifyInstance> {
  const app = Fastify({
    // Формат журнала — обычный JSON: дополнительных пакетов для этого не нужно,
    // а вывод читается любой системой сбора журналов.
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Спецификации приходят целиком в base64, поэтому поднимаем лимит тела
    // запроса: иначе крупная спецификация не дойдёт и браузер получит 413.
    bodyLimit: 16 * 1024 * 1024,
  });

  // Каталог сборки раздаётся только если он существует, и приводится к
  // абсолютному пути: раздача статики требует абсолютный корень, а в настройках
  // путь задаётся относительным (например, `web/dist`).
  const staticDir = path.resolve(config.staticDir);
  const hasStatic = existsSync(staticDir);

  await app.register(fastifyCookie);
  registerErrorHandler(app, { serveIndex: hasStatic });

  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  registerAuthRoutes(app, db, config);
  registerProjectionRoutes(app, db, config);
  registerPositionRoutes(app, db, config);
  registerHandoffRoutes(app, db, config);
  registerWarehouseRoutes(app, db, config);
  registerBomRoutes(app, db, config);
  registerAdminRoutes(app, db, config);

  // Раздача собранного интерфейса: файлы отдаёт плагин статики, а адреса вида
  // /picking обслуживает тот же index.html — решение принимает обработчик 404.
  if (hasStatic) {
    await app.register(fastifyStatic, { root: staticDir, prefix: '/' });
  }

  return app;
}
