import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from '../config/env.js';
import type {
  IngestEvent,
  InspectionCreatedEvent,
  InspectionQuery,
  InspectionStatus,
  InspectionTrigger,
  Batch,
  PartType,
  QualityTrackingRecord,
  RequestStatus,
  ShiftSchedule,
  StationPhase,
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
  { id: 'u-006', username: 'engineer1', password: 'eng123', name: 'Rina Engineering', role: 'engineering' },
];

const SEED_SHIFTS: ShiftSchedule[] = [
  { id: 'shift-a', shift: 'A', label: 'Shift A', startTime: '07:00', endTime: '15:00', active: true },
  { id: 'shift-b', shift: 'B', label: 'Shift B', startTime: '15:00', endTime: '23:00', active: true },
  { id: 'shift-c', shift: 'C', label: 'Shift C', startTime: '23:00', endTime: '07:00', active: true },
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
        confidence_score double precision NOT NULL,
        measurements jsonb NOT NULL,
        detections jsonb NOT NULL DEFAULT '[]'::jsonb,
        image_url text
      );

      CREATE TABLE IF NOT EXISTS stations (
        station_id text PRIMARY KEY,
        event_id text NOT NULL REFERENCES event_log(event_id) ON DELETE CASCADE,
        timestamp timestamptz NOT NULL,
        state text NOT NULL CHECK (state IN ('online', 'offline')),
        fps double precision,
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
      ALTER TABLE event_log    DROP COLUMN IF EXISTS payload;
      ALTER TABLE inspections  DROP COLUMN IF EXISTS payload;
      ALTER TABLE stations     DROP COLUMN IF EXISTS payload;
      ALTER TABLE stations     DROP COLUMN IF EXISTS queue_size;
      ALTER TABLE alerts       DROP COLUMN IF EXISTS payload;
    `,
  },
  {
    version: 3,
    sql: `
      DELETE FROM users WHERE password IS NULL OR password NOT LIKE '$2%';
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE stations ADD COLUMN IF NOT EXISTS running boolean NOT NULL DEFAULT false;
    `,
  },
  {
    version: 5,
    sql: `
      DROP INDEX IF EXISTS idx_alerts_timestamp;
      DROP TABLE IF EXISTS alerts;

      ALTER TABLE inspections DROP COLUMN IF EXISTS image_url;
      ALTER TABLE inspections DROP COLUMN IF EXISTS camera_id;
      ALTER TABLE inspections ADD COLUMN IF NOT EXISTS trigger text;

      ALTER TABLE stations DROP COLUMN IF EXISTS message;
      ALTER TABLE stations DROP COLUMN IF EXISTS camera_id;
      UPDATE stations SET state = 'offline' WHERE state = 'degraded';
      ALTER TABLE stations DROP CONSTRAINT IF EXISTS stations_state_check;
      ALTER TABLE stations ADD CONSTRAINT stations_state_check CHECK (state IN ('online', 'offline'));
      ALTER TABLE stations ADD COLUMN IF NOT EXISTS phase text;
      ALTER TABLE stations ADD COLUMN IF NOT EXISTS active_part_code text;
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE inspections DROP COLUMN IF EXISTS line;
      ALTER TABLE inspections DROP COLUMN IF EXISTS model_version;
      ALTER TABLE inspections ADD COLUMN IF NOT EXISTS detections jsonb NOT NULL DEFAULT '[]'::jsonb;
      UPDATE inspections SET station_id = 'Station 1' WHERE station_id = 'station-1';

      ALTER TABLE stations DROP COLUMN IF EXISTS model_version;
      UPDATE stations SET station_id = 'Station 1' WHERE station_id = 'station-1';

      UPDATE event_log SET station_id = 'Station 1' WHERE station_id = 'station-1';

      CREATE INDEX IF NOT EXISTS idx_inspections_station_timestamp ON inspections(station_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_inspections_shift_timestamp ON inspections(shift, timestamp DESC);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS shift_schedules (
        id text PRIMARY KEY,
        shift text NOT NULL UNIQUE CHECK (shift IN ('A', 'B', 'C')),
        label text NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        active boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS batches (
        id text PRIMARY KEY,
        batch_no text NOT NULL UNIQUE,
        part_code text NOT NULL,
        part_name text NOT NULL,
        shift text NOT NULL CHECK (shift IN ('A', 'B', 'C')),
        status text NOT NULL CHECK (status IN ('open', 'closed')),
        target_qty integer NOT NULL DEFAULT 0,
        actual_qty integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        closed_at timestamptz
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_one_open ON batches(part_code, shift) WHERE status = 'open';
      CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at DESC);
    `,
  },
];

interface InspectionRow {
  event_id: string;
  station_id: string;
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
  confidence_score: number;
  measurements: unknown;
  detections: unknown;
  trigger: InspectionTrigger | null;
}

interface StationRow {
  event_id: string;
  station_id: string;
  timestamp: string | Date;
  state: 'online' | 'offline';
  fps: number | null;
  running: boolean | null;
  phase: StationPhase | null;
  active_part_code: string | null;
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

interface ShiftScheduleRow {
  id: string;
  shift: 'A' | 'B' | 'C';
  label: string;
  start_time: string;
  end_time: string;
  active: boolean;
}

interface BatchRow {
  id: string;
  batch_no: string;
  part_code: string;
  part_name: string;
  shift: 'A' | 'B' | 'C';
  status: 'open' | 'closed';
  target_qty: number;
  actual_qty: number;
  created_at: string | Date;
  closed_at: string | Date | null;
}

export class PostgresStore implements DataStore {
  private readonly pool: Pool;

  constructor(private readonly config: AppConfig) {
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
      else await this.upsertStation(client, event);

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
      `SELECT event_id, station_id, timestamp, part_id, part_name, part_code, batch_no, vendor,
              operator_id, operator_name, status, shift, confidence_score, measurements,
              detections, trigger
       FROM inspections
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR part_code = $2)
       ORDER BY timestamp DESC
       LIMIT $3`,
      [query.status ?? null, query.partCode ?? null, limit],
    );
    return result.rows.map(mapInspection);
  }

  async listStations() {
    const result = await this.pool.query<StationRow>(
      `SELECT event_id, station_id, timestamp, state, fps, running, phase, active_part_code
       FROM stations ORDER BY timestamp DESC`,
    );
    return result.rows.map(mapStation);
  }

  async listParts() {
    const result = await this.pool.query<PartRow>('SELECT * FROM parts ORDER BY part_code ASC');
    return result.rows.map(mapPart);
  }

  async findPart(partCode: string) {
    const result = await this.pool.query<PartRow>(
      'SELECT * FROM parts WHERE part_code = $1 LIMIT 1',
      [partCode],
    );
    return result.rows[0] ? mapPart(result.rows[0]) : null;
  }

  async listUsers(): Promise<Omit<User, 'password'>[]> {
    const result = await this.pool.query<Omit<User, 'password'>>(
      'SELECT id, username, name, role, avatar FROM users ORDER BY name ASC',
    );
    return result.rows;
  }

  async findUserByUsername(username: string): Promise<User | null> {
    const result = await this.pool.query<User>(
      'SELECT id, username, password, name, role, avatar FROM users WHERE username = $1 LIMIT 1',
      [username],
    );
    return result.rows[0] ?? null;
  }

  async findUserById(id: string): Promise<User | null> {
    const result = await this.pool.query<User>(
      'SELECT id, username, password, name, role, avatar FROM users WHERE id = $1 LIMIT 1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listShiftSchedules() {
    const result = await this.pool.query<ShiftScheduleRow>('SELECT * FROM shift_schedules ORDER BY shift ASC');
    return result.rows.map(mapShiftSchedule);
  }

  async updateShiftSchedule(id: string, input: Pick<ShiftSchedule, 'label' | 'startTime' | 'endTime' | 'active'>) {
    const result = await this.pool.query<ShiftScheduleRow>(
      `UPDATE shift_schedules
       SET label = $2, start_time = $3, end_time = $4, active = $5
       WHERE id = $1
       RETURNING *`,
      [id, input.label, input.startTime, input.endTime, input.active],
    );
    return result.rows[0] ? mapShiftSchedule(result.rows[0]) : null;
  }

  async listBatches() {
    const result = await this.pool.query<BatchRow>('SELECT * FROM batches ORDER BY created_at DESC');
    return result.rows.map(mapBatch);
  }

  async openBatch(input: { batchNo: string; partCode: string; shift: 'A' | 'B' | 'C'; targetQty: number }) {
    const part = await this.findPart(input.partCode);
    if (!part) throw new Error(`Part ${input.partCode} tidak ditemukan`);
    const result = await this.pool.query<BatchRow>(
      `INSERT INTO batches (id, batch_no, part_code, part_name, shift, status, target_qty)
       VALUES ($1, $2, $3, $4, $5, 'open', $6)
       RETURNING *`,
      [`batch-${randomUUID()}`, input.batchNo, part.partCode, part.partName, input.shift, input.targetQty],
    );
    return mapBatch(result.rows[0]);
  }

  async closeBatch(id: string) {
    const result = await this.pool.query<BatchRow>(
      `UPDATE batches
       SET status = 'closed', closed_at = now()
       WHERE id = $1 AND status = 'open'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? mapBatch(result.rows[0]) : null;
  }

  async getActiveBatch(partCode: string, shift: 'A' | 'B' | 'C') {
    return this.getActiveBatchWithClient(this.pool, partCode, shift);
  }

  private async getActiveBatchWithClient(
    client: Pick<Pool, 'query'> | PoolClient,
    partCode: string,
    shift: 'A' | 'B' | 'C',
  ) {
    const result = await client.query<BatchRow>(
      `SELECT * FROM batches
       WHERE part_code = $1 AND shift = $2 AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
      [partCode, shift],
    );
    return result.rows[0] ? mapBatch(result.rows[0]) : null;
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
    const [counts, trend, stations, stationTrend, partPareto, shiftSummary, measurementDrift] = await Promise.all([
      this.pool.query<{ status: InspectionStatus; count: string }>(
        'SELECT status, COUNT(*)::bigint AS count FROM inspections GROUP BY status',
      ),
      this.pool.query<{ date: string; ok: string; ng: string }>(
        `SELECT to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
                COUNT(*) FILTER (WHERE status = 'OK')::bigint AS ok,
                COUNT(*) FILTER (WHERE status = 'NG')::bigint AS ng
         FROM inspections
         GROUP BY date
         ORDER BY date ASC`,
      ),
      this.pool.query<{ total: string; active: string }>(
        `SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE state = 'online')::bigint AS active
         FROM stations`,
      ),
      this.pool.query<{ station_id: string; ok: string; ng: string; total: string }>(
        `SELECT station_id,
                COUNT(*) FILTER (WHERE status = 'OK')::bigint AS ok,
                COUNT(*) FILTER (WHERE status = 'NG')::bigint AS ng,
                COUNT(*)::bigint AS total
         FROM inspections
         GROUP BY station_id
         ORDER BY station_id ASC`,
      ),
      this.pool.query<{ part_code: string; part_name: string; ok: string; ng: string; total: string }>(
        `SELECT part_code, part_name,
                COUNT(*) FILTER (WHERE status = 'OK')::bigint AS ok,
                COUNT(*) FILTER (WHERE status = 'NG')::bigint AS ng,
                COUNT(*)::bigint AS total
         FROM inspections
         GROUP BY part_code, part_name
         ORDER BY ng DESC, total DESC
         LIMIT 8`,
      ),
      this.pool.query<{ shift: 'A' | 'B' | 'C'; ok: string; ng: string; total: string }>(
        `SELECT COALESCE(shift, 'A') AS shift,
                COUNT(*) FILTER (WHERE status = 'OK')::bigint AS ok,
                COUNT(*) FILTER (WHERE status = 'NG')::bigint AS ng,
                COUNT(*)::bigint AS total
         FROM inspections
         GROUP BY COALESCE(shift, 'A')
         ORDER BY shift ASC`,
      ),
      this.pool.query<{ dimension_name: string; avg_measured: string; nominal: string; unit: string }>(
        `SELECT item->>'dimensionName' AS dimension_name,
                AVG((item->>'measured')::numeric)::text AS avg_measured,
                AVG((item->>'nominal')::numeric)::text AS nominal,
                MAX(item->>'unit') AS unit
         FROM inspections
         CROSS JOIN LATERAL jsonb_array_elements(measurements) AS item
         GROUP BY item->>'dimensionName'
         ORDER BY ABS(AVG((item->>'measured')::numeric) - AVG((item->>'nominal')::numeric)) DESC
         LIMIT 8`,
      ),
    ]);

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
      stationTrend: stationTrend.rows.map((row) => ({
        stationId: row.station_id,
        ok: Number(row.ok),
        ng: Number(row.ng),
        ngRate: rate(row.ng, row.total),
      })),
      partPareto: partPareto.rows.map((row) => ({
        partCode: row.part_code,
        partName: row.part_name,
        ok: Number(row.ok),
        ng: Number(row.ng),
        total: Number(row.total),
        ngRate: rate(row.ng, row.total),
      })),
      shiftSummary: shiftSummary.rows.map((row) => ({
        shift: row.shift,
        ok: Number(row.ok),
        ng: Number(row.ng),
        total: Number(row.total),
        ngRate: rate(row.ng, row.total),
      })),
      measurementDrift: measurementDrift.rows.map((row) => {
        const avgMeasured = Number(Number(row.avg_measured).toFixed(3));
        const nominal = Number(Number(row.nominal).toFixed(3));
        return {
          dimensionName: row.dimension_name,
          avgMeasured,
          nominal,
          delta: Number((avgMeasured - nominal).toFixed(3)),
          unit: row.unit,
        };
      }),
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
    for (const user of SEED_USERS) {
      const hashed = await bcrypt.hash(user.password, this.config.BCRYPT_ROUNDS);
      await this.pool.query(
        `INSERT INTO users (id, username, password, name, role, avatar)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [user.id, user.username, hashed, user.name, user.role, user.avatar ?? null],
      );
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

    for (const shift of SEED_SHIFTS) {
      await this.pool.query(
        `INSERT INTO shift_schedules (id, shift, label, start_time, end_time, active)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [shift.id, shift.shift, shift.label, shift.startTime, shift.endTime, shift.active],
      );
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
    const activeBatch = await this.getActiveBatchWithClient(client, event.partCode, event.shift ?? 'A');
    await client.query(
      `INSERT INTO inspections (
        event_id, station_id, timestamp, part_id, part_name, part_code, batch_no, vendor,
        operator_id, operator_name, status, shift, confidence_score, measurements,
        detections, trigger
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)`,
      [
        event.eventId,
        event.stationId,
        event.timestamp,
        event.partId ?? null,
        event.partName,
        event.partCode,
        event.batchNo ?? activeBatch?.batchNo ?? null,
        event.vendor ?? null,
        event.operatorId ?? null,
        event.operatorName ?? null,
        event.status,
        event.shift ?? 'A',
        event.confidenceScore,
        JSON.stringify(event.measurements),
        JSON.stringify(event.detections),
        event.trigger ?? 'manual',
      ],
    );

    if (activeBatch) {
      await client.query(
        `UPDATE batches
         SET actual_qty = actual_qty + $2
         WHERE id = $1`,
        [activeBatch.id, Math.max(1, event.detections.length)],
      );
    }

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
      `INSERT INTO stations (station_id, event_id, timestamp, state, fps, running, phase, active_part_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (station_id) DO UPDATE
       SET event_id         = EXCLUDED.event_id,
           timestamp        = EXCLUDED.timestamp,
           state            = EXCLUDED.state,
           fps              = EXCLUDED.fps,
           running          = EXCLUDED.running,
           phase            = EXCLUDED.phase,
           active_part_code = EXCLUDED.active_part_code`,
      [
        event.stationId,
        event.eventId,
        event.timestamp,
        event.state,
        event.fps ?? null,
        event.running ?? false,
        event.phase ?? null,
        event.activePartCode ?? null,
      ],
    );
  }
}

function mapInspection(row: InspectionRow): InspectionCreatedEvent {
  return {
    eventId: row.event_id,
    eventType: 'inspection.created',
    stationId: row.station_id,
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
    confidenceScore: row.confidence_score,
    measurements: json(row.measurements),
    detections: json(row.detections),
    trigger: row.trigger ?? undefined,
  };
}

function mapStation(row: StationRow): StationStatusEvent {
  return {
    eventId: row.event_id,
    eventType: 'station.status',
    stationId: row.station_id,
    timestamp: iso(row.timestamp),
    state: row.state,
    fps: row.fps ?? undefined,
    running: row.running ?? false,
    phase: row.phase ?? undefined,
    activePartCode: optional(row.active_part_code),
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

function mapShiftSchedule(row: ShiftScheduleRow): ShiftSchedule {
  return {
    id: row.id,
    shift: row.shift,
    label: row.label,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    active: row.active,
  };
}

function mapBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    batchNo: row.batch_no,
    partCode: row.part_code,
    partName: row.part_name,
    shift: row.shift,
    status: row.status,
    targetQty: row.target_qty,
    actualQty: row.actual_qty,
    createdAt: iso(row.created_at),
    closedAt: row.closed_at ? iso(row.closed_at) : undefined,
  };
}

function rate(ng: string, total: string) {
  const denominator = Number(total);
  return denominator > 0 ? Number(((Number(ng) / denominator) * 100).toFixed(1)) : 0;
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
