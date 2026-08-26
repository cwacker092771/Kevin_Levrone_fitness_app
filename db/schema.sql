CREATE TABLE IF NOT EXISTS daily_plans (
  plan_date DATE PRIMARY KEY,
  inputs JSONB NOT NULL,
  stats JSONB NOT NULL,
  groups JSONB NOT NULL,
  checked JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS body_metrics (
  metric_date DATE PRIMARY KEY,
  weight_lb NUMERIC(6,2),
  body_fat_pct NUMERIC(5,2),
  body_water_pct NUMERIC(5,2),
  muscle_pct NUMERIC(5,2),
  bone_mass_lb NUMERIC(5,2),
  bmi NUMERIC(5,2),
  bmr NUMERIC(6,1),
  visceral_fat NUMERIC(5,2),
  metabolic_age NUMERIC(5,1),
  protein_pct NUMERIC(5,2),
  subcutaneous_fat_pct NUMERIC(5,2),
  fat_free_weight_lb NUMERIC(6,2),
  skeletal_muscle_pct NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS body_water_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS muscle_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bone_mass_lb NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bmi NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bmr NUMERIC(6,1);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS visceral_fat NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS metabolic_age NUMERIC(5,1);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS protein_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS subcutaneous_fat_pct NUMERIC(5,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS fat_free_weight_lb NUMERIC(6,2);
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS skeletal_muscle_pct NUMERIC(5,2);

CREATE TABLE IF NOT EXISTS daily_notes (
  note_date DATE PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
