/**
 * Первичная настройка: создание администратора при пустой базе.
 *
 * Нужно, чтобы систему можно было запустить «с нуля»: при первом старте база
 * пуста, войти некому, а создавать пользователей может только администратор.
 * Поэтому логин и пароль первого администратора берутся из настроек окружения
 * (`ADMIN_LOGIN`, `ADMIN_PASSWORD`) и используются ровно один раз — пока в базе
 * нет ни одной учётной записи.
 *
 * Повторный запуск ничего не меняет: существующие учётные записи не трогаются.
 */

import type { Database } from '../db/Database.js';
import type { SeedConfig } from '../config.js';
import { createUser, countUsers } from '../repositories/users.js';
import { hashPassword } from './password.js';

export interface SeedResult {
  /** Был ли создан администратор (false — учётные записи уже есть). */
  created: boolean;
  login: string;
  /** Стоит ли предупредить о пароле по умолчанию. */
  usesDefaultPassword: boolean;
}

/** Пароль по умолчанию из конфигурации (совпадает с примером `.env.example`). */
const DEFAULT_PASSWORD = 'admin12345';

/**
 * Создать первого администратора, если пользователей ещё нет.
 *
 * Возвращает признак того, что использован пароль по умолчанию: сервер выводит
 * об этом предупреждение в журнал, чтобы пароль сменили до начала работы.
 */
export async function ensureInitialAdmin(
  db: Database,
  seed: SeedConfig,
): Promise<SeedResult> {
  const existing = await countUsers(db);
  if (existing > 0) {
    return { created: false, login: seed.login, usesDefaultPassword: false };
  }

  await createUser(db, {
    login: seed.login,
    fullName: seed.fullName,
    role: 'admin',
    passwordHash: await hashPassword(seed.password),
  });

  return {
    created: true,
    login: seed.login,
    usesDefaultPassword: seed.password === DEFAULT_PASSWORD,
  };
}
