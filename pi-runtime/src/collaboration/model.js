/**
 * ICARE semantic CRDT model.
 *
 * The CRDT layer converges data structures; it never adjudicates truth,
 * semantic compatibility, or the legitimacy of a human validation decision.
 */
import {
  addORSet, assignMVRegister, createMVRegister, createORSet,
  mergeMVRegisters, mergeORSets, readMVRegister, readORSet, removeORSet
} from "./crdt.js";

export const PROPOSITION_REGISTER_FIELDS = Object.freeze([
  "text", "dimensions", "primaryDimension", "temporal", "evaluation",
  "epistemic", "practical", "confidence", "source", "aspect",
  "utteranceTime", "validTimeStart", "validTimeEnd", "eventPeriodStart",
  "eventPeriodEnd", "targetHorizon", "realizationTime", "modality",
  "subject", "predicate", "value", "author", "sourceAgent", "sourceInteraction", "justification", "reviewStatus"
]);

const FIELD_SET = new Set(PROPOSITION_REGISTER_FIELDS);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

function assertState(state) {
  if (!isRecord(state) || state.type !== "icare-proposition-crdt" || state.version !== 1 ||
      !isRecord(state.fields) || !isRecord(state.observations) ||
      !isRecord(state.relations) || !isRecord(state.validationDecisions)) {
    throw new TypeError("État CRDT de proposition ICARE invalide.");
  }
  for (const field of Object.keys(state.fields)) {
    if (!FIELD_SET.has(field)) throw new TypeError("Champ de proposition non pris en charge : " + field);
    if (state.fields[field]?.type !== "mv-register") throw new TypeError("Chaque champ éditable doit être un MV-register.");
  }
}

function assertActor(actor) {
  if (!isRecord(actor) || !nonEmpty(actor.id) || !nonEmpty(actor.type)) {
    throw new TypeError("L'identité de l'acteur humain ou agent est requise.");
  }
}

function assertDotAndContext(dot, causalContext) {
  if (!isRecord(dot) || !nonEmpty(dot.replicaId) ||
      !Number.isSafeInteger(dot.counter) || dot.counter < 1) {
    throw new TypeError("Dot CRDT invalide.");
  }
  if (!isRecord(causalContext)) throw new TypeError("Le contexte causal doit être un objet.");
}

export function createPropositionCrdtState() {
  return {
    type: "icare-proposition-crdt",
    version: 1,
    fields: Object.fromEntries(PROPOSITION_REGISTER_FIELDS.map(field => [field, createMVRegister()])),
    observations: createORSet(),
    relations: createORSet(),
    validationDecisions: createORSet()
  };
}

/** Every editable field gets its own causal register, never a whole-object LWW. */
export function editPropositionField(state, field, value, dot, causalContext = {}) {
  assertState(state);
  if (!FIELD_SET.has(field)) throw new TypeError("Champ de proposition non éditable ou inconnu : " + field);
  assertDotAndContext(dot, causalContext);
  return {
    ...structuredClone(state),
    fields: {
      ...structuredClone(state.fields),
      [field]: assignMVRegister(state.fields[field], value, dot, causalContext)
    }
  };
}

/** Initialize or import a proposition snapshot in one immutable CRDT operation. */
export function initializePropositionFields(state, fields, dot, causalContext = {}) {
  assertState(state);
  if (!isRecord(fields) || Object.keys(fields).length === 0) {
    throw new TypeError("Un instantané de proposition doit contenir au moins un champ.");
  }
  assertDotAndContext(dot, causalContext);
  const nextFields = structuredClone(state.fields);
  for (const [field, value] of Object.entries(fields)) {
    if (!FIELD_SET.has(field)) throw new TypeError("Champ de proposition non éditable ou inconnu : " + field);
    nextFields[field] = assignMVRegister(nextFields[field], value, dot, causalContext);
  }
  return { ...structuredClone(state), fields: nextFields };
}

export function addPropositionObservation(state, observation, dot) {
  assertState(state);
  if (!isRecord(observation) || !nonEmpty(observation.id) || !nonEmpty(observation.content)) {
    throw new TypeError("Une observation doit avoir un id stable et un contenu.");
  }
  return { ...structuredClone(state), observations: addORSet(state.observations, observation, dot) };
}

export function addPropositionRelation(state, relation, dot) {
  assertState(state);
  if (!isRecord(relation) || !nonEmpty(relation.id) || !nonEmpty(relation.targetId) || !nonEmpty(relation.type)) {
    throw new TypeError("Une relation doit avoir un id, une cible et un type.");
  }
  return { ...structuredClone(state), relations: addORSet(state.relations, relation, dot) };
}

export function removePropositionObservation(state, observation) {
  assertState(state);
  return { ...structuredClone(state), observations: removeORSet(state.observations, observation) };
}

export function removePropositionRelation(state, relation) {
  assertState(state);
  return { ...structuredClone(state), relations: removeORSet(state.relations, relation) };
}

/**
 * Validation is an immutable human/agent decision record, not a mutable
 * accepted/rejected register. Concurrent opposite decisions both survive.
 */
export function recordPropositionDecision(state, decision, dot) {
  assertState(state);
  if (!isRecord(decision) || !nonEmpty(decision.id) ||
      !["candidate", "accepted", "rejected", "needs-review"].includes(decision.status) ||
      !nonEmpty(decision.justification)) {
    throw new TypeError("Une décision doit avoir un id, un statut reconnu et une justification.");
  }
  assertActor(decision.actor);
  if (!nonEmpty(decision.recordedAt)) throw new TypeError("La date de décision est requise.");
  return { ...structuredClone(state), validationDecisions: addORSet(state.validationDecisions, decision, dot) };
}

export function mergePropositionCrdtStates(left, right) {
  assertState(left);
  assertState(right);
  const fields = {};
  for (const field of PROPOSITION_REGISTER_FIELDS) {
    fields[field] = mergeMVRegisters(left.fields[field], right.fields[field]);
  }
  return {
    type: "icare-proposition-crdt",
    version: 1,
    fields,
    observations: mergeORSets(left.observations, right.observations),
    relations: mergeORSets(left.relations, right.relations),
    validationDecisions: mergeORSets(left.validationDecisions, right.validationDecisions)
  };
}

export function readPropositionCrdtState(state) {
  assertState(state);
  return {
    fields: Object.fromEntries(Object.entries(state.fields).map(([field, register]) => [field, readMVRegister(register)])),
    observations: readORSet(state.observations),
    relations: readORSet(state.relations),
    validationDecisions: readORSet(state.validationDecisions)
  };
}
