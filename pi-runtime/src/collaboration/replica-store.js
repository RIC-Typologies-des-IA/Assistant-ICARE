/**
 * SQLite-backed local replica identity and monotonic dot allocation.
 * A replica is one durable ICARE installation, not a human account.
 */
import { randomUUID } from "node:crypto";
import { normalizeVersionVector } from "./crdt.js";

export function initializeReplicaStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_replica_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      replica_id TEXT NOT NULL UNIQUE,
      counter INTEGER NOT NULL DEFAULT 0 CHECK(counter >= 0),
      created_at TEXT NOT NULL
    );
  `);
}

export function getLocalReplicaIdentity(db) {
  initializeReplicaStore(db);
  let row = db.prepare("SELECT replica_id FROM local_replica_state WHERE singleton=1").get();
  if (!row) {
    const replicaId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO local_replica_state(singleton,replica_id,counter,created_at) VALUES(1,?,0,?)")
      .run(replicaId, createdAt);
    row = { replica_id: replicaId };
  }
  return Object.freeze({ replicaId: row.replica_id, scope: "installation" });
}

/**
 * Allocate and persist the next local dot atomically. The counter is advanced
 * beyond both the durable local counter and this replica's observed context.
 */
export function allocateLocalDot(db, causalContext = {}) {
  const context = normalizeVersionVector(causalContext);
  db.exec("BEGIN IMMEDIATE");
  try {
    const identity = getLocalReplicaIdentity(db);
    const current = db.prepare("SELECT counter FROM local_replica_state WHERE singleton=1").get().counter;
    const counter = Math.max(current, context[identity.replicaId] || 0) + 1;
    db.prepare("UPDATE local_replica_state SET counter=? WHERE singleton=1").run(counter);
    db.exec("COMMIT");
    return { replicaId: identity.replicaId, counter };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function getLocalReplicaState(db) {
  const identity = getLocalReplicaIdentity(db);
  const row = db.prepare("SELECT counter,created_at FROM local_replica_state WHERE singleton=1").get();
  return { ...identity, counter: row.counter, createdAt: row.created_at };
}
