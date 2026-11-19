import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const PERMISSIONS = new Set(["read", "write"]);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

export function initializeProjectPeerStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_sync_peers (
      peer_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      permissions_json TEXT NOT NULL,
      require_participant INTEGER NOT NULL DEFAULT 1 CHECK(require_participant IN (0,1)),
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS project_sync_peers_project
      ON project_sync_peers(project_id, revoked_at);
  `);
  const columns = new Set(db.prepare("PRAGMA table_info(project_sync_peers)").all().map(column => column.name));
  // Existing peers retain legacy operation compatibility; newly issued peers require
  // participant attribution on every write.
  if (!columns.has("require_participant")) {
    db.exec("ALTER TABLE project_sync_peers ADD COLUMN require_participant INTEGER NOT NULL DEFAULT 0 CHECK(require_participant IN (0,1))");
  }
}

function digest(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

export function createProjectSyncPeer(db, projectId, {
  label = "Replica", permissions = ["read", "write"]
} = {}) {
  if (!nonEmpty(projectId)) throw new TypeError("projectId est requis.");
  if (!Array.isArray(permissions) || permissions.length === 0 ||
      permissions.some(permission => !PERMISSIONS.has(permission))) {
    throw new TypeError("Permissions de réplication invalides.");
  }
  initializeProjectPeerStore(db);
  const activeCount = db.prepare("SELECT COUNT(*) AS count FROM project_sync_peers WHERE project_id=? AND revoked_at IS NULL").get(projectId).count;
  if (activeCount >= 100) throw new Error("Limite de 100 pairs actifs atteinte pour ce projet.");
  const token = randomBytes(32).toString("base64url");
  const peerId = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO project_sync_peers
    (peer_id,project_id,label,token_hash,permissions_json,require_participant,created_at)
    VALUES(?,?,?,?,?,1,?)`).run(
      peerId, projectId, String(label).trim().slice(0, 120) || "Replica",
      digest(token).toString("hex"),
      JSON.stringify([...new Set(permissions)].sort()), createdAt
    );
  return { peerId, projectId, label: String(label).trim().slice(0, 120) || "Replica",
    permissions: [...new Set(permissions)].sort(), token, createdAt };
}

export function authenticateProjectSyncPeer(db, projectId, token, permission) {
  if (!nonEmpty(projectId) || !nonEmpty(token) || !PERMISSIONS.has(permission)) return null;
  initializeProjectPeerStore(db);
  const candidate = digest(token);
  const peers = db.prepare(`SELECT peer_id,token_hash,permissions_json,require_participant FROM project_sync_peers
    WHERE project_id=? AND revoked_at IS NULL`).all(projectId);
  for (const peer of peers) {
    const stored = Buffer.from(peer.token_hash, "hex");
    if (stored.length !== candidate.length || !timingSafeEqual(stored, candidate)) continue;
    const permissions = JSON.parse(peer.permissions_json);
    if (!permissions.includes(permission)) return null;
    return { peerId: peer.peer_id, projectId, permissions, requireParticipant: Boolean(peer.require_participant) };
  }
  return null;
}

export function revokeProjectSyncPeer(db, projectId, peerId) {
  initializeProjectPeerStore(db);
  const result = db.prepare(`UPDATE project_sync_peers SET revoked_at=?
    WHERE project_id=? AND peer_id=? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), projectId, peerId);
  return result.changes === 1;
}

export function listProjectSyncPeers(db, projectId) {
  initializeProjectPeerStore(db);
  return db.prepare(`SELECT peer_id AS peerId, project_id AS projectId, label,
    permissions_json AS permissionsJson, created_at AS createdAt, revoked_at AS revokedAt
    FROM project_sync_peers WHERE project_id=? ORDER BY created_at`).all(projectId)
    .map(peer => ({ ...peer, permissions: JSON.parse(peer.permissionsJson), permissionsJson: undefined }));
}
