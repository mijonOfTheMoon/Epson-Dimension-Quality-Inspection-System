import {
  inspectionResults,
  partTypes,
  qualityTrackingRecords,
  users,
  type InspectionResult,
  type PartType,
  type QualityTrackingRecord,
  type RequestStatus,
  type User,
} from '../data/mock-data';

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const API_BASE_URL = env?.VITE_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, init: RequestInit | undefined, fallback: () => T): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json() as T;
  } catch {
    return fallback();
  }
}

export function normalizeInspectionEvent(event: any): InspectionResult {
  return {
    id: event.id ?? event.eventId,
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
    return request<User | null>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }, () => users.find((user) => user.username === username && user.password === password) ?? null);
  },
  getUsers() {
    return request<User[]>('/api/users', undefined, () => users);
  },
  getParts() {
    return request<PartType[]>('/api/parts', undefined, () => partTypes);
  },
  async getInspections(params: { limit?: number; status?: 'OK' | 'NG'; partCode?: string } = {}) {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.partCode) query.set('partCode', params.partCode);
    const suffix = query.size ? `?${query.toString()}` : '';
    const data = await request<any[]>(`/api/inspections${suffix}`, undefined, () => inspectionResults);
    return data.map(normalizeInspectionEvent);
  },
  getQualityRecords() {
    return request<QualityTrackingRecord[]>('/api/quality-records', undefined, () => JSON.parse(JSON.stringify(qualityTrackingRecords)));
  },
  updateQualityStatus(id: string, status: RequestStatus, changedBy: string) {
    return request<QualityTrackingRecord | null>(`/api/quality-records/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, changedBy }),
    }, () => null);
  },
};
