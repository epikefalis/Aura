const crypto = require("crypto");

function normalizeToken(value) {
  return String(value || "").trim().toUpperCase();
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(normalizeToken(value)).digest();
}

function publicEventId() {
  return `evt_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
}

function generateQrToken(existing) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "";
  do {
    token = Array.from(crypto.randomBytes(6), byte => chars[byte % chars.length]).join("");
  } while (existing.has(token));
  existing.add(token);
  return token;
}

function generateBackupCode(existing) {
  let code = "";
  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while (existing.has(code));
  existing.add(code);
  return code;
}

function eventSignature(event) {
  const secret = process.env.AUTH_SECRET || "dev-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`${event.public_id}|${event.name}|${event.event_date}`)
    .digest("base64url")
    .slice(0, 16);
}

function qrPayload(event, token, capacity) {
  return `${token}|CAP:${capacity}|${event.public_id}|${eventSignature(event)}`;
}

function parseScannedValue(value) {
  const raw = String(value || "").trim();
  const parts = raw.split("|").map(part => part.trim());
  if (parts.length >= 4 && /^CAP:\d+$/i.test(parts[1])) {
    return {
      mode: "qr",
      raw,
      token: normalizeToken(parts[0]),
      capacity: Number(parts[1].split(":")[1]),
      eventPublicId: parts[2],
      signature: parts[3]
    };
  }
  return {
    mode: /^\d{6}$/.test(raw) ? "ambiguous_numeric" : "qr",
    raw,
    token: normalizeToken(raw)
  };
}

module.exports = {
  eventSignature,
  generateBackupCode,
  generateQrToken,
  normalizeToken,
  parseScannedValue,
  publicEventId,
  qrPayload,
  sha256Buffer
};
