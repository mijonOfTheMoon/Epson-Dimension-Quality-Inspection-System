import type {
  AgentCommandType,
  AgentInfo,
  AuthLoginResponse,
  Batch,
  DashboardSummary,
  DimensionView,
  InspectionCreatedEvent,
  InspectionResult,
  PartType,
  QualityTrackingRecord,
  RequestStatus,
  ShiftSchedule,
  StationStatusEvent,
  User,
  UserRole,
} from '../types/api';

const TOKEN_KEY = 'diminspect_auth_token';
export const AUTH_LOGOUT_EVENT = 'auth:logout';

export const tokenStorage = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token: string) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export function appendAuthToken(url: string): string {
  const token = tokenStorage.get();
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Backend tidak tersedia';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = tokenStorage.get();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...init, headers });

  if (response.status === 401) {
    tokenStorage.clear();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
  }

  if (!response.ok) {
    let message = `Request gagal (${response.status})`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) message = body.message;
    } catch { /* ignore */ }
    throw new ApiRequestError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export function normalizeInspectionEvent(event: InspectionCreatedEvent): InspectionResult {
  return {
    id: event.eventId,
    partId: event.partId ?? event.partCode ?? 'unknown',
    partName: event.partName,
    partCode: event.partCode,
    batchNo: event.batchNo ?? '-',
    vendor: event.vendor ?? '-',
    operatorId: event.operatorId ?? '-',
    operatorName: event.operatorName ?? '-',
    timestamp: event.timestamp,
    status: event.status,
    shift: event.shift ?? 'A',
    stationId: event.stationId,
    confidenceScore: event.confidenceScore ?? 0,
    measurements: event.measurements ?? [],
    detections: event.detections ?? [],
    trigger: event.trigger,
  };
}

interface AgentCommandResponse {
  stationId: string;
  command: AgentCommandType;
  delivered: true;
}

export const api = {
  login(username: string, password: string) {
    return request<AuthLoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  me() {
    return request<User>('/api/auth/me');
  },
  logout() {
    return request<void>('/api/auth/logout', { method: 'POST' });
  },
  getUsers() {
    return request<User[]>('/api/users');
  },
  getParts() {
    return request<PartType[]>('/api/parts');
  },
  createPart(input: Omit<PartType, 'id'>) {
    return request<PartType>('/api/parts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updatePart(id: string, input: Omit<PartType, 'id'>) {
    return request<PartType>(`/api/parts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  deletePart(id: string) {
    return request<void>(`/api/parts/${id}`, { method: 'DELETE' });
  },
  getShiftSchedules() {
    return request<ShiftSchedule[]>('/api/shift-schedules');
  },
  updateShiftSchedule(id: string, input: Pick<ShiftSchedule, 'label' | 'startTime' | 'endTime' | 'active'>) {
    return request<ShiftSchedule>(`/api/shift-schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  getBatches() {
    return request<Batch[]>('/api/batches');
  },
  openBatch(input: { batchNo: string; partCode: string; shift: 'A' | 'B' | 'C'; targetQty: number }) {
    return request<Batch>('/api/batches', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  closeBatch(id: string) {
    return request<Batch>(`/api/batches/${id}/close`, { method: 'PATCH' });
  },
  async getInspections(params: { limit?: number; status?: 'OK' | 'NG'; partCode?: string } = {}) {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.partCode) query.set('partCode', params.partCode);
    const suffix = query.size ? `?${query.toString()}` : '';
    const data = await request<InspectionCreatedEvent[]>(`/api/inspections${suffix}`);
    return data.map(normalizeInspectionEvent);
  },
  getStations() {
    return request<StationStatusEvent[]>('/api/stations');
  },
  getQualityRecords() {
    return request<QualityTrackingRecord[]>('/api/quality-records');
  },
  updateQualityStatus(id: string, status: RequestStatus) {
    return request<QualityTrackingRecord>(`/api/quality-records/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
  getDashboardSummary() {
    return request<DashboardSummary>('/api/dashboard/summary');
  },
  getAgents() {
    return request<AgentInfo[]>('/api/agents');
  },
  deleteStation(stationId: string) {
    return request<void>(`/api/stations/${encodeURIComponent(stationId)}`, { method: 'DELETE' });
  },
  startAgent(stationId: string, partCode: string, shift?: 'A' | 'B' | 'C', batchNo?: string, inspectionView: DimensionView = 'top') {
    return request<AgentCommandResponse>(
      `/api/agents/${encodeURIComponent(stationId)}/command`,
      { method: 'POST', body: JSON.stringify({ command: 'start', partCode, shift, batchNo, inspectionView }) },
    );
  },
  stopAgent(stationId: string) {
    return request<AgentCommandResponse>(
      `/api/agents/${encodeURIComponent(stationId)}/command`,
      { method: 'POST', body: JSON.stringify({ command: 'stop' }) },
    );
  },
  captureNow(stationId: string, inspectionView?: DimensionView) {
    return request<AgentCommandResponse>(
      `/api/agents/${encodeURIComponent(stationId)}/command`,
      { method: 'POST', body: JSON.stringify({ command: 'capture', inspectionView }) },
    );
  },
  recalibrate(stationId: string) {
    return request<AgentCommandResponse>(
      `/api/agents/${encodeURIComponent(stationId)}/command`,
      { method: 'POST', body: JSON.stringify({ command: 'recalibrate' }) },
    );
  },
  createUser(input: { username: string; password: string; name: string; role: UserRole; avatar?: string }) {
    return request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateUser(id: string, input: { username: string; password?: string; name: string; role: UserRole; avatar?: string }) {
    return request<User>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  deleteUser(id: string) {
    return request<void>(`/api/users/${id}`, { method: 'DELETE' });
  },
};
