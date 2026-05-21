import type {
  IngestEvent,
  InspectionCreatedEvent,
  InspectionQuery,
  PartType,
  QualityTrackingRecord,
  RequestStatus,
  Batch,
  ShiftSchedule,
  StationStatusEvent,
  User,
  UserRole,
} from '../domain/types.js';

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

export interface DataStore {
  init(): Promise<void>;
  close?(): Promise<void>;
  ingest(event: IngestEvent): Promise<IngestEvent | null>;
  listInspections(query: InspectionQuery): Promise<InspectionCreatedEvent[]>;
  listStations(): Promise<StationStatusEvent[]>;
  deactivateStation(stationId: string): Promise<StationStatusEvent | null>;
  listParts(): Promise<PartType[]>;
  findPart(partCode: string): Promise<PartType | null>;
  createPart(input: Omit<PartType, 'id'>): Promise<PartType>;
  updatePart(id: string, input: Omit<PartType, 'id'>): Promise<PartType | null>;
  deletePart(id: string): Promise<boolean>;
  listUsers(): Promise<Omit<User, 'password'>[]>;
  findUserByUsername(username: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(input: Omit<User, 'id'>): Promise<Omit<User, 'password'>>;
  updateUser(id: string, input: Partial<Omit<User, 'id'>>): Promise<Omit<User, 'password'> | null>;
  deleteUser(id: string): Promise<boolean>;
  countUsersByRole(role: UserRole): Promise<number>;
  listShiftSchedules(): Promise<ShiftSchedule[]>;
  updateShiftSchedule(id: string, input: Pick<ShiftSchedule, 'label' | 'startTime' | 'endTime' | 'active'>): Promise<ShiftSchedule | null>;
  listBatches(): Promise<Batch[]>;
  openBatch(input: { batchNo: string; partCode: string; shift: 'A' | 'B' | 'C'; targetQty: number }): Promise<Batch>;
  closeBatch(id: string): Promise<Batch | null>;
  getActiveBatch(partCode: string, shift: 'A' | 'B' | 'C'): Promise<Batch | null>;
  listQualityRecords(): Promise<QualityTrackingRecord[]>;
  updateQualityRecordStatus(id: string, status: RequestStatus, changedBy: string): Promise<QualityTrackingRecord | null>;
  getDashboardSummary(): Promise<DashboardSummary>;
}
