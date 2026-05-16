import type {
  IngestEvent,
  InspectionCreatedEvent,
  InspectionQuery,
  PartType,
  QualityAlertEvent,
  QualityTrackingRecord,
  RequestStatus,
  StationStatusEvent,
  StoreState,
  User,
} from '../domain/types.js';

export interface DashboardSummary {
  total: number;
  ok: number;
  ng: number;
  ngRate: number;
  dailyTrend: { date: string; ok: number; ng: number }[];
  stationCount: number;
  activeStationCount: number;
}

export interface DataStore {
  init(): Promise<void>;
  ingest(event: IngestEvent): Promise<IngestEvent | null>;
  listInspections(query: InspectionQuery): Promise<InspectionCreatedEvent[]>;
  listStations(): Promise<StationStatusEvent[]>;
  listAlerts(limit: number): Promise<QualityAlertEvent[]>;
  listParts(): Promise<PartType[]>;
  listUsers(): Promise<User[]>;
  login(username: string, password: string): Promise<User | null>;
  listQualityRecords(): Promise<QualityTrackingRecord[]>;
  updateQualityRecordStatus(id: string, status: RequestStatus, changedBy: string): Promise<QualityTrackingRecord | null>;
  getDashboardSummary(): Promise<DashboardSummary>;
  snapshot(): Promise<StoreState>;
}
