import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  authenticateProjectSyncPeer, createProjectSyncPeer, initializeProjectPeerStore,
  listProjectSyncPeers, revokeProjectSyncPeer
} from "../src/collaboration/peer-store.js";

function database() {
  const db = new DatabaseSync(":memory:");
  initializeProjectPeerStore(db);
  return db;
}

test("peer tokens are project-scoped, permission-scoped and stored only as hashes", () => {
  const db = database();
  const peer = createProjectSyncPeer(db, "project-a", {
    label: "Laptop", permissions: ["read"]
  });
  assert.ok(peer.token.length >= 40);
  assert.equal(authenticateProjectSyncPeer(db, "project-a", peer.token, "read").peerId, peer.peerId);
  assert.equal(authenticateProjectSyncPeer(db, "project-a", peer.token, "write"), null);
  assert.equal(authenticateProjectSyncPeer(db, "project-b", peer.token, "read"), null);
  const row = db.prepare("SELECT token_hash FROM project_sync_peers WHERE peer_id=?").get(peer.peerId);
  assert.notEqual(row.token_hash, peer.token);
  assert.equal(listProjectSyncPeers(db, "project-a")[0].label, "Laptop");
  db.close();
});

test("revoked peer credentials stop authenticating immediately", () => {
  const db = database();
  const peer = createProjectSyncPeer(db, "project-a");
  assert.equal(revokeProjectSyncPeer(db, "project-a", peer.peerId), true);
  assert.equal(authenticateProjectSyncPeer(db, "project-a", peer.token, "read"), null);
  assert.equal(revokeProjectSyncPeer(db, "project-a", peer.peerId), false);
  db.close();
});

test("invalid permissions are rejected and duplicate permissions normalized", () => {
  const db = database();
  assert.throws(() => createProjectSyncPeer(db, "project-a", { permissions: ["admin"] }), /Permissions/);
  const peer = createProjectSyncPeer(db, "project-a", { permissions: ["write", "read", "read"] });
  assert.deepEqual(peer.permissions, ["read", "write"]);
  db.close();
});
