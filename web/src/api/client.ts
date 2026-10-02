/**
 * HTTP-клиент интерфейса.
 *
 * Две особенности, которые важны для всей системы:
 *
 * 1. Cookie сессии отправляются автоматически (`credentials: 'include'`) —
 *    интерфейс не хранит токен и не может его потерять.
 * 2. Отказ по правилам (нельзя передать материал, не хватает количества) — это
 *    НЕ ошибка сети: сервер отвечает кодом 409 с телом операции, и интерфейс
 *    показывает причину рядом со строкой. Поэтому для операций отказ
 *    возвращается как обычный результат, а не как исключение.
 */

/** Ошибка API с кодом ответа и телом (тело нужно для показа деталей). */
export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }

  /** Пользователь не вошёл (или сессия истекла). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Роль не имеет права на действие. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** Кодировать идентификатор для адреса (в нём есть `:`, `#` и `|`). */
export function encodeId(value: string): string {
  return encodeURIComponent(value);
}

/** Разобрать ответ: JSON или текст, с осмысленным сообщением об ошибке. */
async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Сообщение об ошибке из тела ответа. */
function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  return `Ошибка запроса (${status})`;
}

/** Выполнить запрос и вернуть разобранный ответ. */
async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(path, init);
  const payload = await readResponse(response);
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(payload, response.status), payload);
  }
  return payload;
}

/** GET с типом ответа. */
export function getJson<Response>(path: string): Promise<Response> {
  return request('GET', path) as Promise<Response>;
}

/** POST с типом ответа. */
export function postJson<Response>(path: string, body?: unknown): Promise<Response> {
  return request('POST', path, body) as Promise<Response>;
}

/** PATCH с типом ответа. */
export function patchJson<Response>(path: string, body?: unknown): Promise<Response> {
  return request('PATCH', path, body) as Promise<Response>;
}

/** DELETE с типом ответа. */
export function deleteJson<Response>(path: string): Promise<Response> {
  return request('DELETE', path) as Promise<Response>;
}

/**
 * Выполнить операцию, для которой отказ правил (409) — нормальный исход.
 *
 * Так вызывающий код получает причину отказа тем же путём, что и успех, и ему не
 * нужно ловить исключения ради ожидаемого сценария.
 */
export async function postOperation<Response>(path: string, body?: unknown): Promise<Response> {
  try {
    return (await request('POST', path, body)) as Response;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.payload) {
      return error.payload as Response;
    }
    throw error;
  }
}

/** Число или 0, если значение не разбирается (защита от пустого поля). */
export function numberOrZero(value: string): number {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) {
    return 0;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
