# Supabase Postgres 17 + pg_partman Setup and Migration Guide

Panduan ini menjelaskan setup database DimInspect untuk Supabase Postgres 17 dan local Docker yang kompatibel. Schema tidak lagi memakai TimescaleDB. Tabel time-series `inspections` memakai native PostgreSQL range partitioning, lalu maintenance partisi dikelola oleh `pg_partman` dan `pg_cron`.

## Ringkasan Keputusan

- Gunakan Supabase Postgres 17 sebagai target utama.
- Jangan pakai `timescaledb` pada Postgres 17, karena extension tersebut tidak tersedia di Supabase Postgres 17.
- Gunakan native partitioning pada tabel `inspections` dengan interval 7 hari.
- Gunakan `pg_partman` untuk membuat partisi ke depan dan `pg_cron` untuk menjalankan maintenance harian.
- Backend tetap memakai koneksi Postgres langsung lewat `DATABASE_URL`; frontend tidak perlu Supabase client.
- Cloudflare R2 tetap dipakai untuk snapshot inspection. Supabase Storage tidak perlu dipakai dalam arsitektur ini.

## 1. Persiapan Lokal

Pastikan repo berada di kondisi yang ingin dipakai:

```powershell
cd "D:\My Files\Kuliah\Semester 6\Capstone Project"
git status --short
```

Jika database lama berisi data yang masih dibutuhkan, ambil backup dulu:

```powershell
New-Item -ItemType Directory -Force .\backups
docker compose exec postgres pg_dump `
  -U diminspect `
  -d diminspect `
  --format=custom `
  --file=/tmp/diminspect-before-pg-partman.dump
docker compose cp postgres:/tmp/diminspect-before-pg-partman.dump .\backups\diminspect-before-pg-partman.dump
```

Migration ini adalah clean reset. Karena initial migration SQLx berubah, database lokal yang sudah pernah menjalankan migration lama dapat terkena checksum mismatch. Reset volume sekali:

```powershell
docker compose down -v
docker compose up --build
```

`docker compose down -v` menghapus named volume `postgres-data`, jadi jalankan hanya setelah backup jika data lokal masih diperlukan.

## 2. Local Database

`docker-compose.yml` memakai image:

```yaml
image: supabase/postgres:17.6.1.084
```

Service Postgres tetap memakai database/user/password lokal:

```text
POSTGRES_DB=diminspect
POSTGRES_USER=diminspect
POSTGRES_PASSWORD=diminspect
```

Command Postgres local juga menyetel:

```text
cron.database_name=diminspect
```

Ini diperlukan supaya `pg_cron` bisa dibuat dan menjalankan job di database local `diminspect`.

## 3. Schema Source of Truth

Schema utama ada di:

```text
backend/migrations/20240101000001_initial.up.sql
```

Perubahan utama:

- `timescaledb`, hypertable, compression, continuous aggregate, dan `time_bucket()` dihapus.
- `pg_partman` dibuat di schema `partman`.
- `pg_cron` dibuat untuk maintenance otomatis.
- `inspections` dibuat sebagai native partitioned table:

```sql
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
)
partition by range (timestamp);
```

`pg_partman` mendaftarkan parent table:

```sql
select partman.create_parent(
  p_parent_table := 'public.inspections',
  p_control := 'timestamp',
  p_type := 'range',
  p_interval := '7 days',
  p_premake := 8,
  p_start_partition := '2024-01-01 00:00:00+00'
);
```

Backend tetap aman karena query dashboard, history, dan quality tracking langsung membaca `inspections` dengan SQL Postgres biasa.

## 4. Verifikasi Local

Setelah `docker compose up --build`, cek extension:

```powershell
docker compose exec postgres psql -U diminspect -d diminspect -c "select extname from pg_extension where extname in ('pg_partman', 'pg_cron') order by extname;"
```

Cek parent table `inspections` adalah partitioned table:

```powershell
docker compose exec postgres psql -U diminspect -d diminspect -c "select relname, relkind from pg_class where relname = 'inspections';"
```

Nilai `relkind` harus `p`.

Cek konfigurasi `pg_partman`:

```powershell
docker compose exec postgres psql -U diminspect -d diminspect -c "select parent_table, control, partition_interval, premake from partman.part_config where parent_table = 'public.inspections';"
```

Cek child partitions:

```powershell
docker compose exec postgres psql -U diminspect -d diminspect -c "select inhrelid::regclass as partition_name from pg_inherits where inhparent = 'public.inspections'::regclass order by 1;"
```

Cek cron job:

```powershell
docker compose exec postgres psql -U diminspect -d diminspect -c "select jobname, schedule, command from cron.job where command like '%run_maintenance_proc%';"
```

Jalankan maintenance manual jika perlu:

```powershell
docker compose exec postgres psql -U diminspect -d diminspect -c "call partman.run_maintenance_proc();"
```

## 5. Setup Supabase

Buat project Supabase dengan Postgres 17. Ambil connection string direct atau session pooler, lalu simpan sebagai secret/backend env:

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=2
```

Untuk Cloud Run, gunakan Session Pooler atau Direct Connection. Hindari Transaction Pooler kecuali prepared statements SQLx sudah dimatikan.

Apply schema bisa dilakukan dengan menjalankan backend sekali memakai `DATABASE_URL` Supabase, karena backend menjalankan `sqlx::migrate!("./migrations")` saat init. Alternatif manual:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f .\backend\migrations\20240101000001_initial.up.sql
```

Setelah schema dibuat, ulangi query verifikasi extension, `partman.part_config`, child partitions, dan cron job pada database Supabase.

## 6. Import Data Lama

Jika ingin restore data dari backup lama, pastikan data `inspections.timestamp` berada pada atau setelah `2024-01-01`. Jika ada data lebih lama, buat partisi lama dulu sebelum restore.

Restore contoh:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
pg_restore `
  --dbname=$env:SUPABASE_DB_URL `
  --data-only `
  --disable-triggers `
  --table=public.event_log `
  --table=public.users `
  --table=public.parts `
  --table=public.inspections `
  --table=public.stations `
  --table=public.quality_records `
  .\backups\diminspect-before-pg-partman.dump
```

Jika restore dari database Timescale lama gagal pada `inspections`, export/import data table tersebut secara eksplisit dengan `COPY` atau dump data-only yang tidak membawa definisi hypertable.

## 7. Validasi Aplikasi

Jalankan check berikut setelah database local/Supabase siap:

```powershell
docker compose config
cd backend
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ..\frontend
npm run check
npm run build
```

Validasi perilaku:

- `GET /api/health` hijau.
- Login user seed berhasil.
- Agent ingest `POST /api/agent/inspections` menulis row baru ke `inspections`.
- Dashboard, History, dan Quality Tracking load normal.
- Query history tetap order by `timestamp desc`.
- R2 thumbnail tetap muncul jika object store aktif.

## 8. Catatan Legacy TimescaleDB

TimescaleDB masih bisa dipakai pada Supabase Postgres 15, tetapi bukan jalur yang direkomendasikan untuk proyek ini. Untuk Postgres 17, Supabase mengarahkan migrasi ke native partitioning dan `pg_partman`.

Fitur Timescale yang sudah dihapus dari schema DimInspect:

- `create extension timescaledb`
- `create_hypertable(...)`
- `alter table ... set (timescaledb.compress, ...)`
- continuous aggregate `dashboard_aggregates_daily`
- `time_bucket(...)`
- `add_continuous_aggregate_policy(...)`

Backend DimInspect tidak bergantung pada fitur tersebut karena aggregate dashboard dihitung langsung dari `inspections`.

## Referensi

- Supabase pg_partman extension: https://supabase.com/docs/guides/database/extensions/pg_partman
- Supabase migration from TimescaleDB to pg_partman: https://supabase.com/docs/guides/database/migrating-to-pg-partman
- Supabase Postgres 17 upgrade notes: https://supabase.com/docs/guides/platform/upgrading#upgrading-to-postgres-17
- Supabase Postgres connection strings/pooler: https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- Supabase migration from Postgres: https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres
