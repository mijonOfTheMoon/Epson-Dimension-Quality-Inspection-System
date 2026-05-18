export type InspectionStatus = 'OK' | 'NG';
export type UserRole = 'operator' | 'qc' | 'supervisor' | 'engineering' | 'admin' | 'vendor';
export type RequestStatus = 'not_requested' | 'requested' | 'in_progress' | 'shipped' | 'received';

export interface Measurement {
  dimensionName: string;
  measured: number;
  nominal: number;
  upperLimit: number;
  lowerLimit: number;
  unit: string;
  status: InspectionStatus;
}

export interface InspectionCreatedEvent {
  eventId: string;
  eventType: 'inspection.created';
  stationId: string;
  cameraId?: string;
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
  imageUrl?: string;
  modelVersion?: string;
}

export interface StationStatusEvent {
  eventId: string;
  eventType: 'station.status';
  stationId: string;
  cameraId?: string;
  timestamp: string;
  state: 'online' | 'offline' | 'degraded';
  fps?: number;
  running?: boolean;
  modelVersion?: string;
  message?: string;
}

export interface QualityAlertEvent {
  eventId: string;
  eventType: 'quality.alert';
  stationId: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  inspectionId?: string;
  partCode?: string;
}

export type IngestEvent = InspectionCreatedEvent | StationStatusEvent | QualityAlertEvent;

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

export interface InspectionQuery {
  limit?: number;
  status?: InspectionStatus;
  partCode?: string;
}
