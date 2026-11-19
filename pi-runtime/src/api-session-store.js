import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function initializeApiSessionStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_sessions (
      token_hash TEXT PRIMARY KEY,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS api_sessions_expiry ON api_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS api_sessions_principal ON api_sessions(principal_type,principal_id);
  `);
}

export function issueApiSession(db, { principalType, principalId, ttlMs = SESSION_TTL_MS }) {
  if (typeof principalType !== "string" || !principalType.trim() ||
      typeof principalId !== "string" || !principalId.trim()) {
    throw new TypeError("Une identité authentifiée est requise pour ouvrir une session API.");
  }
  initializeApiSessionStore(db);
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  const now = createdAt.toISOString();
  db.prepare("DELETE FROM api_sessions WHERE expires_at<=?").run(now);
  db.prepare(`INSERT INTO api_sessions(token_hash,principal_type,principal_id,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?)`).run(hashToken(token), principalType, principalId, now, expiresAt.toISOString(), now);
  return { token, expiresAt: expiresAt.toISOString() };
}

export function resolveApiSession(db, token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 512) return null;
  initializeApiSessionStore(db);
  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT * FROM api_sessions WHERE token_hash=?").get(tokenHash);
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    if (row) db.prepare("DELETE FROM api_sessions WHERE token_hash=?").run(tokenHash);
    return null;
  }
  db.prepare("UPDATE api_sessions SET last_seen_at=? WHERE token_hash=?")
    .run(new Date().toISOString(), tokenHash);
  return {
    principalType: row.principal_type,
    principalId: row.principal_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

export function revokeApiSession(db, token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 512) return false;
  initializeApiSessionStore(db);
  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT token_hash FROM api_sessions WHERE token_hash=?").get(tokenHash);
  if (!row) return false;
  db.prepare("DELETE FROM api_sessions WHERE token_hash=?").run(tokenHash);
  return true;
}

export function apiSessionTokenMatches(db, token, principalType, principalId) {
  const session = resolveApiSession(db, token);
  if (!session) return false;
  const expected = principalType + ":" + principalId;
  const actual = session.principalType + ":" + session.principalId;
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
