export type InspectionStatus = 'OK' | 'NG';
export type MeasurementStatus = InspectionStatus | 'UNREADABLE';
export type UserRole = 'operator' | 'qc' | 'supervisor' | 'engineering' | 'admin' | 'vendor';
export type RequestStatus = 'not_requested' | 'requested' | 'in_progress' | 'shipped' | 'received';
export type StationPhase = 'idle' | 'calibrating' | 'ready';
export type AgentCommandType = 'start' | 'stop' | 'recalibrate';
export type DimensionView = 'top' | 'side';
export type DimensionKind = 'width' | 'length' | 'diameter' | 'inner_diameter';

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
  kind: DimensionKind;
  view: DimensionView;
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
  status: MeasurementStatus;
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
  polygon: [number, number][];
}

export interface InspectionResult {
  id: string;
  partName: string;
  partCode: string;
  vendor: string;
  operatorName: string;
  timestamp: string;
  status: InspectionStatus;
  stationId: string;
  confidenceScore: number;
  measurements: Measurement[];
  detections: ObjectDetection[];
  frameUrl?: string;
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
  isActive?: boolean;
  detections?: ObjectDetection[];
}

export interface MqttWsInfo {
  url: string;
  username: string;
  password: string;
  presenceTopic: string;
  inspectionTopic: string;
}

export type VideoTransport = 'ws' | 'cloudflare';

export interface RealtimeConfig {
  videoTransport: VideoTransport;
}

export type ShareChannel = 'telegram' | 'email' | 'discord' | 'whatsapp';

export interface ShareRecapFilters {
  search?: string;
  status?: InspectionStatus;
  partCode?: string;
  from?: string;
  to?: string;
}

export interface ShareRecapRequest {
  channels: ShareChannel[];
  emailRecipients: string[];
  filters: ShareRecapFilters;
}

export interface ShareRecapResult {
  results: Record<string, { ok: boolean; error?: string }>;
}

export interface AgentCommandResponse {
  stationId: string;
  command: AgentCommandType;
  commandId: string;
  delivery: 'published';
  delivered: true;
}

export interface CloudflareSessionDescription {
  sdp: string;
  type: RTCSdpType;
}

export interface VideoViewerSession {
  stationId: string;
  provider: 'cloudflare-realtime';
  appId: string;
  viewerSessionId: string;
  publisherSessionId: string;
  trackName: string;
  sessionDescription?: CloudflareSessionDescription;
  requiresImmediateRenegotiation: boolean;
  renegotiatePath: string;
  iceServers: RTCIceServer[];
}

export interface VideoTrackPullResponse {
  requiresImmediateRenegotiation: boolean;
  sessionDescription?: CloudflareSessionDescription;
  tracks: unknown[];
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
  vendor?: string;
  operatorId?: string;
  operatorName?: string;
  status: InspectionStatus;
  confidenceScore: number;
  measurements: Measurement[];
  detections: ObjectDetection[];
  frameObjectKey?: string;
  frameUrl?: string;
  frameUploadedAt?: string;
}

export interface DashboardSummary {
  total: number;
  ok: number;
  ng: number;
  ngRate: number;
  dailyTrend: { date: string; ok: number; ng: number }[];
  problemParts: {
    partCode: string;
    partName: string;
    vendor?: string;
    total: number;
    ng: number;
    ngRate: number;
    dimensions: {
      dimensionName: string;
      unit: string;
      ngCount: number;
      unreadableCount: number;
      totalCount: number;
      ngRate: number;
      nominal: number;
      upperLimit: number;
      lowerLimit: number;
      avgMeasured: number;
    }[];
  }[];
  recentInspections: {
    id: string;
    timestamp: string;
    stationId: string;
    partCode: string;
    partName: string;
    status: InspectionStatus;
    confidenceScore: number;
  }[];
}
