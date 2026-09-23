/**
 * Все обращения к серверу в одном месте.
 *
 * Страницы не собирают адреса вручную: любой запрос описан функцией с понятным
 * именем, поэтому изменение адреса или состава параметров делается здесь один
 * раз и не расползается по интерфейсу.
 */

import type {
  MetaResponse,
  ArchiveRecord,
  AuditRecord,
  BomCard,
  BomImportReport,
  BomSummary,
  HandoffBatchResult,
  OverviewResponse,
  UserView,
  WarehouseResponse,
} from './adminTypes.js';
import { deleteJson, encodeId, getJson, patchJson, postJson, postOperation } from './client.js';
import type {
  BulkReply,
  DashboardRow,
  DeficitRow,
  OperationReply,
  PickingRow,
  PositionDto,
  RollbackReply,
  SessionUser,
  SupplyRow,
  WorkingBomRow,
} from './types.js';

/** Ответ входа и текущей сессии. */
export interface SessionResponse {
  user: SessionUser;
}

/** Список проектов для фильтра. */
export interface ProjectsResponse {
  projects: string[];
}

/** История позиции. */
export interface HistoryResponse {
  history: Array<{
    id: number;
    positionId: string;
    event: string;
    field: string;
    oldValue: string;
    newValue: string;
    comment: string;
    actor: string;
    createdAt: string;
  }>;
}

/** Карточка позиции. */
export interface PositionDetailResponse {
  position: PositionDto;
  statusText: string;
  statusColor: string;
  outcome: string;
}

/** Адрес витрины с необязательным фильтром по проекту. */
function viewPath(base: string, projectCode?: string | null): string {
  const filter = String(projectCode ?? '').trim();
  return filter ? `${base}?project=${encodeURIComponent(filter)}` : base;
}

/* Вход и доступ */

export function login(loginName: string, password: string): Promise<SessionResponse> {
  return postJson<SessionResponse>('/api/auth/login', { login: loginName, password });
}

export function logout(): Promise<null> {
  return postJson<null>('/api/auth/logout');
}

export function fetchSession(): Promise<SessionResponse> {
  return getJson<SessionResponse>('/api/auth/me');
}

export function changePassword(currentPassword: string, newPassword: string): Promise<null> {
  return postJson<null>('/api/auth/password', { currentPassword, newPassword });
}

export function fetchMeta(): Promise<MetaResponse> {
  return getJson<MetaResponse>('/api/meta');
}

/* Витрины */

export function fetchOverview(): Promise<OverviewResponse> {
  return getJson<OverviewResponse>('/api/overview');
}

export function fetchDeficit(projectCode?: string | null): Promise<{
  rows: DeficitRow[];
  projects: string[];
  totals: { rows: number; deficitQty: number; uncoveredNeed: number; orderedQty: number };
}> {
  return getJson(viewPath('/api/deficit', projectCode));
}

export function fetchWorkingBom(projectCode?: string | null): Promise<{
  rows: WorkingBomRow[];
  projects: string[];
  totals: { rows: number; requiredQty: number; availableForProduction: number; canHandoff: number };
}> {
  return getJson(viewPath('/api/working-bom', projectCode));
}

export function fetchPicking(projectCode?: string | null): Promise<{
  rows: PickingRow[];
  projects: string[];
  totals: { rows: number; canHandoff: number };
}> {
  return getJson(viewPath('/api/picking', projectCode));
}

export function fetchSupply(): Promise<{
  rows: SupplyRow[];
  totals: { rows: number; totalDeficit: number; totalOrdered: number; totalRealDelivery: number };
}> {
  return getJson('/api/supply');
}

export function fetchDashboard(): Promise<{
  rows: DashboardRow[];
  totals: {
    boms: number;
    ready: number;
    onShelf: number;
    awaitingSupply: number;
    withErrors: number;
    positions: number;
  };
}> {
  return getJson('/api/dashboard');
}

export function fetchProjects(): Promise<ProjectsResponse> {
  return getJson<ProjectsResponse>('/api/projects');
}

export function fetchPosition(positionId: string): Promise<PositionDetailResponse> {
  return getJson<PositionDetailResponse>(`/api/positions/${encodeId(positionId)}`);
}

export function fetchPositionHistory(positionId: string): Promise<HistoryResponse> {
  return getJson<HistoryResponse>(`/api/positions/${encodeId(positionId)}/history`);
}

/* Операции по позиции */

export function setOrderedQty(positionId: string, qty: number): Promise<OperationReply> {
  return postOperation<OperationReply>(`/api/positions/${encodeId(positionId)}/ordered`, { qty });
}

export function setExpectedDate(
  positionId: string,
  expectedDate: string | null,
): Promise<OperationReply> {
  return postOperation<OperationReply>(`/api/positions/${encodeId(positionId)}/expected-date`, {
    expectedDate,
  });
}

export function setRealDeliveryQty(positionId: string, qty: number): Promise<OperationReply> {
  return postOperation<OperationReply>(`/api/positions/${encodeId(positionId)}/real-delivery`, {
    qty,
  });
}

export function setRealDeliveryChecked(
  positionId: string,
  checked: boolean,
): Promise<OperationReply> {
  return postOperation<OperationReply>(`/api/positions/${encodeId(positionId)}/real-delivery`, {
    checked,
  });
}

export function setDeadline(positionId: string, deadline: string | null): Promise<OperationReply> {
  return postOperation<OperationReply>(`/api/positions/${encodeId(positionId)}/deadline`, {
    deadline,
  });
}

/**
 * Исправить поле спецификации — лечение «Ошибки данных» после импорта.
 *
 * Значение передаётся «как ввёл пользователь»: проверяет и приводит его сервер,
 * поэтому интерфейс не дублирует правила разбора дат и количеств.
 */
export function setSpecField(
  positionId: string,
  field: string,
  value: string | number | null,
): Promise<OperationReply> {
  return postOperation<OperationReply>(`/api/positions/${encodeId(positionId)}/spec`, {
    field,
    value,
  });
}

/* Передача производству и склад */

export function handoff(
  positionIds: string[],
  source: string,
): Promise<HandoffBatchResult> {
  return postOperation<HandoffBatchResult>('/api/handoff', { positionIds, source });
}

export function returnFromArchive(
  positionIds: string[],
  reason: string,
): Promise<HandoffBatchResult> {
  return postOperation<HandoffBatchResult>('/api/return-from-archive', { positionIds, reason });
}

export function fetchWarehouse(): Promise<WarehouseResponse> {
  return getJson<WarehouseResponse>('/api/warehouse');
}

export function setWarehouseQty(
  materialKey: string,
  quantity: number,
): Promise<{
  materialKey: string;
  previousQty: number;
  warehouseQty: number;
  reservedQty: number;
  freeQty: number;
}> {
  return postJson(`/api/warehouse/${encodeId(materialKey)}`, { quantity });
}

/* Массовая правка: вставка блока ячеек одной командой */

/**
 * Изменение позиции.
 *
 * Значение передаётся ТЕКСТОМ — ровно тем, что было в ячейке. Приводит его сервер:
 * правила разбора дат и количеств живут в одном месте, и интерфейс не повторяет их
 * (иначе «1 234,5» и «20.09.2026» понимались бы по-разному).
 */
export interface PositionBulkChange {
  positionId: string;
  field: string;
  value: string;
}

/** Изменение остатка материала на складе. */
export interface WarehouseBulkChange {
  materialKey: string;
  quantity: string;
}

/**
 * Применить пачку изменений позиций одной командой.
 *
 * Одна команда на всю вставку: сервер выполняет её одной транзакцией и пишет одну
 * запись в журнал. Отказ по отдельной ячейке не отменяет остальные, поэтому и
 * частичный успех приходит обычным результатом — вызывающий код показывает отчёт.
 */
export function applyPositionsBulk(changes: PositionBulkChange[]): Promise<BulkReply> {
  return postOperation<BulkReply>('/api/positions/bulk', { changes });
}

export function applyWarehouseBulk(changes: WarehouseBulkChange[]): Promise<BulkReply> {
  return postOperation<BulkReply>('/api/warehouse/bulk', { changes });
}

/**
 * Вернуть значения, записанные командой (откат операции).
 *
 * Причина обязательна: возврат меняет данные, которыми уже пользуются другие роли,
 * и по журналу должно быть видно, почему это сделано.
 */
export function rollbackOperation(operationId: string, reason: string): Promise<RollbackReply> {
  return postOperation<RollbackReply>(`/api/operations/${encodeId(operationId)}/rollback`, {
    reason,
  });
}

/* Спецификации */

export function fetchBoms(): Promise<{ boms: BomSummary[] }> {
  return getJson<{ boms: BomSummary[] }>('/api/boms');
}

export function fetchBomCard(code: string): Promise<BomCard> {
  return getJson<BomCard>(`/api/boms/${encodeId(code)}`);
}

export function importBom(fileName: string, contentBase64: string): Promise<BomImportReport> {
  return postJson<BomImportReport>('/api/boms/import', { fileName, contentBase64 });
}

export function setBomDone(code: string, done: boolean): Promise<{ bom: BomSummary }> {
  return postJson<{ bom: BomSummary }>(`/api/boms/${encodeId(code)}/done`, { done });
}

export function deleteBom(code: string): Promise<{ deletedPositions: number }> {
  return deleteJson<{ deletedPositions: number }>(`/api/boms/${encodeId(code)}`);
}

/* Администрирование */

export function fetchUsers(): Promise<{ users: UserView[] }> {
  return getJson<{ users: UserView[] }>('/api/admin/users');
}

export function createUser(params: {
  login: string;
  fullName: string;
  role: string;
  password: string;
}): Promise<{ user: UserView }> {
  return postJson<{ user: UserView }>('/api/admin/users', params);
}

export function updateUser(
  userId: number,
  params: { fullName?: string; role?: string; isActive?: boolean; password?: string },
): Promise<{ user: UserView }> {
  return patchJson<{ user: UserView }>(`/api/admin/users/${userId}`, params);
}

export function fetchAudit(limit = 200): Promise<{ events: AuditRecord[] }> {
  return getJson<{ events: AuditRecord[] }>(`/api/admin/audit?limit=${limit}`);
}

export function fetchArchive(limit = 200): Promise<{ rows: ArchiveRecord[] }> {
  return getJson<{ rows: ArchiveRecord[] }>(`/api/archive?limit=${limit}`);
}
