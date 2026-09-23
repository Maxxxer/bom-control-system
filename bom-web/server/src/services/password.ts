/**
 * Хеширование паролей.
 *
 * Используется `scrypt` из стандартной библиотеки Node: пароль никогда не
 * хранится и не передаётся в открытом виде, а проверка выполняется сравнением
 * с постоянным временем (`timingSafeEqual`), чтобы по времени ответа нельзя было
 * подбирать пароль посимвольно.
 *
 * Формат хранения: `scrypt$N$r$p$соль$хеш`. Параметры лежат в самой строке,
 * поэтому при изменении настроек старые пароли продолжают проверяться.
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Выработать ключ из пароля.
 *
 * `promisify(scrypt)` не подходит: в типах Node у обещанной версии теряется
 * перегрузка с параметрами, а без параметров стойкость падает до значений по
 * умолчанию. Поэтому обёртка написана вручную.
 */
function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/** Параметры выработки ключа: компромисс между стойкостью и временем ответа. */
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Минимальная длина пароля, принимаемая системой. */
export const MIN_PASSWORD_LENGTH = 8;

/** Захешировать пароль. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Пароль должен содержать не меньше ${MIN_PASSWORD_LENGTH} символов`);
  }
  const salt = randomBytes(SALT_LENGTH);
  const derived = await deriveKey(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Проверить пароль.
 *
 * Возвращает `false` и при неверном пароле, и при повреждённой строке хранения —
 * вызывающая сторона не должна различать эти случаи.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelism = Number(parts[3]);
  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelism)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64');
    expected = Buffer.from(parts[5] ?? '', 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) {
    return false;
  }

  const derived = await deriveKey(password, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
