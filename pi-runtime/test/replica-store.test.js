import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { allocateLocalDot, getLocalReplicaIdentity, getLocalReplicaState, initializeReplicaStore } from "../src/collaboration/replica-store.js";

test("SQLite replica identity survives restart and is not a human actor id", () => {
  const db = new DatabaseSync(":memory:"); initializeReplicaStore(db);
  const first = getLocalReplicaIdentity(db), second = getLocalReplicaIdentity(db);
  assert.deepEqual(first, second); assert.equal(first.scope, "installation"); assert.ok(first.replicaId.length > 10); db.close();
});

test("dot counters are monotonic, durable and advance past observed local context", () => {
  const db = new DatabaseSync(":memory:");
  const first = allocateLocalDot(db), second = allocateLocalDot(db);
  assert.equal(second.replicaId, first.replicaId); assert.equal(second.counter, first.counter + 1);
  const advanced = allocateLocalDot(db, { [first.replicaId]: 20 });
  assert.equal(advanced.counter, 21); assert.equal(getLocalReplicaState(db).counter, 21); db.close();
});

test("invalid causal context does not consume a counter", () => {
  const db = new DatabaseSync(":memory:"); const first = allocateLocalDot(db);
  assert.throws(() => allocateLocalDot(db, { broken: -1 }), /vecteur/);
  assert.equal(allocateLocalDot(db).counter, first.counter + 1); db.close();
});
