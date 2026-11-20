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
  outcome TEXT NOT NULL CONSTRAINT coil_outcomes_outcome_esp32_check CHECK (outcome IN ('AUTO_FINISHED', 'ABORTED', 'FAULT_TERMINATED')),
  reason_code TEXT NULL,
  duration_sec INTEGER NULL CHECK (duration_sec IS NULL OR duration_sec >= 0),
  wound_length DOUBLE PRECISION NULL CONSTRAINT coil_outcomes_wound_length_nonneg_check CHECK (wound_length IS NULL OR wound_length >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'coil_outcomes'
      AND column_name = 'wound_length'
  ) THEN
    ALTER TABLE coil_outcomes
      ADD COLUMN wound_length DOUBLE PRECISION NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'coil_outcomes'::regclass
      AND conname = 'coil_outcomes_outcome_esp32_check'
  ) THEN
    FOR constraint_rec IN
      SELECT c.conname
      FROM pg_constraint c
      WHERE c.conrelid = 'coil_outcomes'::regclass
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%outcome%'
        AND c.conname <> 'coil_outcomes_outcome_esp32_check'
    LOOP
      EXECUTE format('ALTER TABLE coil_outcomes DROP CONSTRAINT %I', constraint_rec.conname);
    END LOOP;

    UPDATE coil_outcomes
    SET outcome = 'AUTO_FINISHED'
    WHERE outcome = 'COMPLETED';

    ALTER TABLE coil_outcomes
      ADD CONSTRAINT coil_outcomes_outcome_esp32_check
      CHECK (outcome IN ('AUTO_FINISHED', 'ABORTED', 'FAULT_TERMINATED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'coil_outcomes'::regclass
      AND conname = 'coil_outcomes_wound_length_nonneg_check'
  ) THEN
    ALTER TABLE coil_outcomes
      ADD CONSTRAINT coil_outcomes_wound_length_nonneg_check
      CHECK (wound_length IS NULL OR wound_length >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coil_outcomes_machine_created_at
  ON coil_outcomes (machine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coil_outcomes_created_at
  ON coil_outcomes (created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'coil_rollup_machine'
      AND column_name = 'total_wound_length'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'coil_rollup_machine'
      AND column_name = 'completed_count'
  ) THEN
    DROP VIEW IF EXISTS coil_rollup_machine;
    CREATE VIEW coil_rollup_machine AS
    WITH windows AS (
      SELECT 'TODAY'::text AS time_window, 1 AS window_order, date_trunc('day', NOW()) AS window_start
      UNION ALL
      SELECT 'WEEK'::text AS time_window, 2 AS window_order, date_trunc('week', NOW()) AS window_start
      UNION ALL
      SELECT 'MONTH'::text AS time_window, 3 AS window_order, date_trunc('month', NOW()) AS window_start
      UNION ALL
      SELECT 'ALL_TIME'::text AS time_window, 4 AS window_order, NULL::timestamptz AS window_start
    )
    SELECT
      m.id AS machine_id,
      w.time_window,
      COUNT(co.id) FILTER (WHERE co.outcome = 'AUTO_FINISHED')::integer AS auto_finished_count,
      COUNT(co.id) FILTER (WHERE co.outcome = 'ABORTED')::integer AS aborted_count,
      COUNT(co.id) FILTER (WHERE co.outcome = 'FAULT_TERMINATED')::integer AS fault_terminated_count,
      COUNT(co.id)::integer AS total_count,
      COALESCE(SUM(co.wound_length), 0)::double precision AS total_wound_length
    FROM machines m
    CROSS JOIN windows w
    LEFT JOIN coil_outcomes co
      ON co.machine_id = m.id
      AND (w.window_start IS NULL OR co.created_at >= w.window_start)
    GROUP BY m.id, w.time_window, w.window_order
    ORDER BY m.id ASC, w.window_order ASC;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'coil_rollup_room'
      AND column_name = 'total_wound_length'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'coil_rollup_room'
      AND column_name = 'completed_count'
  ) THEN
    DROP VIEW IF EXISTS coil_rollup_room;
    CREATE VIEW coil_rollup_room AS
    WITH windows AS (
      SELECT 'TODAY'::text AS time_window, 1 AS window_order, date_trunc('day', NOW()) AS window_start
      UNION ALL
      SELECT 'WEEK'::text AS time_window, 2 AS window_order, date_trunc('week', NOW()) AS window_start
      UNION ALL
      SELECT 'MONTH'::text AS time_window, 3 AS window_order, date_trunc('month', NOW()) AS window_start
      UNION ALL
      SELECT 'ALL_TIME'::text AS time_window, 4 AS window_order, NULL::timestamptz AS window_start
    )
    SELECT
      w.time_window,
      COUNT(co.id) FILTER (WHERE co.outcome = 'AUTO_FINISHED')::integer AS auto_finished_count,
      COUNT(co.id) FILTER (WHERE co.outcome = 'ABORTED')::integer AS aborted_count,
      COUNT(co.id) FILTER (WHERE co.outcome = 'FAULT_TERMINATED')::integer AS fault_terminated_count,
      COUNT(co.id)::integer AS total_count,
      COALESCE(SUM(co.wound_length), 0)::double precision AS total_wound_length
    FROM windows w
    LEFT JOIN coil_outcomes co
      ON w.window_start IS NULL OR co.created_at >= w.window_start
    GROUP BY w.time_window, w.window_order
    ORDER BY w.window_order ASC;
  END IF;
END $$;

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
