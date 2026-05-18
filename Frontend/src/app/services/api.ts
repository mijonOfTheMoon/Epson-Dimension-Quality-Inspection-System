import type {
  AgentInfo,
  AuthLoginResponse,
  DashboardSummary,
  InspectionCreatedEvent,
  InspectionResult,
  PartType,
  QualityAlertEvent,
  QualityTrackingRecord,
  RequestStatus,
  StationStatusEvent,
  User,
} from '../types/api';

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const API_BASE_URL = env?.VITE_API_URL ?? 'http://localhost:4000';

export function resolveWsUrl(explicit: string | undefined, fallbackPath: string): string {
  if (explicit) {
    if (explicit.startsWith('ws://') || explicit.startsWith('wss://')) return explicit;
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}${explicit.startsWith('/') ? explicit : `/${explicit}`}`;
    }
    return explicit;
  }
  if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
    return API_BASE_URL.replace(/^http/, 'ws') + fallbackPath;
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${fallbackPath}`;
  }
  return fallbackPath;
}

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

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

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
    line: event.line ?? event.stationId ?? '-',
    confidenceScore: event.confidenceScore ?? 0,
    measurements: event.measurements ?? [],
    imageUrl: event.imageUrl,
  };
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
  getAlerts(limit = 50) {
    return request<QualityAlertEvent[]>(`/api/alerts?limit=${limit}`);
  },
  getQualityRecords() {
    return request<QualityTrackingRecord[]>('/api/quality-records');
  },
  updateQualityStatus(id: string, status: RequestStatus, changedBy: string) {
    return request<QualityTrackingRecord>(`/api/quality-records/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, changedBy }),
    });
  },
  getDashboardSummary() {
    return request<DashboardSummary>('/api/dashboard/summary');
  },
  getAgents() {
    return request<AgentInfo[]>('/api/agents');
  },
  startAgent(stationId: string) {
    return request<{ stationId: string; command: 'start'; delivered: true }>(
      `/api/agents/${encodeURIComponent(stationId)}/command`,
      { method: 'POST', body: JSON.stringify({ command: 'start' }) },
    );
  },
  stopAgent(stationId: string) {
    return request<{ stationId: string; command: 'stop'; delivered: true }>(
      `/api/agents/${encodeURIComponent(stationId)}/command`,
      { method: 'POST', body: JSON.stringify({ command: 'stop' }) },
    );
  },
};
