-- Add the top-level role used for user lifecycle administration.

BEGIN;

ALTER TYPE app_user_role ADD VALUE IF NOT EXISTS 'superadmin' BEFORE 'admin';

COMMIT;
