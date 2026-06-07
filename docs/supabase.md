# Supabase Production Database Setup

Panduan ini adalah sumber utama setup database DimInspect untuk **initial production**. Database target adalah Supabase Postgres 17. Schema aplikasi tetap dikelola dari repo melalui migration SQLx, bukan dari Supabase client di frontend.

## 1. Target Arsitektur

- Database runtime: Supabase Postgres 17.
- Local parity: Docker memakai image `supabase/postgres:17.6.1.084`.
- Tabel time-series utama: `public.inspections`.
- Partitioning: native PostgreSQL range partitioning berdasarkan `timestamp`.
- Partition maintenance: `pg_partman` dengan job `pg_cron` harian.
- Backend: koneksi Postgres langsung lewat `DATABASE_URL`.
- Frontend: tetap lewat backend `/api/*`, tidak memakai Supabase client.
- Object storage: snapshot inspection tetap memakai Cloudflare R2 jika fitur object store diaktifkan.

Schema source of truth:

```text
backend/migrations/20240101000001_initial.up.sql
```

Dokumen ini mengasumsikan database production masih baru. Tidak ada jalur incremental migration di tahap ini.

## 2. Local Database

Local database didefinisikan di `docker-compose.yml`:

```yaml
postgres:
  image: supabase/postgres:17.6.1.084
  command:
    - postgres
    - -c
    - config_file=/etc/postgresql/postgresql.conf
    - -c
    - cron.database_name=diminspect
```

Credential local:

```text
POSTGRES_DB=diminspect
POSTGRES_USER=diminspect
POSTGRES_PASSWORD=diminspect
```

Untuk start dari schema bersih:

```powershell
docker compose down -v
docker compose up --build
```

`docker compose down -v` menghapus volume database local. Ini sesuai untuk initial production setup dan local parity testing.

## 3. Schema Database

Initial migration melakukan hal berikut:

- Membuat schema `partman`.
- Mengaktifkan extension `pg_partman`.
- Mengaktifkan extension `pg_cron`.
- Membuat tabel aplikasi: `event_log`, `users`, `parts`, `inspections`, `quality_records`, dan `schema_migrations`.
- Membuat `inspections` sebagai partitioned table.
- Mendaftarkan `public.inspections` ke `pg_partman`.
- Menjadwalkan maintenance partisi harian.

Konfigurasi partitioning utama:

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

`pg_partman` registration:

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

Maintenance job:

```sql
select cron.schedule(
  'partman-maintenance',
  '@daily',
  $$call partman.run_maintenance_proc()$$
);
```

Backend membaca dan menulis ke parent table `inspections`. PostgreSQL akan routing row ke partition yang sesuai.

## 4. Supabase Project Setup

Di Supabase Dashboard:

1. Buat project baru.
2. Pilih Postgres 17.
3. Simpan database password di password manager.
4. Ambil connection string **Session Pooler** untuk backend.

Untuk Cloud Run, local `psql` dari jaringan IPv4, dan runtime backend saat ini, gunakan **Session Pooler**. Jangan pakai Direct Connection sebagai default, karena host `db.<project-ref>.supabase.co` memakai IPv6 kecuali project memiliki IPv4 add-on.

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=2
```

Direct Connection hanya boleh dipakai jika environment sudah terbukti mendukung IPv6 atau project memakai Supabase IPv4 add-on. Transaction Pooler juga dihindari untuk runtime saat ini, karena backend Rust SQLx memakai prepared statements secara default.

## 5. Apply Schema

Cara utama: jalankan backend dengan `DATABASE_URL` Supabase. Backend akan menjalankan:

```rust
sqlx::migrate!("./migrations").run(&self.pool).await?;
```

Cara manual untuk setup database dari workstation:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f .\backend\migrations\20240101000001_initial.up.sql
```

Pilih salah satu cara saja untuk initial setup agar riwayat migration tetap jelas.

## 6. Verifikasi Database

Cek extension:

```sql
select extname
from pg_extension
where extname in ('pg_partman', 'pg_cron')
order by extname;
```

Expected:

```text
pg_cron
pg_partman
```

Cek `inspections` adalah partitioned table:

```sql
select relname, relkind
from pg_class
where relname = 'inspections';
```

Expected: `relkind = 'p'`.

Cek konfigurasi `pg_partman`:

```sql
select parent_table, control, partition_interval, premake
from partman.part_config
where parent_table = 'public.inspections';
```

Expected:

```text
parent_table = public.inspections
control = timestamp
partition_interval = 7 days
premake = 8
```

Cek child partitions:

```sql
select inhrelid::regclass as partition_name
from pg_inherits
where inhparent = 'public.inspections'::regclass
order by 1;
```

Cek cron job:

```sql
select jobname, schedule, command
from cron.job
where jobname = 'partman-maintenance';
```

Expected:

```text
schedule = @daily
command = call partman.run_maintenance_proc()
```

Jalankan maintenance manual bila ingin memastikan prosedur berjalan:

```sql
call partman.run_maintenance_proc();
```

## 7. Backend Environment

Minimal env production:

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=2
APP_TIMEZONE=Asia/Jakarta
JWT_SECRET=<strong-production-secret>
AGENT_TOKEN=<strong-agent-token>
```

Jika memakai MQTT:

```text
MQTT_HOST=<host>
MQTT_PORT=8883
MQTT_USERNAME=<username>
MQTT_PASSWORD=<password>
MQTT_TOPIC_PREFIX=diminspect/production
MQTT_USE_TLS=true
MQTT_WS_USERNAME=<subscribe-only-username>
MQTT_WS_PASSWORD=<subscribe-only-password>
```

`MQTT_USERNAME`/`MQTT_PASSWORD` dipakai backend dan agent sebagai publisher penuh. `MQTT_WS_USERNAME`/`MQTT_WS_PASSWORD` adalah kredensial broker khusus subscribe-only yang dikirim backend ke browser lewat `GET /api/realtime/mqtt`. Jika dikosongkan, backend fallback ke kredensial publisher penuh.

Jika memakai Cloudflare R2:

```text
OBJECT_STORE_ENABLED=true
OBJECT_STORE_BUCKET=diminspect-frames
OBJECT_STORE_ACCOUNT_ID=<account-id>
OBJECT_STORE_ACCESS_KEY_ID=<access-key-id>
OBJECT_STORE_SECRET_ACCESS_KEY=<secret-access-key>
```

Jika memakai Cloudflare Realtime:

```text
CLOUDFLARE_REALTIME_ENABLED=true
CLOUDFLARE_REALTIME_APP_ID=<app-id>
CLOUDFLARE_REALTIME_APP_SECRET=<app-secret>
```

Jangan menaruh database password, JWT secret, agent token, atau credential Cloudflare di frontend.

## 8. Security Notes

- Browser hanya mengakses backend DimInspect.
- Frontend tidak perlu Supabase anon key.
- Jangan expose `service_role` key ke client.
- Jangan grant akses Data API untuk tabel aplikasi kecuali memang akan memakai Supabase client secara sadar.
- Jika suatu saat tabel public diekspos melalui Supabase Data API, aktifkan RLS dan tulis policy sesuai role aplikasi terlebih dahulu.

## 9. Production Checklist

Database:

- [ ] Supabase project memakai Postgres 17.
- [ ] Schema berhasil dijalankan dari `backend/migrations/20240101000001_initial.up.sql`.
- [ ] `pg_partman` dan `pg_cron` aktif.
- [ ] `public.inspections` berstatus partitioned table.
- [ ] `partman.part_config` berisi `public.inspections`.
- [ ] Cron job `partman-maintenance` terdaftar.
- [ ] Query `call partman.run_maintenance_proc();` berhasil.

Backend:

- [ ] `DATABASE_URL` mengarah ke Supabase.
- [ ] `DATABASE_SSL=true`.
- [ ] `DATABASE_POOL_MAX=2` untuk runtime serverless/Cloud Run.
- [ ] `JWT_SECRET` dan `AGENT_TOKEN` sudah diganti dari default.
- [ ] Health endpoint hijau.

Application smoke test:

- [ ] Login user seed berhasil.
- [ ] Dashboard load.
- [ ] History load.
- [ ] Quality Tracking load.
- [ ] Agent presence muncul di Live Tracking via MQTT-over-WebSocket.
- [ ] Agent inspection ingest menulis row baru ke `inspections`.
- [ ] R2 thumbnail muncul jika object store aktif.

## 10. Local Validation Commands

```powershell
docker compose config
docker compose up --build
```

Backend checks:

```powershell
cd backend
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Frontend checks:

```powershell
cd frontend
npm run check
npm run build
```

Python agent syntax check:

```powershell
cd agent
python -m py_compile main.py config.py http_client.py mqtt_link.py webrtc_publisher.py vision.py
```

## Referensi

- Supabase pg_partman: https://supabase.com/docs/guides/database/extensions/pg_partman
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Postgres connection strings: https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- Supabase Postgres 17 upgrade notes: https://supabase.com/docs/guides/platform/upgrading#upgrading-to-postgres-17
