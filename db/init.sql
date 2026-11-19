CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('NORTH_LEFT', 'NORTH_RIGHT', 'MAIN_BANK', 'EAST_DOOR')),
  grid_row INTEGER NOT NULL,
  grid_col INTEGER NOT NULL,
  current_state TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (current_state IN ('WORKING', 'IDLE', 'ERROR', 'OFFLINE')),
  active_error TEXT NULL,
  last_seen_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS telemetry_events (
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  error_code TEXT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

SELECT create_hypertable('telemetry_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_machine_time
  ON telemetry_events (machine_id, time DESC);

CREATE TABLE IF NOT EXISTS coil_outcomes (
  id BIGSERIAL PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('COMPLETED', 'ABORTED')),
  reason_code TEXT NULL,
  duration_sec INTEGER NULL CHECK (duration_sec IS NULL OR duration_sec >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS error_glossary (
  error_code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  symptoms TEXT NOT NULL,
  fix_steps_md TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bug_reports (
  id BIGSERIAL PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  error_code TEXT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('Fiber Snap', 'Tension', 'Unit Dead', 'Bobbin Jam', 'Other')),
  worker_note TEXT NULL,
  photo_path TEXT NULL,
  attached_logs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
