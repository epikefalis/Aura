# Aura One&Only Database

This folder defines the first Postgres contract for the admission platform.

## Files

- `001_initial_schema.sql` creates users, events, scanners, admission tokens, check-ins, and audit logs.
- `002_atomic_checkin.sql` creates `check_in_guest(...)`, the transaction-safe admission function.
- `003_seed_demo.sql` inserts local demo users, one active event, one scanner, and one token.
- `005_superadmin_role.sql` upgrades existing databases with the superadmin role.

## Core Rules

- Superadmins can see all events, create all user roles, and remove user access.
- Admin users can see all events and create event users or admins.
- Event users own their own events.
- QR tokens and backup codes are stored as SHA-256 hashes, not plaintext.
- Capacity is counted per token with `capacity` and `admitted_count`.
- Multiple scanners are safe because `check_in_guest(...)` locks the token row with `FOR UPDATE`.
- Scanners assigned to one event will reject QR payloads from another event with `wrong_event`.

## API Usage Shape

The backend should normalize scanned values before hashing:

```js
const normalized = scannedValue.trim().toUpperCase();
const hash = sha256(normalized);
```

For generator QR payloads like:

```text
TOKEN|CAP:3|evt_demo_aura|SIGNATURE
```

the API should extract:

- `TOKEN` as the scanned token
- `evt_demo_aura` as the event public ID
- requested admit count from the scanner UI, usually `1`

Then call:

```sql
SELECT *
FROM check_in_guest(
  p_event_public_id := 'evt_demo_aura',
  p_scanned_value_hash := digest('AURA01', 'sha256'),
  p_requested_admit_count := 1,
  p_scanner_id := '44444444-4444-4444-4444-444444444444',
  p_admitted_by_user_id := NULL,
  p_is_backup_code := false
);
```

For backup-code admission, hash the backup code and pass `p_is_backup_code := true`.

## Demo Check

After running all three SQL files, this should admit one person from a capacity-3 token:

```sql
SELECT *
FROM check_in_guest(
  'evt_demo_aura',
  digest('AURA01', 'sha256'),
  1,
  '44444444-4444-4444-4444-444444444444',
  NULL,
  false
);
```

Run it three times and the fourth call should return `fully_used`.
