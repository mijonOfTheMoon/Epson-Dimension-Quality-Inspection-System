export type InspectionStatus = 'OK' | 'NG';
export type UserRole = 'operator' | 'qc' | 'supervisor' | 'engineering' | 'admin' | 'vendor';
export type RequestStatus = 'not_requested' | 'requested' | 'in_progress' | 'shipped' | 'received';
export type StationPhase = 'idle' | 'calibrating' | 'ready' | 'stabilizing' | 'locked';
export type InspectionTrigger = 'auto' | 'manual';
export type AgentCommandType = 'start' | 'stop' | 'capture' | 'recalibrate';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  avatar?: string;
}

export interface DimensionSpec {
  id: string;
  name: string;
  nominal: number;
  upperLimit: number;
  lowerLimit: number;
  unit: string;
}

export interface PartType {
  id: string;
  partName: string;
  partCode: string;
  vendor: string;
  dimensions: DimensionSpec[];
}

export interface Measurement {
  dimensionName: string;
  measured: number;
  nominal: number;
  upperLimit: number;
  lowerLimit: number;
  unit: string;
  status: InspectionStatus;
}

export interface InspectionResult {
  id: string;
  partId: string;
  partName: string;
  partCode: string;
  batchNo: string;
  vendor: string;
  operatorId: string;
  operatorName: string;
  timestamp: string;
  status: InspectionStatus;
  shift: 'A' | 'B' | 'C';
  line: string;
  confidenceScore: number;
  measurements: Measurement[];
  trigger?: InspectionTrigger;
}

export interface StatusHistoryEntry {
  status: RequestStatus;
  timestamp: string;
  changedBy: string;
}

export interface QualityTrackingRecord {
  id: string;
  date: string;
  partCode: string;
  partName: string;
  vendor: string;
  totalScanned: number;
  ngCount: number;
  ngRate: number;
  requestStatus: RequestStatus;
  statusHistory: StatusHistoryEntry[];
}

export interface StationStatusEvent {
  eventId: string;
  eventType: 'station.status';
  stationId: string;
  timestamp: string;
  state: 'online' | 'offline';
  fps?: number;
  running?: boolean;
  phase?: StationPhase;
  activePartCode?: string;
  modelVersion?: string;
}

export interface AgentInfo {
  stationId: string;
  online: boolean;
  running: boolean;
  connectedAt: string | null;
}

export interface AuthLoginResponse {
  user: User;
  token: string;
}

export interface InspectionCreatedEvent {
  eventId: string;
  eventType: 'inspection.created';
  stationId: string;
  timestamp: string;
  partId?: string;
  partName: string;
  partCode: string;
  batchNo?: string;
  vendor?: string;
  operatorId?: string;
  operatorName?: string;
  status: InspectionStatus;
  shift?: 'A' | 'B' | 'C';
  line?: string;
  confidenceScore: number;
  measurements: Measurement[];
  modelVersion?: string;
  trigger?: InspectionTrigger;
}

export type RealtimeEvent = InspectionCreatedEvent | StationStatusEvent;

export interface DashboardSummary {
  total: number;
  ok: number;
  ng: number;
  ngRate: number;
  dailyTrend: { date: string; ok: number; ng: number }[];
  stationCount: number;
  activeStationCount: number;
}

export interface AsyncData<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => void;
}
