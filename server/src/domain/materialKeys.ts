/**
 * Ключи материалов и позиций — перенос `v12BuildMaterialKey`,
 * `v12GeneratePositionId` (`v12_utils.js`).
 *
 * Ключи здесь — ГЛАВНЫЙ стабильный идентификатор системы: на `positionId`
 * завязаны история, архив и все ссылки на позицию. Правила построения
 * сохранены дословно, иначе данные прежней системы нельзя будет сопоставить.
 */

import { norm } from './values.js';

/** Описание материала из спецификации (или из склада). */
export interface MaterialParts {
  code?: unknown;
  manufacturer?: unknown;
  name?: unknown;
  model?: unknown;
  unit?: unknown;
}

/**
 * Ключ материала = «артикул + производитель»: один и тот же артикул у разных
 * производителей — разные материалы. Если артикул пуст, ключ собирается из
 * наименования, модели, производителя и единицы измерения.
 */
export function buildMaterialKey(parts: MaterialParts): string {
  const code = String(parts.code ?? '').trim();
  const manufacturer = String(parts.manufacturer ?? '').trim();

  if (code) {
    return manufacturer ? `${code}|${manufacturer}` : code;
  }

  const name = String(parts.name ?? '').trim();
  const model = String(parts.model ?? '').trim();
  const unit = String(parts.unit ?? '').trim();
  const segments = [name, model];
  if (manufacturer) {
    segments.push(manufacturer);
  }
  segments.push(unit);
  return segments.join('|');
}

/** Базовый (без суффикса) идентификатор позиции: `bomId:materialKey`. */
export function basePositionId(bomId: string, materialKey: string): string {
  const bom = String(bomId ?? '').trim();
  const key = String(materialKey ?? '').trim() || 'UNKNOWN';
  return `${bom}:${key}`;
}

/**
 * Уникальный идентификатор позиции внутри BOM. Если такой ключ уже занят
 * (в спецификации повторяющийся материал), добавляется числовой суффикс
 * `#2`, `#3`, … — правило совпадает с прежней системой.
 */
export function buildPositionId(
  bomId: string,
  materialKey: string,
  taken: ReadonlySet<string>,
): string {
  const base = basePositionId(bomId, materialKey);
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}#${suffix}`)) {
    suffix += 1;
  }
  return `${base}#${suffix}`;
}

/** Найти материал в списке по ключу (регистронезависимо, как в прежней системе). */
export function findMaterialByKey<T extends MaterialParts>(
  items: readonly T[],
  materialKey: string,
): T | null {
  const target = norm(materialKey);
  for (const item of items) {
    if (norm(buildMaterialKey(item)) === target) {
      return item;
    }
  }
  return null;
}
