import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  applyCrdtOperation, getCrdtObjectState, initializeCrdtOperationStore,
  listCrdtOperations
} from "../src/collaboration/operation-store.js";
import { readPropositionCrdtState } from "../src/collaboration/model.js";
import { createPropositionCrdtState } from "../src/collaboration/model.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO projects(id) VALUES(?)").run("project-1");
  initializeCrdtOperationStore(db);
  return db;
}

function operation(overrides = {}) {
  return {
    version: 1, opId: "op-1", projectId: "project-1",
    objectType: "proposition", objectId: "proposal-1",
    kind: "field.set", dot: { replicaId: "phone", counter: 1 },
    causalContext: {}, actor: { type: "human", id: "alice" },
    payload: { field: "text", value: "Hypothèse initiale" },
    createdAt: "2026-11-19T08:00:00.000Z",
    ...overrides
  };
}

test("operation persistence is idempotent and stores its materialized state atomically", () => {
  const db = database();
  const op = operation();
  const first = applyCrdtOperation(db, op);
  const duplicate = applyCrdtOperation(db, op);
  assert.equal(first.inserted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(listCrdtOperations(db, "project-1").operations.length, 1);
  const saved = getCrdtObjectState(db, "project-1", "proposition", "proposal-1");
  assert.deepEqual(readPropositionCrdtState(saved.state).fields.text, ["Hypothèse initiale"]);
  db.close();
});

test("same opId with different content and same dot with another opId are rejected", () => {
  const db = database();
  applyCrdtOperation(db, operation());
  assert.throws(() => applyCrdtOperation(db, operation({
    payload: { field: "text", value: "Contenu divergent" }
  })), /Collision.*opId/);
  assert.throws(() => applyCrdtOperation(db, operation({
    opId: "op-2", payload: { field: "text", value: "Autre opération" }
  })), /Collision.*dot/);
  assert.equal(listCrdtOperations(db, "project-1").operations.length, 1);
  db.close();
});

test("causal field updates converge when delivered in reverse order", () => {
  const db = database();
  const earlier = operation({
    opId: "earlier", dot: { replicaId: "phone", counter: 1 },
    payload: { field: "text", value: "Version A" }
  });
  const later = operation({
    opId: "later", dot: { replicaId: "phone", counter: 2 },
    causalContext: { phone: 1 },
    payload: { field: "text", value: "Version B" }
  });
  applyCrdtOperation(db, later);
  applyCrdtOperation(db, earlier);
  const saved = getCrdtObjectState(db, "project-1", "proposition", "proposal-1");
  assert.deepEqual(readPropositionCrdtState(saved.state).fields.text, ["Version B"]);
  db.close();
});

test("observed removal arriving before its add prevents the delayed add from reappearing", () => {
  const db = database();
  const add = operation({
    opId: "observation-add", kind: "observation.add",
    dot: { replicaId: "phone", counter: 1 },
    payload: { observation: { id: "obs-1", content: "Observation" } }
  });
  const remove = operation({
    opId: "observation-remove", kind: "observation.remove",
    dot: { replicaId: "phone", counter: 2 }, causalContext: { phone: 1 },
    payload: { observation: { id: "obs-1", content: "Observation" },
      observedAdds: [{ dot: { replicaId: "phone", counter: 1 }, value: { id: "obs-1", content: "Observation" } }] }
  });
  applyCrdtOperation(db, remove);
  applyCrdtOperation(db, add);
  const saved = getCrdtObjectState(db, "project-1", "proposition", "proposal-1");
  assert.deepEqual(readPropositionCrdtState(saved.state).observations, []);
  db.close();
});

test("concurrent accepted and rejected decisions are both preserved", () => {
  const db = database();
  const accepted = operation({
    opId: "decision-accepted", kind: "decision.record",
    dot: { replicaId: "phone", counter: 1 },
    payload: { decision: { id: "d1", status: "accepted", justification: "Étayée",
      actor: { type: "human", id: "alice" }, recordedAt: "2026-11-19T08:00:00.000Z" } }
  });
  const rejected = operation({
    opId: "decision-rejected", kind: "decision.record",
    dot: { replicaId: "desktop", counter: 1 },
    actor: { type: "human", id: "bob" },
    payload: { decision: { id: "d2", status: "rejected", justification: "Contredite",
      actor: { type: "human", id: "bob" }, recordedAt: "2026-11-19T08:01:00.000Z" } }
  });
  applyCrdtOperation(db, rejected);
  applyCrdtOperation(db, accepted);
  const saved = getCrdtObjectState(db, "project-1", "proposition", "proposal-1");
  assert.deepEqual(readPropositionCrdtState(saved.state).validationDecisions.map(x => x.status).sort(),
    ["accepted", "rejected"]);
  db.close();
});

test("pull cursor is project-scoped and returns a resumable ordered batch", () => {
  const db = database();
  applyCrdtOperation(db, operation());
  applyCrdtOperation(db, operation({ opId: "op-2", dot: { replicaId: "phone", counter: 2 },
    causalContext: { phone: 1 }, payload: { field: "text", value: "Second" } }));
  const first = listCrdtOperations(db, "project-1", { limit: 1 });
  assert.equal(first.operations.length, 1);
  const second = listCrdtOperations(db, "project-1", { after: first.next });
  assert.equal(second.operations.length, 1);
  assert.equal(second.operations[0].opId, "op-2");
  db.close();
});

test("decision actor cannot differ from the operation actor", () => {
  const db = database();
  const invalid = operation({
    kind: "decision.record",
    payload: { decision: { id: "d3", status: "accepted", justification: "Décision",
      actor: { type: "human", id: "mallory" }, recordedAt: "2026-11-19T08:00:00.000Z" } }
  });
  assert.throws(() => applyCrdtOperation(db, invalid), /acteur de la décision/);
  assert.equal(listCrdtOperations(db, "project-1").operations.length, 0);
  db.close();
});

test("relation observed removals use the same tagged-value contract as observations", () => {
  const db = database();
  const relation = { id: "rel-1", targetId: "proposal-2", type: "supports" };
  applyCrdtOperation(db, operation({
    opId: "relation-add", kind: "relation.add",
    dot: { replicaId: "phone", counter: 1 }, payload: { relation }
  }));
  applyCrdtOperation(db, operation({
    opId: "relation-remove", kind: "relation.remove",
    dot: { replicaId: "phone", counter: 2 }, causalContext: { phone: 1 },
    payload: { relation, observedAdds: [{ dot: { replicaId: "phone", counter: 1 }, value: relation }] }
  }));
  const saved = getCrdtObjectState(db, "project-1", "proposition", "proposal-1");
  assert.deepEqual(readPropositionCrdtState(saved.state).relations, []);
  db.close();
});

test("older persisted proposition states are upgraded without losing existing registers", () => {
  const db = database();
  const legacy = createPropositionCrdtState();
  delete legacy.legacyReviewStatus;
  delete legacy.fields.author;
  delete legacy.fields.sourceAgent;
  delete legacy.fields.sourceInteraction;
  delete legacy.fields.justification;
  legacy.fields.text = {
    type: "mv-register", version: 1,
    entries: [{ dot: { replicaId: "phone", counter: 1 }, context: {}, value: "Texte conservé" }]
  };
  db.prepare(`INSERT INTO crdt_object_states
    (project_id,object_type,object_id,state_json,updated_at) VALUES(?,?,?,?,?)`)
    .run("project-1", "proposition", "proposal-legacy", JSON.stringify(legacy), "2026-11-19T08:00:00.000Z");
  const upgraded = getCrdtObjectState(db, "project-1", "proposition", "proposal-legacy");
  const read = readPropositionCrdtState(upgraded.state);
  assert.deepEqual(read.fields.text, ["Texte conservé"]);
  assert.deepEqual(read.legacyReviewStatus, []);
  assert.deepEqual(read.fields.author, []);
  const persisted = JSON.parse(db.prepare("SELECT state_json FROM crdt_object_states WHERE object_id='proposal-legacy'").get().state_json);
  assert.ok(persisted.legacyReviewStatus);
  assert.ok(persisted.fields.sourceInteraction);
  db.close();
});

test("a conflict resolution waits for its referenced decision and must causally observe it", () => {
  const db = database();
  const initial = operation();
  applyCrdtOperation(db, initial);
  const prior = operation({
    opId: "prior-decision", kind: "decision.record",
    dot: { replicaId: "desktop", counter: 1 },
    actor: { type: "human", id: "bob" },
    payload: { decision: { id: "decision-prior", targetType: "proposition",
      targetId: "proposal-1", status: "rejected", justification: "Contredite",
      actor: { type: "human", id: "bob" }, recordedAt: "2026-11-19T08:01:00.000Z" } }
  });
  const resolution = operation({
    opId: "resolution", kind: "decision.record",
    dot: { replicaId: "phone", counter: 2 },
    causalContext: { phone: 1, desktop: 1 },
    payload: { decision: { id: "decision-resolution", targetType: "proposition",
      targetId: "proposal-1", status: "accepted", justification: "Réexamen explicite",
      resolves: ["decision-prior"],
      actor: { type: "human", id: "alice" }, recordedAt: "2026-11-19T08:02:00.000Z" } }
  });
  assert.throws(() => applyCrdtOperation(db, resolution), /Dépendance de résolution manquante/);
  applyCrdtOperation(db, prior);
  const result = applyCrdtOperation(db, resolution);
  assert.equal(result.inserted, true);
  const state = getCrdtObjectState(db, "project-1", "proposition", "proposal-1").state;
  assert.equal(readPropositionCrdtState(state).validationDecisions.length, 2);
  db.close();
});
