import type {
  IngestEvent,
  InspectionCreatedEvent,
  InspectionQuery,
  QualityAlertEvent,
  QualityTrackingRecord,
  RequestStatus,
  StationStatusEvent,
  StoreState,
  User,
} from '../domain/types.js';
import type { DashboardSummary, DataStore } from './store.js';
import { seedState } from './seed.js';

export class MemoryStore implements DataStore {
  protected state: StoreState = structuredClone(seedState);
  private readonly seenEventIds = new Set<string>();

  async init() {
    this.rebuildEventIndex();
  }

  async ingest(event: IngestEvent) {
    if (this.seenEventIds.has(event.eventId)) return null;
    this.seenEventIds.add(event.eventId);

    if (event.eventType === 'inspection.created') {
      this.state.inspections.unshift(event);
      this.updateQualityRecord(event);
    } else if (event.eventType === 'station.status') {
      this.upsertStation(event);
    } else {
      this.state.alerts.unshift(event);
    }

    await this.persist();
    return event;
  }

  async listInspections(query: InspectionQuery) {
    const limit = Math.min(query.limit ?? 100, 1000);
    const result: InspectionCreatedEvent[] = [];

    for (const item of this.state.inspections) {
      if (query.status && item.status !== query.status) continue;
      if (query.partCode && item.partCode !== query.partCode) continue;
      result.push(item);
      if (result.length >= limit) break;
    }

    return result;
  }

  async listStations() {
    return this.state.stations;
  }

  async listAlerts(limit: number) {
    return this.state.alerts.slice(0, Math.min(limit, 500));
  }

  async listParts() {
    return this.state.parts;
  }

  async listUsers() {
    return this.state.users;
  }

  async login(username: string, password: string) {
    return this.state.users.find((user) => user.username === username && user.password === password) ?? null;
  }

  async listQualityRecords() {
    return this.state.qualityRecords;
  }

  async updateQualityRecordStatus(id: string, status: RequestStatus, changedBy: string) {
    const record = this.state.qualityRecords.find((item) => item.id === id);
    if (!record) return null;

    record.requestStatus = status;
    record.statusHistory.push({ status, timestamp: new Date().toISOString(), changedBy });
    await this.persist();
    return record;
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    let ok = 0;
    let ng = 0;
    const daily = new Map<string, { date: string; ok: number; ng: number }>();

    for (const item of this.state.inspections) {
      if (item.status === 'OK') ok += 1;
      else ng += 1;

      const date = item.timestamp.slice(0, 10);
      let bucket = daily.get(date);
      if (!bucket) {
        bucket = { date, ok: 0, ng: 0 };
        daily.set(date, bucket);
      }
      if (item.status === 'OK') bucket.ok += 1;
      else bucket.ng += 1;
    }

    const total = ok + ng;
    const activeStationCount = this.state.stations.filter((station) => station.state === 'online').length;

    return {
      total,
      ok,
      ng,
      ngRate: total > 0 ? Number(((ng / total) * 100).toFixed(1)) : 0,
      dailyTrend: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      stationCount: this.state.stations.length,
      activeStationCount,
    };
  }

  async snapshot() {
    return this.state;
  }

  protected async persist() {}

  protected loadState(state: StoreState) {
    this.state = state;
    this.rebuildEventIndex();
  }

  private rebuildEventIndex() {
    this.seenEventIds.clear();
    for (const event of this.state.inspections) this.seenEventIds.add(event.eventId);
    for (const event of this.state.stations) this.seenEventIds.add(event.eventId);
    for (const event of this.state.alerts) this.seenEventIds.add(event.eventId);
  }

  private upsertStation(event: StationStatusEvent) {
    const index = this.state.stations.findIndex((item) => item.stationId === event.stationId);
    if (index >= 0) this.state.stations[index] = event;
    else this.state.stations.unshift(event);
  }

  private updateQualityRecord(event: InspectionCreatedEvent) {
    const date = event.timestamp.slice(0, 10);
    const key = `${date}:${event.partCode}`;
    let record = this.state.qualityRecords.find((item) => `${item.date}:${item.partCode}` === key);

    if (!record) {
      record = {
        id: `QT-${date}-${event.partCode}`,
        date,
        partCode: event.partCode,
        partName: event.partName,
        vendor: event.vendor ?? '-',
        totalScanned: 0,
        ngCount: 0,
        ngRate: 0,
        requestStatus: 'not_requested',
        statusHistory: [{ status: 'not_requested', timestamp: event.timestamp, changedBy: 'System' }],
      };
      this.state.qualityRecords.unshift(record);
    }

    record.totalScanned += 1;
    if (event.status === 'NG') record.ngCount += 1;
    record.ngRate = Number(((record.ngCount / record.totalScanned) * 100).toFixed(1));
  }
}
