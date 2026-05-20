-- Promote the local demo admin after the superadmin enum value exists.

BEGIN;

UPDATE app_users
SET role = 'superadmin'
WHERE email = 'admin@oneonly.local';

COMMIT;
