import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initializeReplicaStore } from "../src/collaboration/replica-store.js";
import { initializeCrdtOperationStore, getCrdtObjectState, listCrdtOperations } from "../src/collaboration/operation-store.js";
import {
  backfillCrdtProjections, projectPropositionToCrdt, projectRelationToCrdt,
  recordCrdtValidationDecision
} from "../src/collaboration/projection-bridge.js";
import { readPropositionCrdtState } from "../src/collaboration/model.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY);
    INSERT INTO projects(id) VALUES('project-1');
    CREATE TABLE propositions(
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, text TEXT NOT NULL,
      dimensions TEXT NOT NULL, primary_dimension TEXT NOT NULL,
      temporal TEXT, evaluation TEXT, epistemic TEXT, practical TEXT,
      confidence REAL, source TEXT, aspect TEXT, review_status TEXT,
      created_at TEXT, utterance_time TEXT, valid_time_start TEXT,
      valid_time_end TEXT, event_period_start TEXT, event_period_end TEXT,
      target_horizon TEXT, realization_time TEXT, modality TEXT,
      subject TEXT, predicate TEXT, value TEXT, author TEXT,
      source_agent TEXT, source_interaction TEXT, justification TEXT
    );
    CREATE TABLE relations(
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_id TEXT NOT NULL,
      to_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT,
      review_status TEXT, created_at TEXT
    );
  `);
  initializeReplicaStore(db);
  initializeCrdtOperationStore(db);
  return db;
}

function proposal(id = "proposal-1") {
  return {
    id, project_id: "project-1", text: "Observation source",
    dimensions: '["I","C"]', primary_dimension: "I", temporal: "present",
    evaluation: "unknown", epistemic: "reported", practical: "unspecified",
    confidence: 0.7, source: "user", aspect: "", review_status: "candidate",
    created_at: "2026-11-19T08:00:00.000Z", utterance_time: null,
    valid_time_start: null, valid_time_end: null, event_period_start: null,
    event_period_end: null, target_horizon: null, realization_time: null,
    modality: "unknown", subject: null, predicate: null, value: null,
    author: null, source_agent: null, source_interaction: null, justification: null
  };
}

test("legacy proposition snapshots, relations and immutable decisions share one CRDT object", () => {
  const db = database();
  const p = proposal();
  projectPropositionToCrdt(db, p);
  const relation = {
    id: "rel-1", project_id: "project-1", from_id: p.id, to_id: "proposal-2",
    relation: "supports", note: "Lien argumentatif", review_status: "candidate"
  };
  projectRelationToCrdt(db, relation);
  recordCrdtValidationDecision(db, {
    projectId: "project-1", objectId: p.id, status: "accepted",
    justification: "Concorde avec les sources."
  });
  recordCrdtValidationDecision(db, {
    projectId: "project-1", objectId: p.id, status: "rejected",
    justification: "Contredit par une autre source."
  });
  const state = getCrdtObjectState(db, "project-1", "proposition", p.id).state;
  const read = readPropositionCrdtState(state);
  assert.deepEqual(read.fields.text, ["Observation source"]);
  assert.deepEqual(read.legacyReviewStatus, ["candidate"]);
  assert.equal(read.relations[0].id, "rel-1");
  assert.deepEqual(read.validationDecisions.map(d => d.status).sort(), ["accepted", "rejected"]);
  assert.equal(listCrdtOperations(db, "project-1").operations.length, 4);
  db.close();
});

test("legacy backfill is idempotent and preserves historical review status as data", () => {
  const db = database();
  const p = proposal("legacy-accepted");
  p.review_status = "accepted";
  db.prepare(`INSERT INTO propositions VALUES(
    @id,@project_id,@text,@dimensions,@primary_dimension,@temporal,@evaluation,@epistemic,
    @practical,@confidence,@source,@aspect,@review_status,@created_at,@utterance_time,
    @valid_time_start,@valid_time_end,@event_period_start,@event_period_end,@target_horizon,
    @realization_time,@modality,@subject,@predicate,@value,@author,@source_agent,
    @source_interaction,@justification
  )`).run(p);
  db.prepare("INSERT INTO relations VALUES(?,?,?,?,?,?,?,?)")
    .run("legacy-rel", "project-1", p.id, "proposal-target", "supports", "historique", "accepted", p.created_at);
  assert.deepEqual(backfillCrdtProjections(db), { propositions: 1, relations: 1 });
  assert.deepEqual(backfillCrdtProjections(db), { propositions: 0, relations: 0 });
  const state = getCrdtObjectState(db, "project-1", "proposition", p.id).state;
  const read = readPropositionCrdtState(state);
  assert.deepEqual(read.fields.reviewStatus, ["accepted"]);
  assert.equal(read.relations[0].reviewStatus, "accepted");
  db.close();
});
