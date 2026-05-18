import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from '../config/env.js';
import type {
  IngestEvent,
  InspectionCreatedEvent,
  InspectionQuery,
  InspectionStatus,
  PartType,
  QualityAlertEvent,
  QualityTrackingRecord,
  RequestStatus,
  StationStatusEvent,
  User,
} from '../domain/types.js';
import type { DashboardSummary, DataStore } from './store.js';

const SEED_USERS: User[] = [
  { id: 'u-001', username: 'admin', password: 'admin123', name: 'Administrator', role: 'admin' },
  { id: 'u-002', username: 'supervisor', password: 'super123', name: 'Budi Santoso', role: 'supervisor' },
  { id: 'u-003', username: 'qc1', password: 'qc123', name: 'Sari Dewi', role: 'qc' },
  { id: 'u-004', username: 'operator1', password: 'op123', name: 'Andi Pratama', role: 'operator' },
  { id: 'u-005', username: 'vendor1', password: 'ven123', name: 'PT. Maju Jaya', role: 'vendor' },
];

const SEED_PARTS = [
  {
    id: 'p-001',
    partName: 'Rotor Disc Brake',
    partCode: 'RDB-001',
    vendor: 'PT. Maju Jaya',
    dimensions: [
      { id: 'd-001', name: 'Diameter', nominal: 280, upperLimit: 280.5, lowerLimit: 279.5, unit: 'mm' },
      { id: 'd-002', name: 'Thickness', nominal: 22, upperLimit: 22.3, lowerLimit: 21.7, unit: 'mm' },
    ],
  },
  {
    id: 'p-002',
    partName: 'Brake Pad Set',
    partCode: 'BPS-002',
    vendor: 'PT. Maju Jaya',
    dimensions: [
      { id: 'd-003', name: 'Width', nominal: 55, upperLimit: 55.4, lowerLimit: 54.6, unit: 'mm' },
      { id: 'd-004', name: 'Height', nominal: 42, upperLimit: 42.3, lowerLimit: 41.7, unit: 'mm' },
    ],
  },
];

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS event_log (
        event_id text PRIMARY KEY,
        event_type text NOT NULL,
        station_id text NOT NULL,
        timestamp timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        username text NOT NULL UNIQUE,
        password text NOT NULL,
        name text NOT NULL,
        role text NOT NULL,
        avatar text
      );

      CREATE TABLE IF NOT EXISTS parts (
        id text PRIMARY KEY,
        part_name text NOT NULL,
        part_code text NOT NULL UNIQUE,
        vendor text NOT NULL,
        dimensions jsonb NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inspections (
        event_id text PRIMARY KEY REFERENCES event_log(event_id) ON DELETE CASCADE,
        station_id text NOT NULL,
        camera_id text,
        timestamp timestamptz NOT NULL,
        part_id text,
        part_name text NOT NULL,
        part_code text NOT NULL,
        batch_no text,
        vendor text,
        operator_id text,
        operator_name text,
        status text NOT NULL CHECK (status IN ('OK', 'NG')),
        shift text,
        line text,
        confidence_score double precision NOT NULL,
        measurements jsonb NOT NULL,
        image_url text,
        model_version text
      );

      CREATE TABLE IF NOT EXISTS stations (
        station_id text PRIMARY KEY,
        event_id text NOT NULL REFERENCES event_log(event_id) ON DELETE CASCADE,
        camera_id text,
        timestamp timestamptz NOT NULL,
        state text NOT NULL CHECK (state IN ('online', 'offline', 'degraded')),
        fps double precision,
        model_version text,
        message text
      );

      CREATE TABLE IF NOT EXISTS alerts (
        event_id text PRIMARY KEY REFERENCES event_log(event_id) ON DELETE CASCADE,
        station_id text NOT NULL,
        timestamp timestamptz NOT NULL,
        severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
        message text NOT NULL,
        inspection_id text,
        part_code text
      );

      CREATE TABLE IF NOT EXISTS quality_records (
        id text PRIMARY KEY,
        date date NOT NULL,
        part_code text NOT NULL,
        part_name text NOT NULL,
        vendor text NOT NULL,
        total_scanned integer NOT NULL DEFAULT 0,
        ng_count integer NOT NULL DEFAULT 0,
        ng_rate numeric(6, 2) NOT NULL DEFAULT 0,
        request_status text NOT NULL,
        status_history jsonb NOT NULL,
        UNIQUE (date, part_code)
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_inspections_timestamp ON inspections(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_inspections_status_part ON inspections(status, part_code);
      CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_quality_records_date ON quality_records(date DESC);
    `,
  },
  {
    version: 2,
    sql: `
      -- Drop legacy payload columns that duplicated data already stored in typed columns
      ALTER TABLE event_log    DROP COLUMN IF EXISTS payload;
      ALTER TABLE inspections  DROP COLUMN IF EXISTS payload;
      ALTER TABLE stations     DROP COLUMN IF EXISTS payload;
      ALTER TABLE stations     DROP COLUMN IF EXISTS queue_size;
      ALTER TABLE alerts       DROP COLUMN IF EXISTS payload;
    `,
  },
];

interface InspectionRow {
  event_id: string;
  station_id: string;
  camera_id: string | null;
  timestamp: string | Date;
  part_id: string | null;
  part_name: string;
  part_code: string;
  batch_no: string | null;
  vendor: string | null;
  operator_id: string | null;
  operator_name: string | null;
  status: InspectionStatus;
  shift: 'A' | 'B' | 'C' | null;
  line: string | null;
  confidence_score: number;
  measurements: unknown;
  image_url: string | null;
  model_version: string | null;
}

interface StationRow {
  event_id: string;
  station_id: string;
  camera_id: string | null;
  timestamp: string | Date;
  state: 'online' | 'offline' | 'degraded';
  fps: number | null;
  model_version: string | null;
  message: string | null;
}

interface AlertRow {
  event_id: string;
  station_id: string;
  timestamp: string | Date;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  inspection_id: string | null;
  part_code: string | null;
}

interface PartRow {
  id: string;
  part_name: string;
  part_code: string;
  vendor: string;
  dimensions: unknown;
}

interface QualityRecordRow {
  id: string;
  date: string | Date;
  part_code: string;
  part_name: string;
  vendor: string;
  total_scanned: number;
  ng_count: number;
  ng_rate: string | number;
  request_status: RequestStatus;
  status_history: unknown;
}

export class PostgresStore implements DataStore {
  private readonly pool: Pool;

  constructor(config: AppConfig) {
    if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init() {
    await this.migrate();
    await this.seedStaticData();
  }

  async close() {
    await this.pool.end();
  }

  async ingest(event: IngestEvent) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const logged = await this.insertEventLog(client, event);
      if (!logged) {
        await client.query('COMMIT');
        return null;
      }

      if (event.eventType === 'inspection.created') await this.insertInspection(client, event);
      else if (event.eventType === 'station.status') await this.upsertStation(client, event);
      else await this.insertAlert(client, event);

      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listInspections(query: InspectionQuery) {
    const limit = Math.min(query.limit ?? 100, 1000);
    const result = await this.pool.query<InspectionRow>(
      `SELECT * FROM inspections
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR part_code = $2)
       ORDER BY timestamp DESC
       LIMIT $3`,
      [query.status ?? null, query.partCode ?? null, limit],
    );
    return result.rows.map(mapInspection);
  }

  async listStations() {
    const result = await this.pool.query<StationRow>('SELECT * FROM stations ORDER BY timestamp DESC');
    return result.rows.map(mapStation);
  }

  async listAlerts(limit: number) {
    const result = await this.pool.query<AlertRow>('SELECT * FROM alerts ORDER BY timestamp DESC LIMIT $1', [Math.min(limit, 500)]);
    return result.rows.map(mapAlert);
  }

  async listParts() {
    const result = await this.pool.query<PartRow>('SELECT * FROM parts ORDER BY part_code ASC');
    return result.rows.map(mapPart);
  }

  async listUsers(): Promise<Omit<User, 'password'>[]> {
    const result = await this.pool.query<Omit<User, 'password'>>(
      'SELECT id, username, name, role, avatar FROM users ORDER BY name ASC',
    );
    return result.rows;
  }

  async login(username: string, password: string) {
    const result = await this.pool.query<User>(
      'SELECT id, username, password, name, role, avatar FROM users WHERE username = $1 AND password = $2 LIMIT 1',
      [username, password],
    );
    return result.rows[0] ?? null;
  }

  async listQualityRecords() {
    const result = await this.pool.query<QualityRecordRow>('SELECT * FROM quality_records ORDER BY date DESC, part_code ASC');
    return result.rows.map(mapQualityRecord);
  }

  async updateQualityRecordStatus(id: string, status: RequestStatus, changedBy: string) {
    const entry = [{ status, timestamp: new Date().toISOString(), changedBy }];
    const result = await this.pool.query<QualityRecordRow>(
      `UPDATE quality_records
       SET request_status = $2, status_history = status_history || $3::jsonb
       WHERE id = $1
       RETURNING *`,
      [id, status, JSON.stringify(entry)],
    );
    return result.rows[0] ? mapQualityRecord(result.rows[0]) : null;
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    const counts = await this.pool.query<{ status: InspectionStatus; count: string }>(
      'SELECT status, COUNT(*)::bigint AS count FROM inspections GROUP BY status',
    );
    const trend = await this.pool.query<{ date: string; ok: string; ng: string }>(
      `SELECT to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
              COUNT(*) FILTER (WHERE status = 'OK')::bigint AS ok,
              COUNT(*) FILTER (WHERE status = 'NG')::bigint AS ng
       FROM inspections
       GROUP BY date
       ORDER BY date ASC`,
    );
    const stations = await this.pool.query<{ total: string; active: string }>(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE state = 'online')::bigint AS active
       FROM stations`,
    );

    const ok = Number(counts.rows.find((row) => row.status === 'OK')?.count ?? 0);
    const ng = Number(counts.rows.find((row) => row.status === 'NG')?.count ?? 0);
    const total = ok + ng;

    return {
      total,
      ok,
      ng,
      ngRate: total > 0 ? Number(((ng / total) * 100).toFixed(1)) : 0,
      dailyTrend: trend.rows.map((row) => ({ date: row.date, ok: Number(row.ok), ng: Number(row.ng) })),
      stationCount: Number(stations.rows[0]?.total ?? 0),
      activeStationCount: Number(stations.rows[0]?.active ?? 0),
    };
  }

  private async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const applied = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
      const appliedVersions = new Set(applied.rows.map((row) => row.version));

      for (const migration of migrations) {
        if (appliedVersions.has(migration.version)) continue;
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
        await client.query('COMMIT');
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async seedStaticData() {
    const userCount = await this.pool.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM users');
    if (Number(userCount.rows[0]?.count ?? 0) === 0) {
      for (const user of SEED_USERS) {
        await this.pool.query(
          `INSERT INTO users (id, username, password, name, role, avatar)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [user.id, user.username, user.password, user.name, user.role, user.avatar ?? null],
        );
      }
    }

    const partCount = await this.pool.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM parts');
    if (Number(partCount.rows[0]?.count ?? 0) === 0) {
      for (const part of SEED_PARTS) {
        await this.pool.query(
          `INSERT INTO parts (id, part_name, part_code, vendor, dimensions)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [part.id, part.partName, part.partCode, part.vendor, JSON.stringify(part.dimensions)],
        );
      }
    }
  }

  private async insertEventLog(client: PoolClient, event: IngestEvent) {
    const result = await client.query(
      `INSERT INTO event_log (event_id, event_type, station_id, timestamp)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.eventId, event.eventType, event.stationId, event.timestamp],
    );
    return result.rowCount === 1;
  }

  private async insertInspection(client: PoolClient, event: InspectionCreatedEvent) {
    await client.query(
      `INSERT INTO inspections (
        event_id, station_id, camera_id, timestamp, part_id, part_name, part_code, batch_no, vendor,
        operator_id, operator_name, status, shift, line, confidence_score, measurements, image_url, model_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18)`,
      [
        event.eventId,
        event.stationId,
        event.cameraId ?? null,
        event.timestamp,
        event.partId ?? null,
        event.partName,
        event.partCode,
        event.batchNo ?? null,
        event.vendor ?? null,
        event.operatorId ?? null,
        event.operatorName ?? null,
        event.status,
        event.shift ?? null,
        event.line ?? null,
        event.confidenceScore,
        JSON.stringify(event.measurements),
        event.imageUrl ?? null,
        event.modelVersion ?? null,
      ],
    );

    const ngIncrement = event.status === 'NG' ? 1 : 0;
    await client.query(
      `INSERT INTO quality_records (id, date, part_code, part_name, vendor, total_scanned, ng_count, ng_rate, request_status, status_history)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 'not_requested', $8::jsonb)
       ON CONFLICT (date, part_code) DO UPDATE
       SET total_scanned = quality_records.total_scanned + 1,
           ng_count      = quality_records.ng_count + $6,
           ng_rate       = ROUND(((quality_records.ng_count + $6)::numeric * 100) / (quality_records.total_scanned + 1), 2),
           part_name     = EXCLUDED.part_name,
           vendor        = EXCLUDED.vendor`,
      [
        `QT-${event.timestamp.slice(0, 10)}-${event.partCode}`,
        event.timestamp.slice(0, 10),
        event.partCode,
        event.partName,
        event.vendor ?? '-',
        ngIncrement,
        ngIncrement * 100,
        JSON.stringify([{ status: 'not_requested', timestamp: event.timestamp, changedBy: 'System' }]),
      ],
    );
  }

  private async upsertStation(client: PoolClient, event: StationStatusEvent) {
    await client.query(
      `INSERT INTO stations (station_id, event_id, camera_id, timestamp, state, fps, model_version, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (station_id) DO UPDATE
       SET event_id      = EXCLUDED.event_id,
           camera_id     = EXCLUDED.camera_id,
           timestamp     = EXCLUDED.timestamp,
           state         = EXCLUDED.state,
           fps           = EXCLUDED.fps,
           model_version = EXCLUDED.model_version,
           message       = EXCLUDED.message`,
      [
        event.stationId,
        event.eventId,
        event.cameraId ?? null,
        event.timestamp,
        event.state,
        event.fps ?? null,
        event.modelVersion ?? null,
        event.message ?? null,
      ],
    );
  }

  private async insertAlert(client: PoolClient, event: QualityAlertEvent) {
    await client.query(
      `INSERT INTO alerts (event_id, station_id, timestamp, severity, message, inspection_id, part_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.eventId,
        event.stationId,
        event.timestamp,
        event.severity,
        event.message,
        event.inspectionId ?? null,
        event.partCode ?? null,
      ],
    );
  }
}

function mapInspection(row: InspectionRow): InspectionCreatedEvent {
  return {
    eventId: row.event_id,
    eventType: 'inspection.created',
    stationId: row.station_id,
    cameraId: optional(row.camera_id),
    timestamp: iso(row.timestamp),
    partId: optional(row.part_id),
    partName: row.part_name,
    partCode: row.part_code,
    batchNo: optional(row.batch_no),
    vendor: optional(row.vendor),
    operatorId: optional(row.operator_id),
    operatorName: optional(row.operator_name),
    status: row.status,
    shift: row.shift ?? undefined,
    line: optional(row.line),
    confidenceScore: row.confidence_score,
    measurements: json(row.measurements),
    imageUrl: optional(row.image_url),
    modelVersion: optional(row.model_version),
  };
}

function mapStation(row: StationRow): StationStatusEvent {
  return {
    eventId: row.event_id,
    eventType: 'station.status',
    stationId: row.station_id,
    cameraId: optional(row.camera_id),
    timestamp: iso(row.timestamp),
    state: row.state,
    fps: row.fps ?? undefined,
    modelVersion: optional(row.model_version),
    message: optional(row.message),
  };
}

function mapAlert(row: AlertRow): QualityAlertEvent {
  return {
    eventId: row.event_id,
    eventType: 'quality.alert',
    stationId: row.station_id,
    timestamp: iso(row.timestamp),
    severity: row.severity,
    message: row.message,
    inspectionId: optional(row.inspection_id),
    partCode: optional(row.part_code),
  };
}

function mapPart(row: PartRow): PartType {
  return {
    id: row.id,
    partName: row.part_name,
    partCode: row.part_code,
    vendor: row.vendor,
    dimensions: json(row.dimensions),
  };
}

function mapQualityRecord(row: QualityRecordRow): QualityTrackingRecord {
  return {
    id: row.id,
    date: dateOnly(row.date),
    partCode: row.part_code,
    partName: row.part_name,
    vendor: row.vendor,
    totalScanned: row.total_scanned,
    ngCount: row.ng_count,
    ngRate: Number(row.ng_rate),
    requestStatus: row.request_status,
    statusHistory: json(row.status_history),
  };
}

function optional(value: string | null) {
  return value ?? undefined;
}

function json<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
