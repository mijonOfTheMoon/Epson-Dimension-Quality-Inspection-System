export type InspectionStatus = 'OK' | 'NG';
export type UserRole = 'operator' | 'qc' | 'supervisor' | 'engineering' | 'admin' | 'vendor';
export type RequestStatus = 'not_requested' | 'requested' | 'in_progress' | 'shipped' | 'received';
export type StationPhase = 'idle' | 'calibrating' | 'ready' | 'stabilizing' | 'locked';
export type InspectionTrigger = 'manual';

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

export type IngestEvent = InspectionCreatedEvent | StationStatusEvent;

export interface PartType {
  id: string;
  partName: string;
  partCode: string;
  vendor: string;
  dimensions: DimensionSpec[];
}

export interface DimensionSpec {
  id: string;
  name: string;
  nominal: number;
  upperLimit: number;
  lowerLimit: number;
  unit: string;
}

export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  avatar?: string;
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

export interface InspectionQuery {
  limit?: number;
  status?: InspectionStatus;
  partCode?: string;
}
