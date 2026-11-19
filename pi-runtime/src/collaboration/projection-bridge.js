import { randomUUID } from "node:crypto";
import { createLocalCrdtOperation } from "./sync-engine.js";
import { getCrdtObjectState } from "./operation-store.js";
import { readPropositionCrdtState } from "./model.js";

const proposalFields = proposal => ({
  text: proposal.text, dimensions: Array.isArray(proposal.dimensions) ? proposal.dimensions : JSON.parse(proposal.dimensions),
  primaryDimension: proposal.primary_dimension, temporal: proposal.temporal,
  evaluation: proposal.evaluation, epistemic: proposal.epistemic,
  practical: proposal.practical, confidence: proposal.confidence,
  source: proposal.source, aspect: proposal.aspect,
  utteranceTime: proposal.utterance_time, validTimeStart: proposal.valid_time_start,
  validTimeEnd: proposal.valid_time_end, eventPeriodStart: proposal.event_period_start,
  eventPeriodEnd: proposal.event_period_end, targetHorizon: proposal.target_horizon,
  realizationTime: proposal.realization_time, modality: proposal.modality,
  subject: proposal.subject, predicate: proposal.predicate, value: proposal.value,
  author: proposal.author, sourceAgent: proposal.source_agent,
  sourceInteraction: proposal.source_interaction, justification: proposal.justification,
  reviewStatus: proposal.review_status
});

export function proposalActor(proposal) {
  return proposal.source === "user"
    ? { type: "human", id: "local-user" }
    : { type: "agent", id: String(proposal.source_agent || "icare-agent") };
}

export function projectPropositionToCrdt(db, proposal, actor = proposalActor(proposal)) {
  if (getCrdtObjectState(db, proposal.project_id, "proposition", proposal.id)) {
    return { inserted: false, operation: null };
  }
  const operation = createLocalCrdtOperation(db, {
    projectId: proposal.project_id, objectId: proposal.id,
    kind: "proposition.snapshot", payload: { fields: proposalFields(proposal) }, actor
  });
  return { inserted: true, operation };
}

export function projectRelationToCrdt(db, relation, actor = { type: "agent", id: "icare-agent" }) {
  const state = getCrdtObjectState(db, relation.project_id, "proposition", relation.from_id);
  if (!state) throw new Error("La proposition source doit être projetée en CRDT avant sa relation.");
  const existing = readPropositionCrdtState(state.state).relations;
  if (existing.some(item => item.id === relation.id)) return { inserted: false, operation: null };
  const operation = createLocalCrdtOperation(db, {
    projectId: relation.project_id, objectId: relation.from_id, kind: "relation.add",
    payload: { relation: { id: relation.id, targetId: relation.to_id,
      type: relation.relation, note: relation.note, reviewStatus: relation.review_status } },
    actor
  });
  return { inserted: true, operation };
}

export function recordCrdtValidationDecision(db, {
  projectId, objectId, targetType = "proposition", targetId = objectId,
  status, justification, actor = { type: "human", id: "local-user" }
}) {
  const decisionId = randomUUID();
  const operation = createLocalCrdtOperation(db, {
    projectId, objectId, kind: "decision.record", actor,
    payload: { decision: { id: decisionId, targetType, targetId, status,
      justification, actor, recordedAt: new Date().toISOString() } }
  });
  return { decisionId, operation };
}

export function backfillCrdtProjections(db) {
  let propositions = 0;
  let relations = 0;
  const rows = db.prepare("SELECT * FROM propositions ORDER BY created_at,id").all();
  for (const proposal of rows) {
    if (projectPropositionToCrdt(db, proposal).inserted) propositions++;
  }
  const relationRows = db.prepare("SELECT * FROM relations ORDER BY created_at,id").all();
  for (const relation of relationRows) {
    if (projectRelationToCrdt(db, relation).inserted) relations++;
  }
  return { propositions, relations };
}
