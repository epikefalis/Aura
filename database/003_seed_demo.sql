-- Demo data for local development only.
-- Password hashes are placeholders until the API adds proper bcrypt/argon2 hashing.

BEGIN;

INSERT INTO app_users (id, email, display_name, password_hash, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@oneonly.local', 'Super Admin', 'DEV_ONLY_admin123', 'superadmin'),
  ('22222222-2222-2222-2222-222222222222', 'events@oneonly.local', 'Event Manager', 'DEV_ONLY_events123', 'event_user')
ON CONFLICT (email) DO NOTHING;

INSERT INTO events (
  id,
  public_id,
  name,
  event_date,
  valid_from,
  valid_until,
  status,
  owner_user_id,
  created_by_user_id
)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'evt_demo_aura',
  'Aura Demo Reception',
  current_date,
  date_trunc('day', now()) - interval '1 hour',
  date_trunc('day', now()) + interval '2 days',
  'active',
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111'
)
ON CONFLICT (public_id) DO NOTHING;

INSERT INTO scanners (id, label, event_id)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'Demo Zebra Gate 1',
  '33333333-3333-3333-3333-333333333333'
)
ON CONFLICT (id) DO NOTHING;

-- Demo raw QR token: AURA01
-- Demo raw backup code: 123456
INSERT INTO admission_tokens (
  id,
  event_id,
  token_hash,
  backup_code_hash,
  display_code,
  capacity,
  generated_by_user_id
)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  '33333333-3333-3333-3333-333333333333',
  digest('AURA01', 'sha256'),
  digest('123456', 'sha256'),
  'AURA01',
  3,
  '22222222-2222-2222-2222-222222222222'
)
ON CONFLICT (event_id, token_hash) DO NOTHING;

COMMIT;
