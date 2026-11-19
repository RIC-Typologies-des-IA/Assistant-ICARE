import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("collaboration API exposes versioned project manifests and an idempotent event journal", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS project_events',
    'CREATE TABLE IF NOT EXISTS project_creation_requests',
    'INSERT INTO project_events',
    'url.pathname === "/api/projects"',
    "manifest$/.exec",
    "events$/.exec",
    'validateProjectManifest(manifest)',
    'validateProjectEvent(event, projectId)',
    'Collision : cet eventId existe déjà avec un contenu différent.',
    'body.idempotencyKey',
    'context_json'
  ]) {
    assert.ok(server.includes(fragment), "Missing collaboration API contract: " + fragment);
  }
  assert.ok(server.includes("duplicate: !stored.inserted"));
  assert.ok(server.includes("LIMIT 500"));
});

test("collaboration API is explicitly not wired to a Discord channel per ICARE dimension", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.ok(server.includes('DIMENSION_ORDER = ["I", "C", "A", "R", "E"]'));
  assert.ok(!server.includes("dimensionChannel"));
  assert.ok(!server.includes("channelPerDimension"));
});

test("local CRDT API exposes operation push, resumable pull and materialized object reads", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const fragment of [
    "crdtOperationsMatch",
    "crdtObjectMatch",
    "validateCrdtOperation(operation)",
    "applyCrdtOperation(db, operation)",
    "listCrdtOperations(db, projectId",
    "getCrdtObjectState(db, projectId"
  ]) assert.ok(server.includes(fragment), "Missing CRDT API contract: " + fragment);
});

test("CRDT peer administration is protected and project routes require scoped credentials", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const fragment of [
    "ICARE_SYNC_ADMIN_TOKEN",
    "requireSyncAdmin(req, res)",
    "authenticateProjectSyncPeer(db, projectId",
    '"/api/projects/"',
    "peerCollectionMatch",
    "peerItemMatch",
    'requiredPermission = req.method === "GET" ? "read"',
    'authorizeSyncPeer(req, res, projectId, "read")'
  ]) assert.ok(server.includes(fragment), "Missing sync security contract: " + fragment);
});

test("peer sync CLI keeps its credential inputs in environment variables", async () => {
  const cli = await readFile(new URL("../src/sync-cli.js", import.meta.url), "utf8");
  for (const variable of [
    "ICARE_SYNC_PROJECT_ID", "ICARE_SYNC_PEER_ID",
    "ICARE_SYNC_PEER_URL", "ICARE_SYNC_PEER_TOKEN"
  ]) assert.ok(cli.includes(variable));
  assert.ok(!cli.includes("process.argv"));
});
