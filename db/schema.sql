-- ---------------------------------------------------------------------------
-- Users & sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

-- Introducing email verification: add the flag to databases that predate it and,
-- the first time it appears, drop every existing session so all current users
-- must log in again and verify. Runs once - the guard makes reboots a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
    DELETE FROM sessions;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- One-time email verification tokens. A user has at most one live token; issuing
-- a new one (register / resend) replaces the old.
CREATE TABLE IF NOT EXISTS email_verifications (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS email_verifications_user_id_idx ON email_verifications (user_id);

-- One row per licensed user. Accounts with no row here have not chosen a tier
-- yet and are shown the plan picker before they can use the app.
CREATE TABLE IF NOT EXISTS licenses (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  addon TEXT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Back-fill for databases created before the coaching add-on existed.
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS addon TEXT;

-- ---------------------------------------------------------------------------
-- Per-user data tables
--
-- Each table is keyed by (user_id, date). The blocks below are idempotent so
-- schema.sql can run on every boot: on a fresh database CREATE TABLE builds the
-- final shape directly; on a database created before multi-user support the
-- ALTER/DO blocks migrate it. Rows that predate multi-user support have no
-- owner and are deleted during migration.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_plans (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  inputs JSONB NOT NULL,
  stats JSONB NOT NULL,
  groups JSONB NOT NULL,
  checked JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plan_date)
);

CREATE TABLE IF NOT EXISTS body_metrics (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  weight_lb NUMERIC(6,2),
  body_fat_pct NUMERIC(5,2),
  body_water_pct NUMERIC(5,2),
  muscle_pct NUMERIC(5,2),
  muscle_mass_lb NUMERIC(6,2),
  bone_mass_lb NUMERIC(5,2),
  bmi NUMERIC(5,2),
  bmr NUMERIC(6,1),
  visceral_fat NUMERIC(5,2),
  metabolic_age NUMERIC(5,1),
  protein_pct NUMERIC(5,2),
  subcutaneous_fat_pct NUMERIC(5,2),
  fat_free_weight_lb NUMERIC(6,2),
  skeletal_muscle_pct NUMERIC(5,2),
  heart_rate_bpm NUMERIC(5,1),
  -- RENPHO MorphoScan segmental scale reports these on top of the standard set.
  body_fat_mass_lb NUMERIC(6,2),
  skeletal_muscle_mass_lb NUMERIC(6,2),
  body_water_mass_lb NUMERIC(6,2),
  phase_angle_deg NUMERIC(4,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, metric_date)
);

CREATE TABLE IF NOT EXISTS daily_notes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, note_date)
);

-- Column back-fills for databases created before these columns existed.
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS body_water_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS muscle_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS muscle_mass_lb NUMERIC(6,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bone_mass_lb NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bmi NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bmr NUMERIC(6,1);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS visceral_fat NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS metabolic_age NUMERIC(5,1);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS protein_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS subcutaneous_fat_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS fat_free_weight_lb NUMERIC(6,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS skeletal_muscle_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS heart_rate_bpm NUMERIC(5,1);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS body_fat_mass_lb NUMERIC(6,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS skeletal_muscle_mass_lb NUMERIC(6,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS body_water_mass_lb NUMERIC(6,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS phase_angle_deg NUMERIC(4,2);

-- Multi-user migration: add user_id, drop pre-multi-user rows, switch the
-- primary key to (user_id, <date>). Each block is a no-op once applied.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('daily_plans',  'plan_date'),
      ('body_metrics', 'metric_date'),
      ('daily_notes',  'note_date')
    ) AS v(tbl, datecol)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = rec.tbl AND column_name = 'user_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE', rec.tbl);
      EXECUTE format('DELETE FROM %I WHERE user_id IS NULL', rec.tbl);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id SET NOT NULL', rec.tbl);
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', rec.tbl, rec.tbl || '_pkey');
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (user_id, %I)', rec.tbl, rec.datecol);
    END IF;
  END LOOP;
END $$;
