/**
 * Маршруты витрин — данные рабочих экранов.
 *
 *   GET /api/overview     — обзор для главного экрана
 *   GET /api/deficit      — сводка дефицитов (снабженец, экономист)
 *   GET /api/working-bom  — WORKING BOM (производство)
 *   GET /api/picking      — отборка (кладовщик, производство)
 *   GET /api/supply       — снабжение (свод по материалам)
 *   GET /api/dashboard    — дашборд (производство, руководитель)
 *   GET /api/projects     — список кодов проектов для фильтров
 *
 * Фильтр по проекту передаётся параметром запроса `project`. Права на чтение не
 * ограничиваются: любая роль видит витрины, но менять данные может только та,
 * у которой есть соответствующее право — это проверяют операции.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/Database.js';
import {
  getDashboardView,
  getDeficitView,
  getOverview,
  getPickingView,
  getSupplyView,
  getWorkingBomView,
} from '../../services/projectionService.js';
import { authenticate } from '../requestAuth.js';

/** Прочитать фильтр проекта из параметров запроса. */
function projectOf(query: unknown): string | null {
  const value = (query as { project?: unknown })?.project;
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

export function registerProjectionRoutes(
  app: FastifyInstance,
  db: Database,
  _config: AppConfig,
): void {
  app.get('/api/overview', async (request) => {
    await authenticate(db, request);
    return getOverview(db);
  });

  app.get('/api/deficit', async (request) => {
    await authenticate(db, request);
    return getDeficitView(db, { projectCode: projectOf(request.query) });
  });

  app.get('/api/working-bom', async (request) => {
    await authenticate(db, request);
    return getWorkingBomView(db, { projectCode: projectOf(request.query) });
  });

  app.get('/api/picking', async (request) => {
    await authenticate(db, request);
    return getPickingView(db, { projectCode: projectOf(request.query) });
  });

  app.get('/api/supply', async (request) => {
    await authenticate(db, request);
    return getSupplyView(db);
  });

  app.get('/api/dashboard', async (request) => {
    await authenticate(db, request);
    return getDashboardView(db);
  });

  app.get('/api/projects', async (request) => {
    await authenticate(db, request);
    const picking = await getPickingView(db);
    return { projects: picking.projects };
  });
}
