const crypto = require("crypto");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith("DEV_ONLY_")) return storedHash === `DEV_ONLY_${password}`;
  const [scheme, salt, hash] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createToken(user) {
  const payload = {
    sub: user.id,
    role: user.role,
    kind: "user",
    exp: Date.now() + TOKEN_TTL_MS
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function createScannerToken(scannerAccess, event) {
  const payload = {
    sub: scannerAccess.id,
    kind: "scanner",
    eventId: event.id,
    eventPublicId: event.public_id,
    canExportResults: scannerAccess.can_export_results,
    exp: Date.now() + TOKEN_TTL_MS
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  if (signature !== sign(encoded)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  createToken,
  createScannerToken,
  hashPassword,
  verifyPassword,
  verifyToken
};
