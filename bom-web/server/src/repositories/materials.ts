/**
 * Репозиторий физического склада (соответствует прежнему MATERIAL_STATE).
 *
 * Хранится только фактический остаток (`warehouse_qty`). Резерв и свободный
 * остаток — величины производные: резерв складывается из резервов позиций
 * (он приходит из спецификации), свободный остаток = остаток − резерв, но не
 * меньше нуля. Производные значения НЕ хранятся, чтобы не было двух источников
 * правды и рассогласования между ними.
 *
 * Создание записи материала выполняется при первом обращении (например, когда
 * кладовщик впервые принимает материал или фиксируется поставка).
 */

import type { Database } from '../db/Database.js';

export interface MaterialRecord {
  materialKey: string;
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
  warehouseQty: number;
}

interface MaterialRow {
  material_key: string;
  code: string | null;
  manufacturer: string | null;
  name: string | null;
  model: string | null;
  unit: string | null;
  warehouse_qty: number | string;
}

const MATERIAL_SELECT = `
  select material_key, code, manufacturer, name, model, unit, warehouse_qty::float8 as warehouse_qty
    from materials
`;

function mapMaterial(row: MaterialRow): MaterialRecord {
  return {
    materialKey: row.material_key,
    code: row.code ?? '',
    manufacturer: row.manufacturer ?? '',
    name: row.name ?? '',
    model: row.model ?? '',
    unit: row.unit ?? '',
    warehouseQty: Number(row.warehouse_qty),
  };
}

/** Все материалы склада. */
export async function listMaterials(db: Database): Promise<MaterialRecord[]> {
  const rows = await db.query<MaterialRow>(`${MATERIAL_SELECT} order by name asc, material_key asc`);
  return rows.map(mapMaterial);
}

/** Найти материал по ключу. */
export async function findMaterial(
  db: Database,
  materialKey: string,
): Promise<MaterialRecord | null> {
  const rows = await db.query<MaterialRow>(`${MATERIAL_SELECT} where material_key = $1`, [
    materialKey,
  ]);
  const row = rows[0];
  return row ? mapMaterial(row) : null;
}

/** Данные материала, которые нужны при создании записи склада. */
export interface MaterialIdentity {
  code: string;
  manufacturer: string;
  name: string;
  model: string;
  unit: string;
}

/**
 * Изменить остаток склада на дельту.
 *
 * Если записи материала ещё нет — она создаётся (с нулевым остатком, если дельта
 * отрицательная), как это делала прежняя система. Отрицательный остаток
 * невозможен: количество ограничивается нулём.
 */
export async function adjustWarehouseQty(
  db: Database,
  materialKey: string,
  delta: number,
  identity: MaterialIdentity,
): Promise<number> {
  const rows = await db.query<{ warehouse_qty: number | string }>(
    `insert into materials (material_key, code, manufacturer, name, model, unit, warehouse_qty)
     values ($1, $2, $3, $4, $5, $6, greatest($7, 0))
     on conflict (material_key) do update set
       code          = case when excluded.code <> '' then excluded.code else materials.code end,
       manufacturer  = case when excluded.manufacturer <> '' then excluded.manufacturer else materials.manufacturer end,
       name          = case when excluded.name <> '' then excluded.name else materials.name end,
       model         = case when excluded.model <> '' then excluded.model else materials.model end,
       unit          = case when excluded.unit <> '' then excluded.unit else materials.unit end,
       warehouse_qty = greatest(materials.warehouse_qty + $7, 0),
       updated_at    = now()
     returning warehouse_qty::float8 as warehouse_qty`,
    [
      materialKey,
      identity.code,
      identity.manufacturer,
      identity.name,
      identity.model,
      identity.unit,
      delta,
    ],
  );
  return Number(rows[0]?.warehouse_qty ?? 0);
}

/** Установить точный остаток склада (кладовщик вводит фактическое наличие). */
export async function setWarehouseQty(
  db: Database,
  materialKey: string,
  quantity: number,
  identity: MaterialIdentity,
): Promise<number> {
  const rows = await db.query<{ warehouse_qty: number | string }>(
    `insert into materials (material_key, code, manufacturer, name, model, unit, warehouse_qty)
     values ($1, $2, $3, $4, $5, $6, greatest($7, 0))
     on conflict (material_key) do update set
       code          = case when excluded.code <> '' then excluded.code else materials.code end,
       manufacturer  = case when excluded.manufacturer <> '' then excluded.manufacturer else materials.manufacturer end,
       name          = case when excluded.name <> '' then excluded.name else materials.name end,
       model         = case when excluded.model <> '' then excluded.model else materials.model end,
       unit          = case when excluded.unit <> '' then excluded.unit else materials.unit end,
       warehouse_qty = greatest($7, 0),
       updated_at    = now()
     returning warehouse_qty::float8 as warehouse_qty`,
    [
      materialKey,
      identity.code,
      identity.manufacturer,
      identity.name,
      identity.model,
      identity.unit,
      quantity,
    ],
  );
  return Number(rows[0]?.warehouse_qty ?? 0);
}

/** Сумма резервов по материалам: ключ материала → зарезервировано. */
export async function reservedByMaterial(db: Database): Promise<Map<string, number>> {
  const rows = await db.query<{ material_key: string; reserved: number | string }>(
    `select material_key, coalesce(sum(reserved_qty), 0)::float8 as reserved
       from bom_positions
      where lifecycle = 'ACTIVE'
      group by material_key`,
  );
  const reserved = new Map<string, number>();
  for (const row of rows) {
    reserved.set(row.material_key, Number(row.reserved));
  }
  return reserved;
}
