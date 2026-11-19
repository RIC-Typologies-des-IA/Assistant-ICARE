import { randomUUID } from "node:crypto";
import { getDiscordProjectAccess, grantDiscordProjectMember } from "../discord-access.js";

export function initializeMembershipRequestStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_membership_requests (
      request_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      principal_type TEXT NOT NULL CHECK(principal_type='discord'),
      principal_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled')),
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_membership_requests_one_pending
      ON project_membership_requests(project_id, principal_type, principal_id)
      WHERE status='pending';
    CREATE INDEX IF NOT EXISTS project_membership_requests_pending
      ON project_membership_requests(project_id, requested_at)
      WHERE status='pending';
  `);
}

function assertProjectId(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Identifiant de projet invalide.");
}
function assertDiscordUserId(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Identifiant Discord invalide.");
}

/** A request records intent only; it never creates membership or grants a role. */
export function requestDiscordProjectMembership(db, { projectId, discordUserId, requestedAt = new Date().toISOString() }) {
  assertProjectId(projectId);
  assertDiscordUserId(discordUserId);
  if (getDiscordProjectAccess(db, projectId, discordUserId)) {
    return { alreadyMember: true, request: null };
  }
  const pending = db.prepare(`
    SELECT * FROM project_membership_requests
    WHERE project_id=? AND principal_type='discord' AND principal_id=? AND status='pending'
  `).get(projectId, discordUserId);
  if (pending) return { alreadyMember: false, duplicate: true, request: pending };

  const request = {
    request_id: randomUUID(), project_id: projectId,
    principal_type: "discord", principal_id: discordUserId,
    status: "pending", requested_at: requestedAt
  };
  db.prepare(`
    INSERT INTO project_membership_requests
      (request_id,project_id,principal_type,principal_id,status,requested_at)
    VALUES (?,?,?,?,?,?)
  `).run(request.request_id, projectId, "discord", discordUserId, "pending", requestedAt);
  return { alreadyMember: false, duplicate: false, request };
}

function requireOwner(db, projectId, actorDiscordUserId) {
  assertDiscordUserId(actorDiscordUserId);
  const access = getDiscordProjectAccess(db, projectId, actorDiscordUserId);
  if (!access || access.role !== "owner" || access.roleConflict) {
    throw new Error("Seul un propriétaire actif peut traiter une demande d'adhésion.");
  }
}

export function listPendingDiscordMembershipRequests(db, { projectId, actorDiscordUserId }) {
  assertProjectId(projectId);
  requireOwner(db, projectId, actorDiscordUserId);
  return db.prepare(`
    SELECT request_id,project_id,principal_type,principal_id,status,requested_at
    FROM project_membership_requests
    WHERE project_id=? AND status='pending'
    ORDER BY requested_at,request_id
  `).all(projectId);
}

/** Only an owner can decide. Acceptance is retry-safe across the CRDT and request-status writes. */
export function decideDiscordMembershipRequest(db, {
  projectId, requestId, actorDiscordUserId, decision, decidedAt = new Date().toISOString()
}) {
  assertProjectId(projectId);
  if (!["accepted", "rejected"].includes(decision)) throw new TypeError("Décision d'adhésion invalide.");

  requireOwner(db, projectId, actorDiscordUserId);
  const request = db.prepare(`
    SELECT * FROM project_membership_requests
    WHERE request_id=? AND project_id=? AND status='pending'
  `).get(requestId, projectId);
  if (!request) throw new Error("Demande introuvable ou déjà traitée.");

  if (decision === "accepted" && !getDiscordProjectAccess(db, projectId, request.principal_id)) {
    // CRDT dot allocation owns its SQLite transaction. This step is deliberately
    // idempotent: a retry after a crash observes the already-created membership.
    grantDiscordProjectMember(db, {
      projectId, discordUserId: request.principal_id,
      role: "member", actorDiscordUserId
    });
  }
  const updated = db.prepare(`
    UPDATE project_membership_requests
    SET status=?,decided_at=?,decided_by=?
    WHERE request_id=? AND project_id=? AND status='pending'
  `).run(decision, decidedAt, actorDiscordUserId, requestId, projectId);
  if (updated.changes !== 1) throw new Error("La demande a été traitée entre-temps.");
  return { requestId, status: decision, principalId: request.principal_id };
}
