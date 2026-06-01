# Supabase + TimescaleDB Setup and Migration Guide

Panduan ini menjelaskan langkah lengkap memindahkan database DimInspect dari PostgreSQL/Timescale lokal ke Supabase Postgres, sambil tetap memakai TimescaleDB untuk tabel time-series `inspections`.

## Ringkasan Keputusan

- Gunakan Supabase sebagai database Postgres terkelola.
- Gunakan TimescaleDB hanya pada proyek Supabase Postgres 15.
- Jangan pilih Supabase Postgres 17 jika wajib memakai `timescaledb`, karena extension tersebut deprecated/tidak tersedia untuk proyek Postgres 17.
- Backend tetap memakai koneksi Postgres langsung lewat `DATABASE_URL`; frontend tidak perlu Supabase client.
- Untuk Cloud Run, utamakan Session Pooler atau Direct Connection. Jangan pakai Transaction Pooler kecuali prepared statements SQLx sudah dimatikan.
- Cloudflare R2 tetap dipakai untuk snapshot inspection. Supabase Storage tidak perlu dipakai dalam arsitektur ini.

## Catatan Penting Tentang Timescale di Supabase

Supabase menyediakan TimescaleDB Apache 2 Edition. Fitur dasar seperti hypertable dan `time_bucket()` adalah target utama migrasi ini. Beberapa fitur Timescale yang ada di migration lokal bisa tidak tersedia atau bisa ditolak tergantung versi extension dan lisensi:

- `ALTER TABLE ... SET (timescaledb.compress, ...)`
- `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)`
- `add_continuous_aggregate_policy(...)`

Backend DimInspect saat ini menghitung dashboard langsung dari tabel `inspections`, bukan dari `dashboard_aggregates_daily`, jadi continuous aggregate aman untuk dihilangkan jika Supabase menolak fitur tersebut.

## 1. Persiapan Lokal

Pastikan repo sudah berada di kondisi yang ingin dimigrasikan.

```powershell
cd "D:\My Files\Kuliah\Semester 6\Capstone Project"
git status --short
```

Pastikan database lokal masih bisa diakses:

```powershell
docker compose ps
docker compose exec postgres pg_isready -U diminspect -d diminspect
```

Ambil backup sebelum migrasi:

```powershell
New-Item -ItemType Directory -Force -Path .\backups | Out-Null
docker compose exec -T postgres pg_dump `
  -U diminspect `
  -d diminspect `
  --format=custom `
  --file=- > .\backups\diminspect-before-supabase.dump
```

Backup SQL plain juga berguna untuk review manual:

```powershell
docker compose exec -T postgres pg_dump `
  -U diminspect `
  -d diminspect `
  --schema=public `
  --no-owner `
  --no-privileges `
  --file=- > .\backups\diminspect-before-supabase.sql
```

## 2. Buat Supabase Project

1. Buka Supabase Dashboard.
2. Buat project baru.
3. Pilih region yang dekat dengan Cloud Run backend. Jika Cloud Run di Asia Tenggara, pilih region Supabase terdekat yang tersedia.
4. Pilih Postgres 15 jika ingin TimescaleDB.
5. Simpan database password di password manager.
6. Tunggu project selesai provisioning.

Jangan lanjut ke migrasi schema sampai project benar-benar aktif.

## 3. Ambil Connection String

Di Supabase Dashboard:

1. Buka project.
2. Klik **Connect**.
3. Simpan tiga connection string berikut jika tersedia:
   - Direct connection: untuk migration, `pg_dump`, `psql`, dan task admin.
   - Session Pooler: direkomendasikan untuk runtime Cloud Run jika Direct Connection/IPv6 tidak cocok.
   - Transaction Pooler: hanya dipakai kalau library tidak memakai prepared statements.

Untuk backend Rust SQLx di repo ini, gunakan:

```text
DATABASE_URL=<Session Pooler atau Direct Connection string>
DATABASE_SSL=true
DATABASE_POOL_MAX=2
```

Catatan:

- Supabase Transaction Pooler tidak mendukung prepared statements dengan aman untuk semua client.
- SQLx memakai prepared statement/cache secara default.
- Jika nanti ingin memakai Transaction Pooler, tambahkan perubahan kode untuk `statement_cache_capacity(0)` di `Backend/src/storage/postgres.rs`, lalu test penuh.

## 4. Enable TimescaleDB Extension

Jalankan lewat Supabase SQL Editor atau `psql`.

```sql
create schema if not exists extensions;
create extension if not exists timescaledb with schema extensions;

select
  extname,
  extversion,
  extnamespace::regnamespace as schema
from pg_extension
where extname = 'timescaledb';
```

Expected:

- Ada satu row `timescaledb`.
- Schema biasanya `extensions`.

Jika `timescaledb` tidak tersedia, project kemungkinan Postgres 17 atau region/plan tidak menyediakan extension tersebut. Buat project Postgres 15, atau pakai opsi alternatif di bagian "Jika Harus Pakai Postgres 17".

## 5. Apply Schema DimInspect

Ada dua opsi. Untuk Supabase, mulai dari opsi aman.

### Opsi A: Supabase-Safe Schema

Gunakan SQL berikut jika Supabase menolak compression atau continuous aggregate. Ini mempertahankan hypertable `inspections`, indexes, dan semua tabel aplikasi.

```sql
create schema if not exists extensions;
create extension if not exists timescaledb with schema extensions;

create table if not exists schema_migrations (
  version integer primary key,
  applied_at timestamptz not null default now()
);

create table if not exists event_log (
  event_id text primary key,
  event_type text not null,
  station_id text not null,
  timestamp timestamptz not null
);

create index if not exists idx_event_log_timestamp
  on event_log(timestamp desc);

create table if not exists users (
  id text primary key,
  username text not null unique,
  password text not null,
  name text not null,
  role text not null,
  avatar text
);

create table if not exists parts (
  id text primary key,
  part_name text not null,
  part_code text not null unique,
  vendor text not null,
  dimensions jsonb not null
);

create table if not exists inspections (
  event_id text not null,
  station_id text not null,
  timestamp timestamptz not null,
  part_id text,
  part_name text not null,
  part_code text not null,
  vendor text,
  operator_id text,
  operator_name text,
  status text not null check (status in ('OK', 'NG')),
  confidence_score double precision not null,
  measurements jsonb not null,
  detections jsonb not null default '[]'::jsonb,
  trigger text,
  frame_object_key text,
  frame_uploaded_at timestamptz
);

select create_hypertable(
  'inspections',
  'timestamp',
  chunk_time_interval => interval '7 days',
  if_not_exists => true
);

create index if not exists idx_inspections_event_id
  on inspections(event_id);
create index if not exists idx_inspections_timestamp
  on inspections(timestamp desc);
create index if not exists idx_inspections_status_part
  on inspections(status, part_code);
create index if not exists idx_inspections_station_ts
  on inspections(station_id, timestamp desc);
create index if not exists idx_inspections_partcode_status_ts
  on inspections(part_code, status, timestamp desc);
create index if not exists idx_inspections_frame_uploaded
  on inspections(frame_uploaded_at)
  where frame_object_key is not null;

create table if not exists stations (
  station_id text primary key,
  event_id text not null,
  timestamp timestamptz not null,
  state text not null check (state in ('online', 'offline')),
  fps double precision,
  running boolean not null default false,
  phase text,
  active_part_code text,
  is_active boolean not null default true
);

create table if not exists quality_records (
  id text primary key,
  date date not null,
  part_code text not null,
  part_name text not null,
  vendor text not null,
  total_scanned integer not null default 0,
  ng_count integer not null default 0,
  ng_rate numeric(6, 2) not null default 0,
  request_status text not null,
  status_history jsonb not null,
  unique (date, part_code)
);

create index if not exists idx_quality_records_date
  on quality_records(date desc);

insert into schema_migrations (version)
values (1)
on conflict (version) do nothing;
```

### Opsi B: Pakai Migration Existing

Jika ingin mencoba migration existing apa adanya:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f .\Backend\migrations\20240101000001_initial.up.sql
```

Jika gagal di bagian compression atau continuous aggregate, rollback schema kosong lalu pakai Opsi A:

```sql
drop materialized view if exists dashboard_aggregates_daily;
drop table if exists quality_records cascade;
drop table if exists stations cascade;
drop table if exists inspections cascade;
drop table if exists parts cascade;
drop table if exists users cascade;
drop table if exists event_log cascade;
drop table if exists schema_migrations cascade;
```

## 6. Verifikasi Schema dan Hypertable

Jalankan:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select hypertable_schema, hypertable_name, num_dimensions
from timescaledb_information.hypertables
where hypertable_name = 'inspections';

select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'inspections'
order by indexname;
```

Expected:

- Tabel utama muncul: `event_log`, `users`, `parts`, `inspections`, `stations`, `quality_records`, `schema_migrations`.
- `inspections` muncul sebagai hypertable.
- Index inspection sudah ada.

## 7. Migrasi Data Dari Database Lama

Matikan backend lama dulu agar tidak ada write baru saat dump.

```powershell
docker compose stop backend
```

Export data table aplikasi:

```powershell
New-Item -ItemType Directory -Force -Path .\backups | Out-Null
docker compose exec -T postgres pg_dump `
  -U diminspect `
  -d diminspect `
  --data-only `
  --no-owner `
  --no-privileges `
  --disable-triggers `
  --table=public.schema_migrations `
  --table=public.event_log `
  --table=public.users `
  --table=public.parts `
  --table=public.inspections `
  --table=public.stations `
  --table=public.quality_records `
  --file=- > .\backups\diminspect-data-only.sql
```

Import ke Supabase:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f .\backups\diminspect-data-only.sql
```

Jika import gagal karena row seed sudah ada, berarti backend pernah start dan sudah seed `users`/`parts`. Untuk database baru, paling bersih adalah:

1. Stop backend.
2. Truncate target Supabase.
3. Import ulang.

```sql
truncate table
  quality_records,
  stations,
  inspections,
  parts,
  users,
  event_log,
  schema_migrations
restart identity;
```

Lalu ulangi import.

## 8. Verifikasi Data

Bandingkan count lokal dan Supabase.

Lokal:

```powershell
docker compose exec -T postgres psql -U diminspect -d diminspect -c "
select 'users' table_name, count(*) from users
union all select 'parts', count(*) from parts
union all select 'inspections', count(*) from inspections
union all select 'stations', count(*) from stations
union all select 'quality_records', count(*) from quality_records
union all select 'event_log', count(*) from event_log;
"
```

Supabase:

```sql
select 'users' table_name, count(*) from users
union all select 'parts', count(*) from parts
union all select 'inspections', count(*) from inspections
union all select 'stations', count(*) from stations
union all select 'quality_records', count(*) from quality_records
union all select 'event_log', count(*) from event_log;
```

Smoke test query:

```sql
select
  time_bucket('1 day', timestamp) as day,
  count(*) filter (where status = 'OK') as ok,
  count(*) filter (where status = 'NG') as ng
from inspections
group by day
order by day desc
limit 7;
```

## 9. Update Backend Environment

Untuk local `.env` backend:

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=2
APP_TIMEZONE=Asia/Jakarta
```

Untuk Cloud Run, simpan sebagai Secret Manager:

```powershell
gcloud secrets create diminspect-database-url --replication-policy=automatic
Set-Content -Path .\tmp-db-url.txt -Value "postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
gcloud secrets versions add diminspect-database-url --data-file=.\tmp-db-url.txt
Remove-Item .\tmp-db-url.txt
```

Deploy backend Cloud Run dengan env:

```powershell
gcloud run deploy diminspect-backend `
  --image <your-backend-image> `
  --region <cloud-run-region> `
  --allow-unauthenticated `
  --set-secrets DATABASE_URL=diminspect-database-url:latest `
  --set-env-vars DATABASE_SSL=true,DATABASE_POOL_MAX=2,APP_TIMEZONE=Asia/Jakarta
```

Tambahkan env lain yang sudah dipakai arsitektur Cloud Run:

```text
JWT_SECRET=...
AGENT_TOKEN=...
MQTT_HOST=...
MQTT_USERNAME=...
MQTT_PASSWORD=...
MQTT_TOPIC_PREFIX=diminspect/production
OBJECT_STORE_ENABLED=true
OBJECT_STORE_BUCKET=...
OBJECT_STORE_ACCOUNT_ID=...
OBJECT_STORE_ACCESS_KEY_ID=...
OBJECT_STORE_SECRET_ACCESS_KEY=...
CLOUDFLARE_REALTIME_ENABLED=true
CLOUDFLARE_REALTIME_APP_ID=...
CLOUDFLARE_REALTIME_APP_SECRET=...
```

## 10. Jalankan Backend ke Supabase

Local smoke test:

```powershell
cd Backend
$env:DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
$env:DATABASE_SSL="true"
$env:DATABASE_POOL_MAX="2"
cargo run
```

Test endpoint:

```powershell
curl http://localhost:4000/api/health
```

Login dari frontend, lalu cek:

- Dashboard load.
- History menampilkan data lama.
- Quality Tracking load.
- Live Tracking bisa melihat station dari MQTT presence.

## 11. RLS dan Supabase Data API

Aplikasi ini tidak memakai Supabase Data API dari frontend. Browser tetap hanya bicara ke backend DimInspect.

Rekomendasi:

- Jangan taruh `service_role` key di frontend.
- Jangan menambahkan Supabase anon key ke frontend jika tidak ada kebutuhan.
- Jika nanti tabel public diekspos ke Data API, aktifkan RLS dan tulis policy yang benar.
- Untuk sekarang, backend memakai Postgres connection string dan authorization tetap dilakukan oleh backend.

Opsional hardening jika ingin mencegah akses Data API accidental:

```sql
alter table users enable row level security;
alter table parts enable row level security;
alter table inspections enable row level security;
alter table stations enable row level security;
alter table quality_records enable row level security;
alter table event_log enable row level security;
```

Jangan lakukan ini kalau ada rencana memakai Supabase client langsung sebelum policy siap.

## 12. Rollback Plan

Simpan database lama sampai production baru stabil.

Rollback aplikasi:

1. Set `DATABASE_URL` kembali ke database lama.
2. Set `DATABASE_SSL=false` jika kembali ke docker/local DB.
3. Deploy ulang backend.
4. Jangan drop Supabase project sampai semua data diverifikasi.

Rollback data:

```powershell
docker compose exec -T postgres pg_restore `
  -U diminspect `
  -d diminspect `
  --clean `
  --if-exists `
  .\backups\diminspect-before-supabase.dump
```

## 13. Jika Harus Pakai Supabase Postgres 17

Jika project Supabase harus Postgres 17, jangan pakai TimescaleDB. Pilih salah satu:

1. Tetap pakai tabel normal `inspections` plus index yang sudah ada.
2. Migrasi ke native Postgres range partitioning.
3. Gunakan `pg_partman` untuk maintenance partition jika extension tersedia.

Minimal schema change untuk Postgres 17:

- Hapus `create extension timescaledb`.
- Hapus `create_hypertable(...)`.
- Hapus `ALTER TABLE ... timescaledb.compress`.
- Hapus continuous aggregate dan policy.
- Pertahankan semua index biasa.

Backend saat ini masih bisa berjalan karena query dashboard/history memakai SQL Postgres biasa.

## 14. Checklist Final

- [ ] Supabase project memakai Postgres 15 jika TimescaleDB wajib.
- [ ] `timescaledb` enabled dan terverifikasi.
- [ ] Schema berhasil dibuat.
- [ ] `inspections` terverifikasi sebagai hypertable.
- [ ] Data lama berhasil diimport.
- [ ] Count lokal dan Supabase cocok.
- [ ] Backend env memakai Supabase `DATABASE_URL`.
- [ ] `DATABASE_SSL=true`.
- [ ] Pool kecil untuk Cloud Run, misalnya `DATABASE_POOL_MAX=2`.
- [ ] Backend health check hijau.
- [ ] Login, Dashboard, History, Quality Tracking berhasil.
- [ ] Agent HTTP ingest berhasil menulis inspection baru.
- [ ] R2 thumbnail history masih muncul.

## Referensi

- Supabase TimescaleDB extension: https://supabase.com/docs/guides/database/extensions/timescaledb
- Supabase Postgres connection strings/pooler: https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- Supabase migration from Postgres: https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres
- Supabase Postgres 17 upgrade notes: https://supabase.com/docs/guides/platform/upgrading#upgrading-to-postgres-17
- Supabase guide for migrating from TimescaleDB to pg_partman: https://supabase.com/docs/guides/database/migrating-to-pg-partman
