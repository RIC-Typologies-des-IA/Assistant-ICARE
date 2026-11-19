import test from "node:test";
import assert from "node:assert/strict";
import {
  addPropositionObservation, addPropositionRelation, createPropositionCrdtState,
  removePropositionObservation, removePropositionRelation,
  editPropositionField, mergePropositionCrdtStates, readPropositionCrdtState,
  recordPropositionDecision
} from "../src/collaboration/model.js";
import {
  createActorIdentity, createInstallationIdentity, createReplicaDot
} from "../src/collaboration/replica.js";

test("installation identity is stable when restored and distinct from actor identity", () => {
  const first = createInstallationIdentity("installation-123");
  const restored = createInstallationIdentity(first.replicaId);
  const actor = createActorIdentity("human", "person-42", "Contributeur");
  assert.deepEqual(first, restored);
  assert.notEqual(first.replicaId, actor.id);
  assert.deepEqual(createReplicaDot(first, 7), { replicaId: "installation-123", counter: 7 });
  assert.throws(() => createReplicaDot(actor, 1), /Identité de réplique/);
});

test("concurrent proposition field edits remain alternatives", () => {
  const empty = createPropositionCrdtState();
  const phone = editPropositionField(empty, "text", "Formulation A", { replicaId: "phone", counter: 1 });
  const desktop = editPropositionField(empty, "text", "Formulation B", { replicaId: "desktop", counter: 1 });
  const merged = mergePropositionCrdtStates(phone, desktop);
  assert.deepEqual(readPropositionCrdtState(merged).fields.text, ["Formulation B", "Formulation A"]);
});

test("observations and relations merge as sets without losing distinct contributions", () => {
  const empty = createPropositionCrdtState();
  const left = addPropositionObservation(empty, { id: "obs-1", content: "Observation mobile" },
    { replicaId: "phone", counter: 1 });
  const right = addPropositionObservation(empty, { id: "obs-2", content: "Observation bureau" },
    { replicaId: "desktop", counter: 1 });
  const relation = addPropositionRelation(empty, { id: "rel-1", targetId: "prop-2", type: "supports" },
    { replicaId: "desktop", counter: 2 });
  const merged = mergePropositionCrdtStates(left, mergePropositionCrdtStates(right, relation));
  const read = readPropositionCrdtState(merged);
  assert.deepEqual(read.observations.map(x => x.id).sort(), ["obs-1", "obs-2"]);
  assert.deepEqual(read.relations.map(x => x.id), ["rel-1"]);
});

test("opposite validation decisions remain an explicit conflict, never auto-resolved", () => {
  const empty = createPropositionCrdtState();
  const actorA = createActorIdentity("human", "alice");
  const actorB = createActorIdentity("human", "bob");
  const accepted = recordPropositionDecision(empty, {
    id: "decision-a", status: "accepted", justification: "Étayée par les sources",
    actor: actorA, recordedAt: "2026-11-19T10:00:00.000Z"
  }, { replicaId: "phone", counter: 1 });
  const rejected = recordPropositionDecision(empty, {
    id: "decision-b", status: "rejected", justification: "Contredite par une observation",
    actor: actorB, recordedAt: "2026-11-19T10:01:00.000Z"
  }, { replicaId: "desktop", counter: 1 });
  const decisions = readPropositionCrdtState(mergePropositionCrdtStates(accepted, rejected)).validationDecisions;
  assert.deepEqual(decisions.map(x => x.status).sort(), ["accepted", "rejected"]);
});

test("unknown proposition fields cannot silently enter the CRDT schema", () => {
  assert.throws(() => editPropositionField(createPropositionCrdtState(), "reviewStatus", "accepted",
    { replicaId: "phone", counter: 1 }), /inconnu/);
});

test("observed removal wrappers preserve concurrent additions", () => {
  const empty = createPropositionCrdtState();
  const first = addPropositionObservation(empty, { id: "obs", content: "Même observation" },
    { replicaId: "phone", counter: 1 });
  const concurrent = addPropositionObservation(empty, { id: "obs", content: "Même observation" },
    { replicaId: "desktop", counter: 1 });
  const removed = removePropositionObservation(first, { id: "obs", content: "Même observation" });
  const merged = mergePropositionCrdtStates(removed, concurrent);
  assert.equal(readPropositionCrdtState(merged).observations.length, 1);

  const relation = addPropositionRelation(empty, { id: "rel", targetId: "p2", type: "supports" },
    { replicaId: "phone", counter: 2 });
  const removedRelation = removePropositionRelation(relation,
    { id: "rel", targetId: "p2", type: "supports" });
  assert.deepEqual(readPropositionCrdtState(removedRelation).relations, []);
});
