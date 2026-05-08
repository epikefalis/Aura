BEGIN;

CREATE TABLE IF NOT EXISTS event_scanner_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label text NOT NULL,
  pin_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  can_export_results boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_scanner_access_label_present CHECK (length(trim(label)) > 0),
  CONSTRAINT event_scanner_access_valid_window CHECK (valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_event_scanner_access_event ON event_scanner_access(event_id);
CREATE INDEX IF NOT EXISTS idx_event_scanner_access_active ON event_scanner_access(event_id, is_active);

DROP TRIGGER IF EXISTS trg_event_scanner_access_updated_at ON event_scanner_access;
CREATE TRIGGER trg_event_scanner_access_updated_at
BEFORE UPDATE ON event_scanner_access
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
