import type {
  AgentCommandResponse,
  AgentInfo,
  AuthLoginResponse,
  CloudflareSessionDescription,
  DashboardSummary,
  DimensionView,
  InspectionCreatedEvent,
  InspectionResult,
  PartType,
  QualityTrackingRecord,
  RequestStatus,
  StationStatusEvent,
  User,
  UserRole,
  VideoTrackPullResponse,
  VideoViewerSession,
} from '$lib/types/api';

const TOKEN_KEY = 'diminspect_auth_token';
export const AUTH_LOGOUT_EVENT = 'auth:logout';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export const tokenStorage = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token: string) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { }
  },
};

export class ApiRequestError extends Error {
  status?: number;
  retryAfterMs?: number;
  hasJsonBody: boolean;

  constructor(message: string, status?: number, retryAfterMs?: number, hasJsonBody = false) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.hasJsonBody = hasJsonBody;
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Backend tidak tersedia';
}

export const POLLING_TIMEOUT_MS = 30000;

export interface RequestOptions {
  timeoutMs?: number;
}

async function request<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
  const token = tokenStorage.get();
  const body = init?.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;
  const headers: Record<string, string> = {
    ...(isFormData || isBlob ? {} : { 'Content-Type': 'application/json' }),
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutMs = options?.timeoutMs;
  let signal = init?.signal ?? undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal });

    if (response.status === 401) {
      tokenStorage.clear();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
    }

    if (!response.ok) {
      let message = `Request gagal (${response.status})`;
      let hasJsonBody = false;
      try {
        const body = await response.json() as { message?: string };
        if (body.message) {
          message = body.message;
          hasJsonBody = true;
        }
      } catch { }
      throw new ApiRequestError(
        message,
        response.status,
        parseRetryAfter(response.headers.get('Retry-After')),
        hasJsonBody,
      );
    }

    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

export function normalizeInspectionEvent(event: InspectionCreatedEvent): InspectionResult {
  return {
    id: event.eventId,
    partName: event.partName,
    partCode: event.partCode,
    vendor: event.vendor ?? '-',
    operatorName: event.operatorName ?? '-',
    timestamp: event.timestamp,
    status: event.status,
    stationId: event.stationId,
    confidenceScore: event.confidenceScore ?? 0,
    measurements: event.measurements ?? [],
    detections: event.detections ?? [],
    frameUrl: event.frameUrl,
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
  async getInspections(params: { limit?: number; status?: 'OK' | 'NG'; partCode?: string; includeDetections?: boolean } = {}) {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.partCode) query.set('partCode', params.partCode);
    if (params.includeDetections) query.set('includeDetections', 'true');
    const suffix = query.size ? `?${query.toString()}` : '';
    const data = await request<InspectionCreatedEvent[]>(`/api/inspections${suffix}`, undefined, { timeoutMs: POLLING_TIMEOUT_MS });
    return data.map(normalizeInspectionEvent);
  },
  async getInspectionDetail(eventId: string) {
    const data = await request<InspectionCreatedEvent>(
      `/api/inspections/${encodeURIComponent(eventId)}`
    );
    return normalizeInspectionEvent(data);
  },
  refreshFrameUrl(eventId: string) {
    return request<{ frameUrl: string }>(
      `/api/inspections/${encodeURIComponent(eventId)}/frame/refresh-url`,
      { method: 'POST' },
    );
  },
  getStations() {
    return request<StationStatusEvent[]>('/api/stations', undefined, { timeoutMs: POLLING_TIMEOUT_MS });
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
    return request<DashboardSummary>('/api/dashboard/summary', undefined, { timeoutMs: POLLING_TIMEOUT_MS });
  },
  getAgents() {
    return request<AgentInfo[]>('/api/agents', undefined, { timeoutMs: POLLING_TIMEOUT_MS });
  },
  deleteStation(stationId: string) {
    return request<void>(`/api/stations/${encodeURIComponent(stationId)}`, { method: 'DELETE' });
  },
  startAgent(stationId: string, partCode: string, inspectionView: DimensionView = 'top') {
    return request<AgentCommandResponse>(
      `/api/agents/${encodeURIComponent(stationId)}/command`,
      { method: 'POST', body: JSON.stringify({ command: 'start', partCode, inspectionView }) },
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
  createVideoViewerSession(stationId: string, sessionDescription: CloudflareSessionDescription) {
    return request<VideoViewerSession>(
      `/api/video/stations/${encodeURIComponent(stationId)}/viewer-session`,
      { method: 'POST', body: JSON.stringify({ sessionDescription }) },
    );
  },
  pullVideoTrack(viewerSessionId: string, publisherSessionId: string, trackName: string) {
    return request<VideoTrackPullResponse>(
      `/api/video/cloudflare/sessions/${encodeURIComponent(viewerSessionId)}/tracks/pull`,
      { method: 'POST', body: JSON.stringify({ publisherSessionId, trackName }) },
    );
  },
  renegotiateVideoSession(path: string, sessionDescription: CloudflareSessionDescription) {
    return request<unknown>(path, {
      method: 'PUT',
      body: JSON.stringify({ sessionDescription }),
    });
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
  uploadAvatar(file: Blob) {
    const fd = new FormData();
    fd.append('file', file, 'avatar.jpg');
    return request<{ objectKey: string }>('/api/users/avatar', { method: 'POST', body: fd });
  },
};
