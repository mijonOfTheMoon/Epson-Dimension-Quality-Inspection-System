import type {
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
const API_BASE_URL = env?.VITE_API_URL ?? 'http://localhost:4000';

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `Request gagal (${response.status})`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) message = body.message;
    } catch {}
    throw new ApiRequestError(message, response.status);
  }
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
    ngAction: event.ngAction ?? null,
  };
}

export const api = {
  login(username: string, password: string) {
    return request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
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
};
