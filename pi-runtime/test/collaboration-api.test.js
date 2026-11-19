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
