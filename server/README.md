# Aura One&Only API

This is the first backend bridge between the dashboard, QR generator, scanner, and Postgres.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set:

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DB_NAME
AUTH_SECRET=a-long-random-secret
CORS_ORIGIN=http://127.0.0.1:8080
```

3. Run migrations:

```bash
npm run db:migrate
```

4. Start the API:

```bash
npm run api
```

The API runs at:

```text
http://127.0.0.1:3000
```

## Netlify

For Netlify, set environment variables in:

```text
Site configuration -> Environment variables
```

Use:

```text
DATABASE_URL=your Supabase connection string
AUTH_SECRET=your long random secret
CORS_ORIGIN=https://aurabyzeus.netlify.app
```

`netlify.toml` routes `/api/*` to `netlify/functions/api.js`, which wraps the Express app.

## Demo Login

If `003_seed_demo.sql` has been applied:

```text
admin@oneonly.local / admin123       superadmin
events@oneonly.local / events123
```

The seed passwords use `DEV_ONLY_` placeholders for local development only. The login page does not prefill these credentials. Newly created users use Node `scrypt` hashes.

## Main Endpoints

```text
POST /api/auth/login
GET  /api/me
GET  /api/users                  admin/superadmin only
POST /api/users                  admin/superadmin only
DELETE /api/users/:id            superadmin only
GET  /api/events
POST /api/events
PATCH /api/events/:publicId
POST /api/events/:publicId/qr/generate
GET  /api/events/:publicId/qr
POST /api/check-in
GET  /api/events/:publicId/checkins
GET  /api/events/:publicId/checkins.csv
```

## QR Generation

Request:

```http
POST /api/events/evt_xxx/qr/generate
Authorization: Bearer TOKEN
Content-Type: application/json

{
  "counts": {
    "1": 20,
    "2": 10,
    "3": 5,
    "4": 0,
    "5": 2
  }
}
```

For an existing event, this endpoint adjusts the group counts:

- increasing a group adds new QR tokens
- decreasing a group removes unused QR tokens
- tokens with admissions are not removed

Response includes plaintext QR tokens and backup codes for newly generated entries, so the generator GUI can create ZIP files for organizers. The database stores token and backup-code hashes.

## Event Expiration

Event creation accepts an explicit expiration date:

```json
{
  "name": "Aura Gala",
  "eventDate": "2026-06-10",
  "expirationDate": "2026-06-11"
}
```

The database stores this as `valid_until`, and `check_in_guest(...)` rejects admission outside the validity window.

## Scanner Check-In

Request:

```http
POST /api/check-in
Authorization: Bearer TOKEN
Content-Type: application/json

{
  "eventPublicId": "evt_xxx",
  "scannerLabel": "Gate 1",
  "scannedValue": "TOKEN|CAP:3|evt_xxx|SIGNATURE",
  "admitCount": 1
}
```

Backup codes work through the same endpoint:

```json
{
  "eventPublicId": "evt_xxx",
  "scannerLabel": "Gate 1",
  "scannedValue": "123456",
  "admitCount": 1
}
```

The API parses the scanned value, validates event/signature when present, hashes the token or backup code, and calls Postgres `check_in_guest(...)` for atomic admission.

## Admission Results Export

Download scanner/check-in results as CSV:

```text
GET /api/events/:publicId/checkins.csv
```
