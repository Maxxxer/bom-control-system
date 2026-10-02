/**
 * Преобразование ошибок в HTTP-ответы.
 *
 * Одна точка на всё приложение: каждый ответ об ошибке имеет вид
 * `{ error: "текст для человека" }`, поэтому интерфейс может показать сообщение
 * напрямую, не разбирая коды. Код ответа выбирается по типу ошибки:
 * 400 — данные не прошли проверку, 401 — нет входа, 403 — роль не позволяет,
 * 404 — не найдено, 409 — нарушено правило данных, 500 — внутренняя ошибка.
 *
 * Непредвиденные ошибки НЕ показываются пользователю в подробностях: они пишутся
 * в журнал сервера, а клиент получает общее сообщение. Иначе наружу утекали бы
 * детали реализации.
 */

import type { FastifyInstance } from 'fastify';

import { PermissionDeniedError } from '../domain/permissions.js';
import { AppError } from '../errors.js';

/**
 * Настроить обработчик ошибок и обработчик ненайденного адреса.
 *
 * Обработчик 404 устанавливается здесь ровно один раз — Fastify запрещает
 * переопределять его. Решение «отдать index.html или ответить ошибкой» принимает
 * тот же обработчик: если собранный интерфейс раздаётся сервером (`serveIndex`),
 * незнакомый адрес отдаёт одностраничное приложение, а адреса `/api/*` всегда
 * остаются ошибкой 404, иначе клиент получал бы HTML вместо сообщения об ошибке.
 */
export function registerErrorHandler(
  app: FastifyInstance,
  options: { serveIndex?: boolean } = {},
): void {
  app.setErrorHandler((error, request, reply) => {
    // Текст и код читаем через один «нейтральный» тип: так обработчик не
    // зависит от того, какую форму ошибки объявляет конкретная версия Fastify.
    const details = error as { message?: unknown; statusCode?: unknown };
    const message = typeof details.message === 'string' ? details.message : 'Ошибка запроса';
    const statusCode = typeof details.statusCode === 'number' ? details.statusCode : 500;

    if (error instanceof AppError) {
      reply.code(error.httpStatus).send({ error: error.message });
      return;
    }
    if (error instanceof PermissionDeniedError) {
      reply.code(403).send({ error: error.message });
      return;
    }
    // Ошибки самого Fastify (некорректный JSON, слишком большой запрос и т. п.)
    if (statusCode < 500) {
      reply.code(statusCode).send({ error: message });
      return;
    }

    request.log.error({ err: error }, 'Необработанная ошибка');
    reply.code(500).send({ error: 'Внутренняя ошибка сервера. Попробуйте ещё раз' });
  });

  app.setNotFoundHandler((request, reply) => {
    if (options.serveIndex && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: `Метод не найден: ${request.method} ${request.url}` });
  });
}
