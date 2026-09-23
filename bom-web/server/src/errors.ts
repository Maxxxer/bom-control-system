/**
 * Ошибки приложения.
 *
 * Каждая ошибка соответствует понятной пользователю ситуации, а HTTP-слой
 * переводит её в код ответа:
 *
 *   AuthenticationError — 401 (не вошёл или сессия истекла);
 *   PermissionDeniedError (см. domain/permissions.ts) — 403 (роль не позволяет);
 *   NotFoundError — 404 (запись не найдена);
 *   ValidationError — 400 (данные не прошли проверку);
 *   ConflictError — 409 (правило данных нарушено: например, передача при
 *   нехватке материала).
 *
 * Текст сообщений предназначен человеку: он показывается прямо в интерфейсе.
 */

/** Слой HTTP использует этот код, если ошибка не опознана. */
export class AppError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.httpStatus = httpStatus;
  }
}

/** Пользователь не вошёл в систему или сессия истекла. */
export class AuthenticationError extends AppError {
  constructor(message = 'Требуется вход в систему') {
    super(message, 401);
  }
}

/** Запись не найдена. */
export class NotFoundError extends AppError {
  constructor(message = 'Запись не найдена') {
    super(message, 404);
  }
}

/** Входные данные не прошли проверку. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

/** Нарушено правило предметной области. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}
