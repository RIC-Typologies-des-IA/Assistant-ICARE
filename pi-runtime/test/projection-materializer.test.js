import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyCrdtOperation, getCrdtObjectState, initializeCrdtOperationStore } from "../src/collaboration/operation-store.js";
import { initializeReplicaStore } from "../src/collaboration/replica-store.js";
import { materializeCrdtOperation } from "../src/collaboration/projection-materializer.js";
import { readPropositionCrdtState } from "../src/collaboration/model.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY, updated_at TEXT);
    INSERT INTO projects(id,updated_at) VALUES('project-1','');
    CREATE TABLE propositions(
      id TEXT PRIMARY KEY, text TEXT NOT NULL, dimensions TEXT NOT NULL,
      primary_dimension TEXT NOT NULL, temporal TEXT NOT NULL,
      evaluation TEXT NOT NULL, epistemic TEXT NOT NULL, practical TEXT NOT NULL,
      confidence REAL NOT NULL, source TEXT NOT NULL, aspect TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'candidate', created_at TEXT NOT NULL,
      utterance_time TEXT, valid_time_start TEXT, valid_time_end TEXT,
      event_period_start TEXT, event_period_end TEXT, target_horizon TEXT,
      realization_time TEXT, modality TEXT, subject TEXT, predicate TEXT,
      value TEXT, author TEXT, source_agent TEXT, source_interaction TEXT,
      justification TEXT, project_id TEXT NOT NULL
    );
    CREATE TABLE relations(
      id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
      relation TEXT NOT NULL, note TEXT NOT NULL, review_status TEXT NOT NULL,
      created_at TEXT NOT NULL, project_id TEXT NOT NULL
    );
  `);
  initializeReplicaStore(db);
  initializeCrdtOperationStore(db);
  return db;
}

function op(overrides = {}) {
  return {
    version: 1, opId: "snapshot-1", projectId: "project-1",
    objectType: "proposition", objectId: "proposal-1",
    kind: "proposition.snapshot",
    dot: { replicaId: "phone", counter: 1 }, causalContext: {},
    actor: { type: "human", id: "alice" },
    payload: { fields: {
      text: "Hypothèse initiale", dimensions: ["I"], primaryDimension: "I",
      temporal: "present", evaluation: "unknown", epistemic: "reported",
      practical: "unspecified", confidence: 0.7, source: "user",
      aspect: "", reviewStatus: "candidate"
    } },
    createdAt: "2026-11-19T08:00:00.000Z",
    ...overrides
  };
}

test("remote proposition and relation operations materialize into the existing ICARE tables", () => {
  const db = database();
  const snapshot = op();
  applyCrdtOperation(db, snapshot);
  const first = materializeCrdtOperation(db, snapshot);
  assert.equal(first.projected, true);
  const row = db.prepare("SELECT * FROM propositions WHERE id='proposal-1'").get();
  assert.equal(row.text, "Hypothèse initiale");
  assert.deepEqual(JSON.parse(row.dimensions), ["I"]);

  const relation = op({
    opId: "relation-1", kind: "relation.add",
    dot: { replicaId: "phone", counter: 2 }, causalContext: { phone: 1 },
    payload: { relation: { id: "rel-1", targetId: "proposal-2", type: "supports",
      note: "Lien", reviewStatus: "candidate" } }
  });
  applyCrdtOperation(db, relation);
  materializeCrdtOperation(db, relation);
  const rel = db.prepare("SELECT * FROM relations WHERE id='rel-1'").get();
  assert.equal(rel.from_id, "proposal-1");
  assert.equal(rel.to_id, "proposal-2");
  assert.equal(rel.review_status, "candidate");
  db.close();
});

test("concurrent field values remain explicit and are not overwritten by the SQL projection", () => {
  const db = database();
  const snapshot = op();
  applyCrdtOperation(db, snapshot);
  materializeCrdtOperation(db, snapshot);
  const concurrent = op({
    opId: "concurrent-text", kind: "field.set",
    dot: { replicaId: "desktop", counter: 1 },
    actor: { type: "human", id: "bob" },
    payload: { field: "text", value: "Formulation concurrente" }
  });
  applyCrdtOperation(db, concurrent);
  const projection = materializeCrdtOperation(db, concurrent);
  const row = db.prepare("SELECT text FROM propositions WHERE id='proposal-1'").get();
  assert.equal(row.text, "Hypothèse initiale");
  assert.deepEqual(projection.conflicts.text.sort(),
    ["Formulation concurrente", "Hypothèse initiale"]);
  db.close();
});

test("opposite validation decisions make the legacy view pending instead of choosing a winner", () => {
  const db = database();
  const snapshot = op();
  applyCrdtOperation(db, snapshot);
  materializeCrdtOperation(db, snapshot);
  const accepted = op({
    opId: "accepted", kind: "decision.record",
    dot: { replicaId: "phone", counter: 2 }, causalContext: { phone: 1 },
    payload: { decision: { id: "d1", targetType: "proposition", targetId: "proposal-1",
      status: "accepted", justification: "Validée par Alice",
      actor: { type: "human", id: "alice" }, recordedAt: "2026-11-19T08:01:00.000Z" } }
  });
  applyCrdtOperation(db, accepted);
  materializeCrdtOperation(db, accepted);
  assert.equal(db.prepare("SELECT review_status FROM propositions WHERE id='proposal-1'").get().review_status, "accepted");

  const rejected = op({
    opId: "rejected", kind: "decision.record",
    dot: { replicaId: "desktop", counter: 1 },
    actor: { type: "human", id: "bob" },
    payload: { decision: { id: "d2", targetType: "proposition", targetId: "proposal-1",
      status: "rejected", justification: "Contredite par Bob",
      actor: { type: "human", id: "bob" }, recordedAt: "2026-11-19T08:02:00.000Z" } }
  });
  applyCrdtOperation(db, rejected);
  materializeCrdtOperation(db, rejected);
  assert.equal(db.prepare("SELECT review_status FROM propositions WHERE id='proposal-1'").get().review_status, "candidate");
  const state = getCrdtObjectState(db, "project-1", "proposition", "proposal-1").state;
  assert.deepEqual(readPropositionCrdtState(state).validationDecisions.map(d => d.status).sort(), ["accepted", "rejected"]);
  db.close();
});
