use std::str::FromStr;

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use bcrypt::hash;
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::config::Config;
use crate::domain::*;

use super::{DataStore, PartInput, UserInput, UserUpdateInput};

#[derive(Clone)]
pub struct PostgresStore {
    pool: PgPool,
    bcrypt_rounds: u32,
}

impl PostgresStore {
    pub async fn connect(config: &Config) -> anyhow::Result<Self> {
        let mut options = PgConnectOptions::from_str(&config.database_url)?;
        if config.database_ssl {
            options = options.ssl_mode(PgSslMode::Require);
        }

        let pool = PgPoolOptions::new()
            .max_connections(config.database_pool_max)
            .connect_with(options)
            .await
            .context("failed to connect to PostgreSQL")?;

        Ok(Self {
            pool,
            bcrypt_rounds: config.bcrypt_rounds,
        })
    }

    pub async fn find_frame_object_key(&self, event_id: &str) -> anyhow::Result<Option<String>> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            r#"
            SELECT frame_object_key
            FROM inspections
            WHERE event_id = $1
            LIMIT 1
            "#,
        )
        .bind(event_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.and_then(|value| value.0))
    }

    pub async fn mark_frame_uploaded(&self, parent_event_id: &str, key: &str) -> anyhow::Result<u64> {
        let child_pattern = format!("{parent_event_id}-%");
        let result = sqlx::query(
            r#"
            UPDATE inspections
            SET frame_object_key = $1,
                frame_uploaded_at = now()
            WHERE event_id = $2 OR event_id LIKE $3
            "#,
        )
        .bind(key)
        .bind(parent_event_id)
        .bind(child_pattern)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    async fn seed_static_data(&self) -> anyhow::Result<()> {
        for user in super::seed::USERS {
            let hashed = hash(user.password, self.bcrypt_rounds)?;
            sqlx::query(
                r#"
                INSERT INTO users (id, username, password, name, role, avatar)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(user.id)
            .bind(user.username)
            .bind(hashed)
            .bind(user.name)
            .bind(user.role.as_str())
            .bind(Option::<String>::None)
            .execute(&self.pool)
            .await?;
        }

        let part_count: (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM parts")
            .fetch_one(&self.pool)
            .await?;
        if part_count.0 == 0 {
            for part in super::seed::PARTS {
                let dimensions: Vec<DimensionSpec> = part.dimensions.iter().map(DimensionSpec::from).collect();
                sqlx::query(
                    r#"
                    INSERT INTO parts (id, part_name, part_code, vendor, dimensions)
                    VALUES ($1, $2, $3, $4, $5::jsonb)
                    ON CONFLICT (id) DO NOTHING
                    "#,
                )
                .bind(part.id)
                .bind(part.part_name)
                .bind(part.part_code)
                .bind(part.vendor)
                .bind(serde_json::to_value(dimensions)?)
                .execute(&self.pool)
                .await?;
            }
        }

        Ok(())
    }

    async fn insert_event_log(
        tx: &mut Transaction<'_, Postgres>,
        event: &IngestEvent,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(
            r#"
            INSERT INTO event_log (event_id, event_type, station_id, timestamp)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            "#,
        )
        .bind(event.event_id())
        .bind(event.event_type())
        .bind(event.station_id())
        .bind(parse_timestamp(event.timestamp())?)
        .fetch_optional(&mut **tx)
        .await?;

        Ok(result.is_some())
    }

    async fn insert_inspection(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        event: &InspectionCreatedEvent,
    ) -> anyhow::Result<()> {
        let detections = serde_json::to_value(&event.detections)?;
        let measurements = serde_json::to_value(&event.measurements)?;
        let timestamp = parse_timestamp(&event.timestamp)?;
        let trigger = event.trigger.unwrap_or(InspectionTrigger::Manual);

        sqlx::query(
            r#"
            INSERT INTO inspections (
              event_id, station_id, timestamp, part_id, part_name, part_code, vendor,
              operator_id, operator_name, status, confidence_score, measurements,
              detections, trigger
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)
            "#,
        )
        .bind(&event.event_id)
        .bind(&event.station_id)
        .bind(timestamp)
        .bind(&event.part_id)
        .bind(&event.part_name)
        .bind(&event.part_code)
        .bind(&event.vendor)
        .bind(&event.operator_id)
        .bind(&event.operator_name)
        .bind(event.status.as_str())
        .bind(event.confidence_score)
        .bind(measurements)
        .bind(detections)
        .bind(match trigger { InspectionTrigger::Manual => "manual" })
        .execute(&mut **tx)
        .await?;

        let ng_increment = if event.status == InspectionStatus::Ng { 1 } else { 0 };
        let date = event.timestamp.chars().take(10).collect::<String>();
        let record_id = format!("QT-{}-{}", date, event.part_code);
        let history = json!([{ "status": "not_requested", "timestamp": event.timestamp, "changedBy": "System" }]);

        sqlx::query(
            r#"
            INSERT INTO quality_records (id, date, part_code, part_name, vendor, total_scanned, ng_count, ng_rate, request_status, status_history)
            VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 'not_requested', $8::jsonb)
            ON CONFLICT (date, part_code) DO UPDATE
            SET total_scanned = quality_records.total_scanned + 1,
                ng_count      = quality_records.ng_count + $6,
                ng_rate       = ROUND(((quality_records.ng_count + $6)::numeric * 100) / (quality_records.total_scanned + 1), 2),
                part_name     = EXCLUDED.part_name,
                vendor        = EXCLUDED.vendor
            "#,
        )
        .bind(record_id)
        .bind(&date)
        .bind(&event.part_code)
        .bind(&event.part_name)
        .bind(event.vendor.as_deref().unwrap_or("-"))
        .bind(ng_increment)
        .bind(ng_increment * 100)
        .bind(history)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    async fn upsert_station(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        event: &StationStatusEvent,
    ) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO stations (station_id, event_id, timestamp, state, fps, running, phase, active_part_code, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, true))
            ON CONFLICT (station_id) DO UPDATE
            SET event_id         = EXCLUDED.event_id,
                timestamp        = EXCLUDED.timestamp,
                state            = EXCLUDED.state,
                fps              = EXCLUDED.fps,
                running          = EXCLUDED.running,
                phase            = EXCLUDED.phase,
                active_part_code = EXCLUDED.active_part_code,
                is_active        = COALESCE($9, stations.is_active)
            "#,
        )
        .bind(&event.station_id)
        .bind(&event.event_id)
        .bind(parse_timestamp(&event.timestamp)?)
        .bind(event.state.as_str())
        .bind(event.fps)
        .bind(event.running.unwrap_or(false))
        .bind(event.phase.map(StationPhase::as_str))
        .bind(&event.active_part_code)
        .bind(event.is_active)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

}

#[async_trait]
impl DataStore for PostgresStore {
    async fn init(&self) -> anyhow::Result<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        self.seed_static_data().await
    }

    async fn ingest(&self, event: IngestEvent) -> anyhow::Result<Option<IngestEvent>> {
        let mut tx = self.pool.begin().await?;
        let logged = Self::insert_event_log(&mut tx, &event).await?;
        if !logged {
            tx.commit().await?;
            return Ok(None);
        }

        match &event {
            IngestEvent::Inspection(inspection) => self.insert_inspection(&mut tx, inspection).await?,
            IngestEvent::Station(station) => self.upsert_station(&mut tx, station).await?,
        }

        tx.commit().await?;
        Ok(Some(event))
    }

    async fn list_inspections(&self, query: InspectionQuery) -> anyhow::Result<Vec<InspectionCreatedEvent>> {
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let mut builder: QueryBuilder<Postgres> = QueryBuilder::new(
            r#"
            SELECT event_id, station_id, timestamp, part_id, part_name, part_code, vendor,
                   operator_id, operator_name, status, confidence_score, measurements,
                   detections, trigger, frame_object_key, frame_uploaded_at
            FROM inspections
            WHERE 1 = 1
            "#,
        );

        if let Some(status) = query.status {
            builder.push(" AND status = ");
            builder.push_bind(status.as_str());
        }
        if let Some(part_code) = query.part_code.as_deref().filter(|value| !value.trim().is_empty()) {
            builder.push(" AND part_code = ");
            builder.push_bind(part_code);
        }
        builder.push(" ORDER BY timestamp DESC LIMIT ");
        builder.push_bind(limit);

        let rows = builder
            .build_query_as::<InspectionRow>()
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(map_inspection).collect()
    }

    async fn list_stations(&self) -> anyhow::Result<Vec<StationStatusEvent>> {
        let rows = sqlx::query_as::<_, StationRow>(
            r#"
            SELECT event_id, station_id, timestamp, state, fps, running, phase, active_part_code, is_active
            FROM stations
            WHERE is_active = true
            ORDER BY timestamp DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(map_station).collect()
    }

    async fn deactivate_station(&self, station_id: &str) -> anyhow::Result<Option<StationStatusEvent>> {
        let row = sqlx::query_as::<_, StationRow>(
            r#"
            UPDATE stations
            SET state = 'offline',
                running = false,
                phase = 'idle',
                active_part_code = NULL,
                is_active = false,
                timestamp = now()
            WHERE station_id = $1
            RETURNING event_id, station_id, timestamp, state, fps, running, phase, active_part_code, is_active
            "#,
        )
        .bind(station_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(map_station).transpose()
    }

    async fn list_parts(&self) -> anyhow::Result<Vec<PartType>> {
        let rows = sqlx::query_as::<_, PartRow>("SELECT * FROM parts ORDER BY part_code ASC")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(map_part).collect()
    }

    async fn find_part(&self, part_code: &str) -> anyhow::Result<Option<PartType>> {
        let row = sqlx::query_as::<_, PartRow>("SELECT * FROM parts WHERE part_code = $1 LIMIT 1")
            .bind(part_code)
            .fetch_optional(&self.pool)
            .await?;
        row.map(map_part).transpose()
    }

    async fn create_part(&self, input: PartInput) -> anyhow::Result<PartType> {
        let id = format!("part-{}", Uuid::new_v4());
        let dimensions = normalize_dimensions_value(serde_json::to_value(input.dimensions)?);
        let row = sqlx::query_as::<_, PartRow>(
            r#"
            INSERT INTO parts (id, part_name, part_code, vendor, dimensions)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(input.part_name)
        .bind(input.part_code)
        .bind(input.vendor)
        .bind(serde_json::to_value(dimensions)?)
        .fetch_one(&self.pool)
        .await
        .map_err(user_facing_db_error)?;
        map_part(row)
    }

    async fn update_part(&self, id: &str, input: PartInput) -> anyhow::Result<Option<PartType>> {
        let dimensions = normalize_dimensions_value(serde_json::to_value(input.dimensions)?);
        let row = sqlx::query_as::<_, PartRow>(
            r#"
            UPDATE parts
            SET part_name = $2, part_code = $3, vendor = $4, dimensions = $5::jsonb
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(input.part_name)
        .bind(input.part_code)
        .bind(input.vendor)
        .bind(serde_json::to_value(dimensions)?)
        .fetch_optional(&self.pool)
        .await
        .map_err(user_facing_db_error)?;
        row.map(map_part).transpose()
    }

    async fn delete_part(&self, id: &str) -> anyhow::Result<bool> {
        let part = sqlx::query_as::<_, PartRow>("SELECT * FROM parts WHERE id = $1 LIMIT 1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        let Some(_part) = part else {
            return Ok(false);
        };

        let result = sqlx::query("DELETE FROM parts WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_users(&self) -> anyhow::Result<Vec<SafeUser>> {
        let rows = sqlx::query_as::<_, SafeUserRow>(
            "SELECT id, username, name, role, avatar FROM users ORDER BY name ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(map_safe_user).collect()
    }

    async fn find_user_by_username(&self, username: &str) -> anyhow::Result<Option<User>> {
        let row = sqlx::query_as::<_, UserRow>(
            "SELECT id, username, password, name, role, avatar FROM users WHERE username = $1 LIMIT 1",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        row.map(map_user).transpose()
    }

    async fn find_user_by_id(&self, id: &str) -> anyhow::Result<Option<User>> {
        let row = sqlx::query_as::<_, UserRow>(
            "SELECT id, username, password, name, role, avatar FROM users WHERE id = $1 LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(map_user).transpose()
    }

    async fn create_user(&self, input: UserInput) -> anyhow::Result<SafeUser> {
        let hashed = hash(&input.password, self.bcrypt_rounds)?;
        let row = sqlx::query_as::<_, SafeUserRow>(
            r#"
            INSERT INTO users (id, username, password, name, role, avatar)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, username, name, role, avatar
            "#,
        )
        .bind(format!("user-{}", Uuid::new_v4()))
        .bind(input.username)
        .bind(hashed)
        .bind(input.name)
        .bind(input.role.as_str())
        .bind(input.avatar)
        .fetch_one(&self.pool)
        .await
        .map_err(user_facing_db_error)?;
        map_safe_user(row)
    }

    async fn update_user(&self, id: &str, input: UserUpdateInput) -> anyhow::Result<Option<SafeUser>> {
        let Some(existing) = self.find_user_by_id(id).await? else {
            return Ok(None);
        };
        let password = match input.password {
            Some(password) if !password.is_empty() => hash(password, self.bcrypt_rounds)?,
            _ => existing.password,
        };
        let row = sqlx::query_as::<_, SafeUserRow>(
            r#"
            UPDATE users
            SET username = $2, password = $3, name = $4, role = $5, avatar = $6
            WHERE id = $1
            RETURNING id, username, name, role, avatar
            "#,
        )
        .bind(id)
        .bind(input.username)
        .bind(password)
        .bind(input.name)
        .bind(input.role.as_str())
        .bind(input.avatar)
        .fetch_optional(&self.pool)
        .await
        .map_err(user_facing_db_error)?;
        row.map(map_safe_user).transpose()
    }

    async fn delete_user(&self, id: &str) -> anyhow::Result<bool> {
        let result = sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn count_users_by_role(&self, role: UserRole) -> anyhow::Result<i64> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM users WHERE role = $1")
            .bind(role.as_str())
            .fetch_one(&self.pool)
            .await?;
        Ok(row.0)
    }

    async fn list_quality_records(&self) -> anyhow::Result<Vec<QualityTrackingRecord>> {
        let rows = sqlx::query_as::<_, QualityRecordRow>(
            "SELECT * FROM quality_records ORDER BY date DESC, part_code ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(map_quality_record).collect()
    }

    async fn update_quality_record_status(
        &self,
        id: &str,
        status: RequestStatus,
        changed_by: &str,
    ) -> anyhow::Result<Option<QualityTrackingRecord>> {
        let entry = json!([{ "status": status, "timestamp": iso_now(), "changedBy": changed_by }]);
        let row = sqlx::query_as::<_, QualityRecordRow>(
            r#"
            UPDATE quality_records
            SET request_status = $2, status_history = status_history || $3::jsonb
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(status.as_str())
        .bind(entry)
        .fetch_optional(&self.pool)
        .await?;
        row.map(map_quality_record).transpose()
    }

    async fn get_dashboard_summary(&self) -> anyhow::Result<DashboardSummary> {
        let counts: DashboardCountsRow = sqlx::query_as(
            r#"
            SELECT COALESCE(SUM(ok), 0)::bigint AS ok,
                   COALESCE(SUM(ng), 0)::bigint AS ng
            FROM dashboard_aggregates_daily
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let trend = sqlx::query_as::<_, DailyTrendRow>(
            r#"
            SELECT to_char(bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
                   COALESCE(SUM(ok), 0)::bigint AS ok,
                   COALESCE(SUM(ng), 0)::bigint AS ng
            FROM dashboard_aggregates_daily
            GROUP BY bucket
            ORDER BY bucket ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let stations: StationCountRow = sqlx::query_as(
            r#"
            SELECT COUNT(*)::bigint AS total,
                   COUNT(*) FILTER (WHERE state = 'online' AND is_active = true)::bigint AS active
            FROM stations
            WHERE is_active = true
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let station_trend = sqlx::query_as::<_, StationTrendRow>(
            r#"
            SELECT station_id,
                   COALESCE(SUM(ok), 0)::bigint AS ok,
                   COALESCE(SUM(ng), 0)::bigint AS ng,
                   COALESCE(SUM(total), 0)::bigint AS total
            FROM dashboard_aggregates_daily
            GROUP BY station_id
            ORDER BY station_id ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let part_pareto = sqlx::query_as::<_, PartParetoRow>(
            r#"
            SELECT part_code, part_name,
                   COALESCE(SUM(ok), 0)::bigint AS ok,
                   COALESCE(SUM(ng), 0)::bigint AS ng,
                   COALESCE(SUM(total), 0)::bigint AS total
            FROM dashboard_aggregates_daily
            GROUP BY part_code, part_name
            ORDER BY ng DESC, total DESC
            LIMIT 8
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let measurement_drift = sqlx::query_as::<_, MeasurementDriftRow>(
            r#"
            SELECT item->>'dimensionName' AS dimension_name,
                   AVG((item->>'measured')::numeric)::text AS avg_measured,
                   AVG((item->>'nominal')::numeric)::text AS nominal,
                   MAX(item->>'unit') AS unit
            FROM inspections
            CROSS JOIN LATERAL jsonb_array_elements(measurements) AS item
            GROUP BY item->>'dimensionName'
            ORDER BY ABS(AVG((item->>'measured')::numeric) - AVG((item->>'nominal')::numeric)) DESC
            LIMIT 8
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let ok = counts.ok;
        let ng = counts.ng;
        let total = ok + ng;

        Ok(DashboardSummary {
            total,
            ok,
            ng,
            ng_rate: rate(ng, total),
            daily_trend: trend
                .into_iter()
                .map(|row| DailyTrendPoint { date: row.date, ok: row.ok, ng: row.ng })
                .collect(),
            station_count: stations.total,
            active_station_count: stations.active,
            station_trend: station_trend
                .into_iter()
                .map(|row| StationTrendPoint {
                    station_id: row.station_id,
                    ok: row.ok,
                    ng: row.ng,
                    ng_rate: rate(row.ng, row.total),
                })
                .collect(),
            part_pareto: part_pareto
                .into_iter()
                .map(|row| PartParetoPoint {
                    part_code: row.part_code,
                    part_name: row.part_name,
                    ok: row.ok,
                    ng: row.ng,
                    total: row.total,
                    ng_rate: rate(row.ng, row.total),
                })
                .collect(),
            measurement_drift: measurement_drift
                .into_iter()
                .map(|row| {
                    let avg_measured = round3(row.avg_measured.parse::<f64>().unwrap_or(0.0));
                    let nominal = round3(row.nominal.parse::<f64>().unwrap_or(0.0));
                    MeasurementDriftPoint {
                        dimension_name: row.dimension_name,
                        avg_measured,
                        nominal,
                        delta: round3(avg_measured - nominal),
                        unit: row.unit,
                    }
                })
                .collect(),
        })
    }
}

#[derive(Debug, FromRow)]
struct InspectionRow {
    event_id: String,
    station_id: String,
    timestamp: DateTime<Utc>,
    part_id: Option<String>,
    part_name: String,
    part_code: String,
    vendor: Option<String>,
    operator_id: Option<String>,
    operator_name: Option<String>,
    status: String,
    confidence_score: f64,
    measurements: Value,
    detections: Value,
    trigger: Option<String>,
    frame_object_key: Option<String>,
    frame_uploaded_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct StationRow {
    event_id: String,
    station_id: String,
    timestamp: DateTime<Utc>,
    state: String,
    fps: Option<f64>,
    running: Option<bool>,
    phase: Option<String>,
    active_part_code: Option<String>,
    is_active: Option<bool>,
}

#[derive(Debug, FromRow)]
struct PartRow {
    id: String,
    part_name: String,
    part_code: String,
    vendor: String,
    dimensions: Value,
}

#[derive(Debug, FromRow)]
struct UserRow {
    id: String,
    username: String,
    password: String,
    name: String,
    role: String,
    avatar: Option<String>,
}

#[derive(Debug, FromRow)]
struct SafeUserRow {
    id: String,
    username: String,
    name: String,
    role: String,
    avatar: Option<String>,
}

#[derive(Debug, FromRow)]
struct QualityRecordRow {
    id: String,
    date: NaiveDate,
    part_code: String,
    part_name: String,
    vendor: String,
    total_scanned: i32,
    ng_count: i32,
    ng_rate: Decimal,
    request_status: String,
    status_history: Value,
}

#[derive(Debug, FromRow)]
struct DashboardCountsRow {
    ok: i64,
    ng: i64,
}

#[derive(Debug, FromRow)]
struct DailyTrendRow {
    date: String,
    ok: i64,
    ng: i64,
}

#[derive(Debug, FromRow)]
struct StationCountRow {
    total: i64,
    active: i64,
}

#[derive(Debug, FromRow)]
struct StationTrendRow {
    station_id: String,
    ok: i64,
    ng: i64,
    total: i64,
}

#[derive(Debug, FromRow)]
struct PartParetoRow {
    part_code: String,
    part_name: String,
    ok: i64,
    ng: i64,
    total: i64,
}

#[derive(Debug, FromRow)]
struct MeasurementDriftRow {
    dimension_name: String,
    avg_measured: String,
    nominal: String,
    unit: String,
}

fn map_inspection(row: InspectionRow) -> anyhow::Result<InspectionCreatedEvent> {
    Ok(InspectionCreatedEvent {
        event_type: InspectionEventType::InspectionCreated,
        event_id: row.event_id,
        station_id: row.station_id,
        timestamp: iso(row.timestamp),
        part_id: row.part_id,
        part_name: row.part_name,
        part_code: row.part_code,
        vendor: row.vendor,
        operator_id: row.operator_id,
        operator_name: row.operator_name,
        status: parse_status(&row.status)?,
        confidence_score: row.confidence_score,
        measurements: serde_json::from_value(row.measurements).unwrap_or_default(),
        detections: serde_json::from_value(row.detections).unwrap_or_default(),
        trigger: match row.trigger.as_deref() {
            Some("manual") | None => row.trigger.as_ref().map(|_| InspectionTrigger::Manual),
            Some(_) => None,
        },
        frame_object_key: row.frame_object_key,
        frame_url: None,
        frame_uploaded_at: row.frame_uploaded_at.map(iso),
    })
}

fn map_station(row: StationRow) -> anyhow::Result<StationStatusEvent> {
    Ok(StationStatusEvent {
        event_type: StationEventType::StationStatus,
        event_id: row.event_id,
        station_id: row.station_id,
        timestamp: iso(row.timestamp),
        state: parse_station_state(&row.state)?,
        fps: row.fps,
        running: Some(row.running.unwrap_or(false)),
        phase: row.phase.as_deref().map(parse_phase).transpose()?,
        active_part_code: row.active_part_code,
        is_active: row.is_active,
    })
}

fn map_part(row: PartRow) -> anyhow::Result<PartType> {
    Ok(PartType {
        id: row.id,
        part_name: row.part_name,
        part_code: row.part_code,
        vendor: row.vendor,
        dimensions: normalize_dimensions_value(row.dimensions),
    })
}

fn map_user(row: UserRow) -> anyhow::Result<User> {
    Ok(User {
        id: row.id,
        username: row.username,
        password: row.password,
        name: row.name,
        role: parse_role(&row.role)?,
        avatar: row.avatar,
    })
}

fn map_safe_user(row: SafeUserRow) -> anyhow::Result<SafeUser> {
    Ok(SafeUser {
        id: row.id,
        username: row.username,
        name: row.name,
        role: parse_role(&row.role)?,
        avatar: row.avatar,
    })
}

fn map_quality_record(row: QualityRecordRow) -> anyhow::Result<QualityTrackingRecord> {
    Ok(QualityTrackingRecord {
        id: row.id,
        date: row.date.to_string(),
        part_code: row.part_code,
        part_name: row.part_name,
        vendor: row.vendor,
        total_scanned: row.total_scanned,
        ng_count: row.ng_count,
        ng_rate: row.ng_rate.to_f64().unwrap_or(0.0),
        request_status: parse_request_status(&row.request_status)?,
        status_history: serde_json::from_value(row.status_history).unwrap_or_default(),
    })
}

fn parse_timestamp(value: &str) -> anyhow::Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(value)?.with_timezone(&Utc))
}

fn parse_status(value: &str) -> anyhow::Result<InspectionStatus> {
    match value {
        "OK" => Ok(InspectionStatus::Ok),
        "NG" => Ok(InspectionStatus::Ng),
        _ => Err(anyhow!("invalid inspection status: {value}")),
    }
}

fn parse_role(value: &str) -> anyhow::Result<UserRole> {
    match value {
        "operator" => Ok(UserRole::Operator),
        "qc" => Ok(UserRole::Qc),
        "supervisor" => Ok(UserRole::Supervisor),
        "engineering" => Ok(UserRole::Engineering),
        "admin" => Ok(UserRole::Admin),
        "vendor" => Ok(UserRole::Vendor),
        _ => Err(anyhow!("invalid user role: {value}")),
    }
}

fn parse_request_status(value: &str) -> anyhow::Result<RequestStatus> {
    match value {
        "not_requested" => Ok(RequestStatus::NotRequested),
        "requested" => Ok(RequestStatus::Requested),
        "in_progress" => Ok(RequestStatus::InProgress),
        "shipped" => Ok(RequestStatus::Shipped),
        "received" => Ok(RequestStatus::Received),
        _ => Err(anyhow!("invalid request status: {value}")),
    }
}

fn parse_station_state(value: &str) -> anyhow::Result<StationState> {
    match value {
        "online" => Ok(StationState::Online),
        "offline" => Ok(StationState::Offline),
        _ => Err(anyhow!("invalid station state: {value}")),
    }
}

fn parse_phase(value: &str) -> anyhow::Result<StationPhase> {
    match value {
        "idle" => Ok(StationPhase::Idle),
        "calibrating" => Ok(StationPhase::Calibrating),
        "ready" => Ok(StationPhase::Ready),
        "stabilizing" => Ok(StationPhase::Stabilizing),
        "locked" => Ok(StationPhase::Locked),
        _ => Err(anyhow!("invalid station phase: {value}")),
    }
}

fn parse_kind(value: &str, name: &str) -> DimensionKind {
    match value {
        "width" => DimensionKind::Width,
        "length" => DimensionKind::Length,
        "diameter" => DimensionKind::Diameter,
        "outer_diameter" => DimensionKind::OuterDiameter,
        "inner_diameter" => DimensionKind::InnerDiameter,
        "hole_diameter" => DimensionKind::HoleDiameter,
        _ => infer_kind(name),
    }
}

fn infer_kind(name: &str) -> DimensionKind {
    let lower = name.to_ascii_lowercase();
    if lower.contains("inner") || lower.contains("hole") {
        DimensionKind::InnerDiameter
    } else if lower.contains("outer") {
        DimensionKind::OuterDiameter
    } else if lower.contains("diam") {
        DimensionKind::Diameter
    } else if lower.contains("length") || lower.contains("height") || lower.contains("panjang") {
        DimensionKind::Length
    } else {
        DimensionKind::Width
    }
}

fn normalize_dimensions_value(value: Value) -> Vec<DimensionSpec> {
    let raw = value.as_array().cloned().unwrap_or_default();
    raw.into_iter()
        .enumerate()
        .map(|(index, item)| {
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("Dimension {}", index + 1));
            let kind = item
                .get("kind")
                .and_then(Value::as_str)
                .map(|kind| parse_kind(kind, &name))
                .unwrap_or_else(|| infer_kind(&name));
            let view = match item.get("view").and_then(Value::as_str) {
                Some("side") => DimensionView::Side,
                _ => DimensionView::Top,
            };
            let nominal = item.get("nominal").and_then(Value::as_f64).unwrap_or(0.0);
            DimensionSpec {
                id: item
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
                    .unwrap_or_else(|| format!("dim-{}", index + 1)),
                name,
                kind,
                view,
                nominal,
                upper_limit: item.get("upperLimit").and_then(Value::as_f64).unwrap_or(nominal),
                lower_limit: item.get("lowerLimit").and_then(Value::as_f64).unwrap_or(nominal),
                unit: item
                    .get("unit")
                    .and_then(Value::as_str)
                    .unwrap_or("mm")
                    .to_string(),
            }
        })
        .collect()
}

fn user_facing_db_error(error: sqlx::Error) -> anyhow::Error {
    anyhow!(error)
}

fn rate(ng: i64, total: i64) -> f64 {
    if total > 0 {
        (((ng as f64 / total as f64) * 100.0) * 10.0).round() / 10.0
    } else {
        0.0
    }
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn iso(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn iso_now() -> String {
    iso(Utc::now())
}
