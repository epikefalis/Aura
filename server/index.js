require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { pool, query } = require("./db");
const { createToken, hashPassword, verifyPassword, verifyToken } = require("./auth");
const {
  eventSignature,
  generateBackupCode,
  generateQrToken,
  parseScannedValue,
  publicEventId,
  qrPayload,
  sha256Buffer
} = require("./utils");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true
}));
app.use(express.json({ limit: "1mb" }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const result = await query(
    `SELECT id, email, display_name, role, is_active
     FROM app_users
     WHERE id = $1 AND is_active = true`,
    [payload.sub]
  );
  if (!result.rows[0]) {
    res.status(401).json({ error: "User is inactive or missing" });
    return;
  }
  req.user = result.rows[0];
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at
  };
}

function mapEvent(row) {
  const countsByCapacity = row.counts_by_capacity || {};
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    eventDate: row.event_date,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: row.status,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    tokenCount: Number(row.token_count || 0),
    totalCapacity: Number(row.total_capacity || 0),
    admittedCount: Number(row.admitted_count || 0),
    countsByCapacity,
    signature: eventSignature(row)
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const result = await query(
    `SELECT id, email, display_name, password_hash, role, is_active
     FROM app_users
     WHERE email = $1`,
    [email]
  );
  const user = result.rows[0];
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  res.json({
    token: createToken(user),
    user: mapUser(user)
  });
}));

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: mapUser(req.user) });
});

app.get("/api/users", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const result = await query(
    `SELECT id, email, display_name, role, is_active, created_at
     FROM app_users
     ORDER BY created_at DESC`
  );
  res.json({ users: result.rows.map(mapUser) });
}));

app.post("/api/users", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const displayName = String(req.body.displayName || "").trim();
  const password = String(req.body.password || "");
  const role = req.body.role === "admin" ? "admin" : "event_user";

  if (!email || !displayName || password.length < 8) {
    res.status(400).json({ error: "Email, display name, and 8+ character password are required" });
    return;
  }

  const result = await query(
    `INSERT INTO app_users (email, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, display_name, role, is_active, created_at`,
    [email, displayName, hashPassword(password), role]
  );
  res.status(201).json({ user: mapUser(result.rows[0]) });
}));

app.get("/api/events", requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let ownerFilter = "";
  if (req.user.role !== "admin") {
    params.push(req.user.id);
    ownerFilter = "WHERE e.owner_user_id = $1";
  }
  const result = await query(
    `SELECT e.*,
            u.display_name AS owner_name,
            COUNT(t.id) AS token_count,
            COALESCE(SUM(t.capacity), 0) AS total_capacity,
            COALESCE(SUM(t.admitted_count), 0) AS admitted_count,
            COALESCE(cap_counts.counts_by_capacity, '{}'::jsonb) AS counts_by_capacity
     FROM events e
     JOIN app_users u ON u.id = e.owner_user_id
     LEFT JOIN admission_tokens t ON t.event_id = e.id
     LEFT JOIN LATERAL (
       SELECT jsonb_object_agg(capacity, count ORDER BY capacity) AS counts_by_capacity
       FROM (
         SELECT capacity, COUNT(*)::int AS count
         FROM admission_tokens
         WHERE event_id = e.id
         GROUP BY capacity
       ) grouped_counts
     ) cap_counts ON true
     ${ownerFilter}
     GROUP BY e.id, u.display_name, cap_counts.counts_by_capacity
     ORDER BY e.event_date DESC, e.created_at DESC`,
    params
  );
  res.json({ events: result.rows.map(mapEvent) });
}));

app.post("/api/events", requireAuth, asyncRoute(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const eventDate = String(req.body.eventDate || "").trim();
  const expirationDate = String(req.body.expirationDate || req.body.validUntil || eventDate).trim();
  const ownerUserId = req.user.role === "admin" && req.body.ownerUserId ? req.body.ownerUserId : req.user.id;
  const status = req.body.status || "planned";

  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
    res.status(400).json({ error: "Event name, event date, and expiration date are required" });
    return;
  }
  if (expirationDate < eventDate) {
    res.status(400).json({ error: "Expiration date cannot be before event date" });
    return;
  }

  const result = await query(
    `INSERT INTO events (
       public_id, name, event_date, valid_from, valid_until, status, owner_user_id, created_by_user_id
     )
     VALUES (
       $1, $2, $3, $3::date, $4::date + interval '1 day', $5, $6, $7
     )
     RETURNING *`,
    [publicEventId(), name, eventDate, expirationDate, status, ownerUserId, req.user.id]
  );
  res.status(201).json({ event: mapEvent(result.rows[0]) });
}));

app.patch("/api/events/:publicId", requireAuth, asyncRoute(async (req, res) => {
  const currentResult = await query(
    `SELECT *
     FROM events
     WHERE public_id = $1
       AND ($2::text = 'admin' OR owner_user_id = $3)`,
    [req.params.publicId, req.user.role, req.user.id]
  );
  const current = currentResult.rows[0];
  if (!current) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const name = String(req.body.name || current.name).trim();
  const eventDate = String(req.body.eventDate || current.event_date).slice(0, 10);
  const expirationDate = String(req.body.expirationDate || current.valid_until).slice(0, 10);
  const status = req.body.status || current.status;

  if (expirationDate < eventDate) {
    res.status(400).json({ error: "Expiration date cannot be before event date" });
    return;
  }

  const result = await query(
    `UPDATE events
     SET name = $1,
         event_date = $2,
         valid_from = $2::date,
         valid_until = $3::date + interval '1 day',
         status = $4
     WHERE id = $5
     RETURNING *`,
    [name, eventDate, expirationDate, status, current.id]
  );
  res.json({ event: mapEvent(result.rows[0]) });
}));

app.delete("/api/events/:publicId", requireAuth, asyncRoute(async (req, res) => {
  const result = await query(
    `DELETE FROM events
     WHERE public_id = $1
       AND ($2::text = 'admin' OR owner_user_id = $3)
     RETURNING id`,
    [req.params.publicId, req.user.role, req.user.id]
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json({ ok: true });
}));

app.post("/api/events/:publicId/qr/generate", requireAuth, asyncRoute(async (req, res) => {
  const counts = req.body.counts || {};
  const eventResult = await query(
    `SELECT e.*
     FROM events e
     WHERE e.public_id = $1
       AND ($2::text = 'admin' OR e.owner_user_id = $3)`,
    [req.params.publicId, req.user.role, req.user.id]
  );
  const event = eventResult.rows[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const normalizedCounts = [1, 2, 3, 4, 5].map(capacity => ({
    capacity,
    count: Math.max(0, Number(counts[capacity] || counts[String(capacity)] || 0))
  }));
  const total = normalizedCounts.reduce((sum, item) => sum + item.count, 0);
  if (!total) {
    res.status(400).json({ error: "At least one QR code must be requested" });
    return;
  }
  if (total > 5000) {
    res.status(400).json({ error: "Cannot generate more than 5000 QR codes in one request" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingTokenResult = await client.query(
      `SELECT display_code FROM admission_tokens WHERE event_id = $1`,
      [event.id]
    );
    const existingTokens = new Set(existingTokenResult.rows.map(row => row.display_code));
    const existingBackups = new Set();
    const generated = [];

    for (const { capacity, count } of normalizedCounts) {
      const currentResult = await client.query(
        `SELECT id, display_code, admitted_count
         FROM admission_tokens
         WHERE event_id = $1 AND capacity = $2 AND status = 'active'
         ORDER BY created_at ASC
         FOR UPDATE`,
        [event.id, capacity]
      );
      const current = currentResult.rows;
      const delta = count - current.length;

      if (delta < 0) {
        const removeCount = Math.abs(delta);
        const removable = current.filter(row => Number(row.admitted_count) === 0).slice(0, removeCount);
        if (removable.length < removeCount) {
          const error = new Error(`Cannot remove ${removeCount} QR from ${capacity}-guest group because some have admissions.`);
          error.statusCode = 400;
          throw error;
        }
        await client.query(
          `DELETE FROM admission_tokens WHERE id = ANY($1::uuid[])`,
          [removable.map(row => row.id)]
        );
      }

      for (let index = 0; index < Math.max(delta, 0); index += 1) {
        const token = generateQrToken(existingTokens);
        const backupCode = generateBackupCode(existingBackups);
        await client.query(
          `INSERT INTO admission_tokens (
             event_id, token_hash, backup_code_hash, display_code, capacity, generated_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [event.id, sha256Buffer(token), sha256Buffer(backupCode), token, capacity, req.user.id]
        );
        generated.push({
          qrToken: token,
          backupCode,
          capacity,
          payload: qrPayload(event, token, capacity)
        });
      }
    }

    await client.query("COMMIT");
    res.status(201).json({
      event: mapEvent(event),
      qrEntries: generated
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.get("/api/events/:publicId/qr", requireAuth, asyncRoute(async (req, res) => {
  const result = await query(
    `SELECT t.id, t.display_code, t.capacity, t.admitted_count, t.status, t.created_at
     FROM admission_tokens t
     JOIN events e ON e.id = t.event_id
     WHERE e.public_id = $1
       AND ($2::text = 'admin' OR e.owner_user_id = $3)
     ORDER BY t.capacity, t.display_code`,
    [req.params.publicId, req.user.role, req.user.id]
  );
  res.json({
    tokens: result.rows.map(row => ({
      id: row.id,
      displayCode: row.display_code,
      capacity: row.capacity,
      admittedCount: row.admitted_count,
      status: row.status,
      createdAt: row.created_at
    }))
  });
}));

app.post("/api/check-in", requireAuth, asyncRoute(async (req, res) => {
  const parsed = parseScannedValue(req.body.scannedValue);
  const requestedEvent = req.body.eventPublicId || parsed.eventPublicId;
  const requestedAdmitCount = Math.max(1, Math.min(20, Number(req.body.admitCount || 1)));
  const scannerLabel = String(req.body.scannerLabel || "Scanner").trim();

  if (!requestedEvent || !parsed.token) {
    res.status(400).json({ error: "Event public ID and scanned value are required" });
    return;
  }

  const eventResult = await query("SELECT * FROM events WHERE public_id = $1", [requestedEvent]);
  const event = eventResult.rows[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (parsed.eventPublicId && parsed.eventPublicId !== requestedEvent) {
    res.status(409).json({ result: "wrong_event", message: "Scanned QR belongs to another event" });
    return;
  }
  if (parsed.signature && parsed.signature !== eventSignature(event)) {
    res.status(400).json({ result: "invalid", message: "Invalid QR signature" });
    return;
  }

  const scannerResult = await query(
    `INSERT INTO scanners (label, event_id, last_seen_at)
     VALUES ($1, $2, now())
     RETURNING id`,
    [scannerLabel || "Scanner", event.id]
  );

  const checkinResult = await query(
    `SELECT *
     FROM check_in_guest(
       p_event_public_id := $1,
       p_scanned_value_hash := $2,
       p_requested_admit_count := $3,
       p_scanner_id := $4,
       p_admitted_by_user_id := $5,
       p_is_backup_code := $6
     )`,
    [
      requestedEvent,
      sha256Buffer(parsed.token),
      requestedAdmitCount,
      scannerResult.rows[0].id,
      req.user.id,
      parsed.mode === "backup"
    ]
  );

  res.json({
    checkin: checkinResult.rows[0],
    parsed: {
      mode: parsed.mode,
      eventPublicId: parsed.eventPublicId || requestedEvent
    }
  });
}));

app.get("/api/events/:publicId/checkins", requireAuth, asyncRoute(async (req, res) => {
  const result = await query(
    `SELECT c.*, t.display_code, s.label AS scanner_label
     FROM checkins c
     JOIN events e ON e.id = c.event_id
     LEFT JOIN admission_tokens t ON t.id = c.token_id
     LEFT JOIN scanners s ON s.id = c.scanner_id
     WHERE e.public_id = $1
       AND ($2::text = 'admin' OR e.owner_user_id = $3)
     ORDER BY c.created_at DESC
     LIMIT 200`,
    [req.params.publicId, req.user.role, req.user.id]
  );
  res.json({ checkins: result.rows });
}));

app.get("/api/events/:publicId/checkins.csv", requireAuth, asyncRoute(async (req, res) => {
  const result = await query(
    `SELECT e.public_id,
            e.name AS event_name,
            c.created_at,
            s.label AS scanner_label,
            c.result,
            t.display_code,
            c.requested_admit_count,
            c.admitted_count,
            c.remaining_after,
            c.message
     FROM checkins c
     JOIN events e ON e.id = c.event_id
     LEFT JOIN admission_tokens t ON t.id = c.token_id
     LEFT JOIN scanners s ON s.id = c.scanner_id
     WHERE e.public_id = $1
       AND ($2::text = 'admin' OR e.owner_user_id = $3)
     ORDER BY c.created_at ASC`,
    [req.params.publicId, req.user.role, req.user.id]
  );
  const rows = [[
    "event_id",
    "event_name",
    "created_at",
    "scanner",
    "result",
    "display_code",
    "requested_count",
    "admitted_count",
    "remaining_after",
    "message"
  ]];
  result.rows.forEach(row => {
    rows.push([
      row.public_id,
      row.event_name,
      row.created_at,
      row.scanner_label,
      row.result,
      row.display_code,
      row.requested_admit_count,
      row.admitted_count,
      row.remaining_after,
      row.message
    ]);
  });
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.publicId}_admission_results.csv"`);
  res.send(csv);
}));

app.delete("/api/events/:publicId/checkins", requireAuth, asyncRoute(async (req, res) => {
  const eventResult = await query(
    `SELECT *
     FROM events
     WHERE public_id = $1
       AND ($2::text = 'admin' OR owner_user_id = $3)`,
    [req.params.publicId, req.user.role, req.user.id]
  );
  const event = eventResult.rows[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM checkins WHERE event_id = $1", [event.id]);
    await client.query("UPDATE admission_tokens SET admitted_count = 0 WHERE event_id = $1", [event.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error", detail: error.message });
});

app.listen(port, () => {
  console.log(`Aura API running at http://127.0.0.1:${port}`);
});
