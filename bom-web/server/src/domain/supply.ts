/**
 * Лист СНАБЖЕНИЕ — перенос `v12RefreshSupply`, `v12AccumulateSupplyProject`,
 * `v12BuildSupplyProjectsText` (`v12_projections.js`).
 *
 * Смысл листа: один материал — одна строка, где сведены дефицит, заказ и приход
 * по ВСЕМ проектам, плюс перечень проектов с их дефицитом и самым ранним
 * (самым жёстким) крайним сроком.
 */

import { formatDateOnly, toIsoDate } from './values.js';
import { isSupplyVisible, type Position } from './position.js';
import type { SupplyProjectEntry, SupplyRow } from './projectionTypes.js';

/** Накопление по одному проекту внутри строки материала. */
interface ProjectAccumulator {
  projectCode: string;
  deficitQty: number;
  deadline: string | null;
}

/** Строка материала при агрегации. */
interface MaterialAccumulator {
  materialKey: string;
  materialCode: string;
  manufacturer: string;
  materialName: string;
  model: string;
  unit: string;
  totalDeficit: number;
  totalOrdered: number;
  totalRealDelivery: number;
  projects: Map<string, ProjectAccumulator>;
}

/** Текст перечня проектов: по строке на проект, сортировка по сроку (ранние сверху). */
export function buildSupplyProjects(projects: Iterable<ProjectAccumulator>): SupplyProjectEntry[] {
  return [...projects]
    .sort((a, b) => {
      const da = toIsoDate(a.deadline);
      const db = toIsoDate(b.deadline);
      if (da && db && da !== db) {
        return da < db ? -1 : 1;
      }
      if (da && !db) {
        return -1;
      }
      if (!da && db) {
        return 1;
      }
      return a.projectCode.localeCompare(b.projectCode, 'ru');
    })
    .map((project) => {
      const date = formatDateOnly(project.deadline);
      return {
        projectCode: project.projectCode,
        deficitQty: project.deficitQty,
        deadline: project.deadline,
        text: date
          ? `${project.deficitQty} - ${project.projectCode} - ${date}`
          : `${project.deficitQty} - ${project.projectCode}`,
      } satisfies SupplyProjectEntry;
    });
}

/** Агрегировать позиции по ключу материала. */
export function buildSupplyRows(positions: readonly Position[]): SupplyRow[] {
  const byMaterial = new Map<string, MaterialAccumulator>();

  for (const position of positions) {
    if (!isSupplyVisible(position)) {
      continue;
    }
    const key = position.materialKey;
    let acc = byMaterial.get(key);
    if (!acc) {
      acc = {
        materialKey: key,
        materialCode: position.identity.code,
        manufacturer: position.identity.manufacturer,
        materialName: position.identity.name,
        model: position.identity.model,
        unit: position.identity.unit,
        totalDeficit: 0,
        totalOrdered: 0,
        totalRealDelivery: 0,
        projects: new Map<string, ProjectAccumulator>(),
      };
      byMaterial.set(key, acc);
    }
    acc.totalDeficit += position.computed.deficitQty;
    acc.totalOrdered += position.quantities.orderedQty;
    acc.totalRealDelivery += position.quantities.realDeliveryQty;

    const projectCode = projectCodeOf(position);
    if (projectCode) {
      const existing = acc.projects.get(projectCode);
      if (existing) {
        existing.deficitQty += position.computed.deficitQty;
        existing.deadline = earliestDeadline(existing.deadline, position.identity.deadline);
      } else {
        acc.projects.set(projectCode, {
          projectCode,
          deficitQty: position.computed.deficitQty,
          deadline: position.identity.deadline,
        });
      }
    }
  }

  return [...byMaterial.values()]
    .map((acc) => ({
      materialKey: acc.materialKey,
      materialCode: acc.materialCode,
      manufacturer: acc.manufacturer,
      materialName: acc.materialName,
      model: acc.model,
      unit: acc.unit,
      totalDeficit: acc.totalDeficit,
      totalOrdered: acc.totalOrdered,
      totalRealDelivery: acc.totalRealDelivery,
      projects: buildSupplyProjects(acc.projects.values()),
    }))
    .sort((a, b) => a.materialName.localeCompare(b.materialName, 'ru'));
}

/** Более ранняя из двух дат (пустая дата не затирает уже найденный срок). */
function earliestDeadline(current: string | null, candidate: string | null): string | null {
  const next = toIsoDate(candidate);
  if (!next) {
    return current;
  }
  const now = toIsoDate(current);
  if (!now) {
    return next;
  }
  return next < now ? next : now;
}

/** Код проекта позиции (пустой код в агрегат не попадает). */
function projectCodeOf(position: Position): string {
  return String(position.bomName ?? '').split(/[\s\-_]/)[0].trim();
}
