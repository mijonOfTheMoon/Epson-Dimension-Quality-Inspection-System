export type InspectionStatus = 'OK' | 'NG';
export type UserRole = 'operator' | 'qc' | 'supervisor' | 'engineering' | 'admin' | 'vendor';
export type RequestStatus = 'not_requested' | 'requested' | 'in_progress' | 'shipped' | 'received';
export type StationPhase = 'idle' | 'calibrating' | 'ready' | 'stabilizing' | 'locked';
export type InspectionTrigger = 'manual';
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

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObjectDetection {
  id: string;
  label: string;
  bbox: BoundingBox;
  status: InspectionStatus;
  confidenceScore: number;
  measurements: Measurement[];
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
  stationId: string;
  confidenceScore: number;
  measurements: Measurement[];
  detections: ObjectDetection[];
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
  confidenceScore: number;
  measurements: Measurement[];
  detections: ObjectDetection[];
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
  stationTrend: { stationId: string; ok: number; ng: number; ngRate: number }[];
  partPareto: { partCode: string; partName: string; ok: number; ng: number; total: number; ngRate: number }[];
  shiftSummary: { shift: 'A' | 'B' | 'C'; ok: number; ng: number; total: number; ngRate: number }[];
  measurementDrift: { dimensionName: string; avgMeasured: number; nominal: number; delta: number; unit: string }[];
}

export interface ShiftSchedule {
  id: string;
  shift: 'A' | 'B' | 'C';
  label: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

export interface Batch {
  id: string;
  batchNo: string;
  partCode: string;
  partName: string;
  shift: 'A' | 'B' | 'C';
  status: 'open' | 'closed';
  targetQty: number;
  actualQty: number;
  createdAt: string;
  closedAt?: string;
}

export interface AsyncData<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => void;
}
