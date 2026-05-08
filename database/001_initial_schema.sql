-- Aura One&Only event admission database
-- PostgreSQL 14+

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE app_user_role AS ENUM ('admin', 'event_user');
CREATE TYPE event_status AS ENUM ('draft', 'planned', 'active', 'closed', 'cancelled');
CREATE TYPE scanner_status AS ENUM ('active', 'disabled');
CREATE TYPE token_status AS ENUM ('active', 'revoked', 'void');
CREATE TYPE checkin_result AS ENUM (
  'admitted',
  'partially_admitted',
  'fully_used',
  'invalid',
  'wrong_event',
  'revoked',
  'event_not_active'
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role app_user_role NOT NULL DEFAULT 'event_user',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_email_normalized CHECK (email = lower(trim(email))),
  CONSTRAINT app_users_display_name_present CHECK (length(trim(display_name)) > 0)
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  name text NOT NULL,
  event_date date NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status event_status NOT NULL DEFAULT 'draft',
  owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_name_present CHECK (length(trim(name)) > 0),
  CONSTRAINT events_valid_window CHECK (valid_until > valid_from)
);

CREATE TABLE scanners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  status scanner_status NOT NULL DEFAULT 'active',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scanners_label_present CHECK (length(trim(label)) > 0)
);

CREATE TABLE admission_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  backup_code_hash bytea,
  display_code text NOT NULL,
  capacity integer NOT NULL,
  admitted_count integer NOT NULL DEFAULT 0,
  status token_status NOT NULL DEFAULT 'active',
  generated_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_tokens_capacity_range CHECK (capacity BETWEEN 1 AND 20),
  CONSTRAINT admission_tokens_admitted_range CHECK (admitted_count BETWEEN 0 AND capacity),
  CONSTRAINT admission_tokens_display_code_present CHECK (length(trim(display_code)) > 0),
  UNIQUE (event_id, token_hash),
  UNIQUE (event_id, backup_code_hash)
);

CREATE TABLE checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  token_id uuid REFERENCES admission_tokens(id) ON DELETE SET NULL,
  scanner_id uuid REFERENCES scanners(id) ON DELETE SET NULL,
  admitted_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  scanned_value_hash bytea,
  requested_admit_count integer NOT NULL DEFAULT 1,
  admitted_count integer NOT NULL DEFAULT 0,
  remaining_after integer,
  result checkin_result NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkins_requested_positive CHECK (requested_admit_count > 0),
  CONSTRAINT checkins_admitted_nonnegative CHECK (admitted_count >= 0)
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_present CHECK (length(trim(action)) > 0),
  CONSTRAINT audit_log_entity_type_present CHECK (length(trim(entity_type)) > 0)
);

CREATE INDEX idx_events_owner_date ON events(owner_user_id, event_date);
CREATE INDEX idx_events_status_date ON events(status, event_date);
CREATE INDEX idx_scanners_event ON scanners(event_id);
CREATE INDEX idx_admission_tokens_event_status ON admission_tokens(event_id, status);
CREATE INDEX idx_checkins_event_created ON checkins(event_id, created_at DESC);
CREATE INDEX idx_checkins_token_created ON checkins(token_id, created_at DESC);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_admission_tokens_updated_at
BEFORE UPDATE ON admission_tokens
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
