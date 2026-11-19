/**
 * Durable operation journal for ICARE proposition CRDTs.
 *
 * Operations are immutable, idempotent and applied transactionally with their
 * materialized object state. A replica may receive operations out of order.
 */
import {
  normalizeVersionVector, removeORSetObserved
} from "./crdt.js";
import {
  createPropositionCrdtState, editPropositionField,
  addPropositionObservation, addPropositionRelation,
  recordPropositionDecision
} from "./model.js";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (isRecord(value)) return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}

const OPERATION_KINDS = new Set([
  "field.set", "observation.add", "observation.remove",
  "relation.add", "relation.remove", "decision.record"
]);

export function validateCrdtOperation(operation) {
  const errors = [];
  if (!isRecord(operation)) return { valid: false, errors: ["L'opération doit être un objet."] };
  if (operation.version !== 1) errors.push("Version d'opération CRDT non prise en charge.");
  for (const key of ["opId", "projectId", "objectId", "createdAt"]) {
    if (!nonEmpty(operation[key])) errors.push("Champ requis invalide : " + key);
  }
  if (operation.objectType !== "proposition") errors.push("Type d'objet CRDT non pris en charge.");
  if (!OPERATION_KINDS.has(operation.kind)) errors.push("Type d'opération CRDT non pris en charge.");
  if (!isRecord(operation.dot) || !nonEmpty(operation.dot.replicaId) ||
      !Number.isSafeInteger(operation.dot.counter) || operation.dot.counter < 1) {
    errors.push("Dot CRDT invalide.");
  }
  let context = {};
  try { context = normalizeVersionVector(operation.causalContext); }
  catch (error) { errors.push(error.message); }
  if (isRecord(operation.dot) && nonEmpty(operation.dot.replicaId) &&
      Number.isSafeInteger(operation.dot.counter) && operation.dot.counter > 0) {
    if ((context[operation.dot.replicaId] || 0) >= operation.dot.counter) {
      errors.push("Le contexte causal ne peut pas observer le dot de sa propre opération.");
    }
  }
  if (!isRecord(operation.actor) || !nonEmpty(operation.actor.type) || !nonEmpty(operation.actor.id)) {
    errors.push("Identité de l'acteur humain ou agent invalide.");
  }
  if (!isRecord(operation.payload)) errors.push("Payload d'opération invalide.");
  if (isRecord(operation.payload)) {
    if (operation.kind === "field.set" && (!nonEmpty(operation.payload.field) || !Object.hasOwn(operation.payload, "value"))) errors.push("Champ et valeur de proposition requis.");
    if (operation.kind === "observation.add" &&
        (!isRecord(operation.payload.observation) || !nonEmpty(operation.payload.observation.id) || !nonEmpty(operation.payload.observation.content))) {
      errors.push("Observation invalide.");
    }
    if (operation.kind === "relation.add" &&
        (!isRecord(operation.payload.relation) || !nonEmpty(operation.payload.relation.id) ||
         !nonEmpty(operation.payload.relation.targetId) || !nonEmpty(operation.payload.relation.type))) {
      errors.push("Relation invalide.");
    }
    if (operation.kind === "decision.record") {
      const decision = operation.payload.decision;
      if (!isRecord(decision) || !nonEmpty(decision.id)) errors.push("Décision invalide.");
      else if (isRecord(operation.actor) && canonical(decision.actor) !== canonical(operation.actor)) {
        errors.push("L'acteur de la décision doit correspondre à l'acteur de l'opération.");
      }
    }
    if (operation.kind === "observation.remove" || operation.kind === "relation.remove") {
      if (!Array.isArray(operation.payload.observedAdds)) errors.push("Le retrait doit déclarer les ajouts observés.");
      else {
        for (const entry of operation.payload.observedAdds) {
          const dot = entry?.dot;
          if (!isRecord(entry) || !isRecord(dot) || !nonEmpty(dot.replicaId) ||
              !Number.isSafeInteger(dot.counter) || dot.counter < 1 || !Object.hasOwn(entry, "value")) {
            errors.push("Ajout observé invalide.");
          } else if ((context[dot.replicaId] || 0) < dot.counter) {
            errors.push("Le contexte causal ne couvre pas tous les ajouts retirés.");
          }
        }
      }
      const item = operation.kind === "observation.remove" ? operation.payload.observation : operation.payload.relation;
      if (!isRecord(item) || !nonEmpty(item.id)) errors.push("Élément à retirer invalide.");
    }
  }
  return { valid: errors.length === 0, errors };
}

export function applyPropositionOperation(state, operation) {
  const validation = validateCrdtOperation(operation);
  if (!validation.valid) throw new TypeError("Opération CRDT invalide : " + validation.errors.join(" "));
  const { dot, causalContext: context, payload } = operation;
  switch (operation.kind) {
    case "field.set":
      return editPropositionField(state, payload.field, payload.value, dot, context);
    case "observation.add":
      return addPropositionObservation(state, payload.observation, dot);
    case "observation.remove":
      return {
        ...structuredClone(state),
        observations: removeORSetObserved(state.observations, payload.observation, payload.observedAdds)
      };
    case "relation.add":
      return addPropositionRelation(state, payload.relation, dot);
    case "relation.remove":
      return {
        ...structuredClone(state),
        relations: removeORSetObserved(state.relations, payload.relation, payload.observedAdds)
      };
    case "decision.record":
      return recordPropositionDecision(state, payload.decision, dot);
    default:
      throw new TypeError("Type d'opération CRDT non pris en charge.");
  }
}

export function initializeCrdtOperationStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crdt_operations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      operation_kind TEXT NOT NULL,
      replica_id TEXT NOT NULL,
      dot_counter INTEGER NOT NULL CHECK(dot_counter > 0),
      operation_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, replica_id, dot_counter)
    );
    CREATE INDEX IF NOT EXISTS crdt_operations_project_sequence
      ON crdt_operations(project_id, sequence);
    CREATE TABLE IF NOT EXISTS crdt_object_states (
      project_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, object_type, object_id)
    );
  `);
}

export function applyCrdtOperation(db, operation) {
  const validation = validateCrdtOperation(operation);
  if (!validation.valid) throw new TypeError("Opération CRDT invalide : " + validation.errors.join(" "));
  initializeCrdtOperationStore(db);
  const operationJson = canonical(operation);
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db.prepare("SELECT op_id,operation_json FROM crdt_operations WHERE op_id=?").get(operation.opId);
    if (previous) {
      if (previous.operation_json !== operationJson) throw new Error("Collision : cet opId existe déjà avec un contenu différent.");
      db.exec("COMMIT");
      return { inserted: false, duplicate: true, opId: operation.opId };
    }
    const dotCollision = db.prepare(
      "SELECT op_id FROM crdt_operations WHERE project_id=? AND replica_id=? AND dot_counter=?"
    ).get(operation.projectId, operation.dot.replicaId, operation.dot.counter);
    if (dotCollision) throw new Error("Collision : ce dot CRDT est déjà attribué à une autre opération.");

    const current = db.prepare(
      "SELECT state_json FROM crdt_object_states WHERE project_id=? AND object_type=? AND object_id=?"
    ).get(operation.projectId, operation.objectType, operation.objectId);
    const state = current ? JSON.parse(current.state_json) : createPropositionCrdtState();
    const nextState = applyPropositionOperation(state, operation);
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO crdt_operations(
      op_id,project_id,object_type,object_id,operation_kind,replica_id,dot_counter,operation_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      operation.opId, operation.projectId, operation.objectType, operation.objectId,
      operation.kind, operation.dot.replicaId, operation.dot.counter, operationJson, operation.createdAt
    );
    db.prepare(`INSERT INTO crdt_object_states(project_id,object_type,object_id,state_json,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(project_id,object_type,object_id)
      DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(
      operation.projectId, operation.objectType, operation.objectId, JSON.stringify(nextState), now
    );
    const sequence = db.prepare("SELECT sequence FROM crdt_operations WHERE op_id=?").get(operation.opId).sequence;
    db.exec("COMMIT");
    return { inserted: true, duplicate: false, opId: operation.opId, sequence, state: nextState };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function getCrdtObjectState(db, projectId, objectType, objectId) {
  initializeCrdtOperationStore(db);
  const row = db.prepare(
    "SELECT state_json,updated_at FROM crdt_object_states WHERE project_id=? AND object_type=? AND object_id=?"
  ).get(projectId, objectType, objectId);
  return row ? { state: JSON.parse(row.state_json), updatedAt: row.updated_at } : null;
}

export function listCrdtOperations(db, projectId, { after = 0, limit = 200 } = {}) {
  initializeCrdtOperationStore(db);
  if (!nonEmpty(projectId)) throw new TypeError("projectId est requis.");
  if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Curseur CRDT invalide.");
  const safeLimit = Math.max(1, Math.min(500, Number.isSafeInteger(limit) ? limit : 200));
  const rows = db.prepare(
    "SELECT sequence,operation_json FROM crdt_operations WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT ?"
  ).all(projectId, after, safeLimit);
  return {
    operations: rows.map(row => JSON.parse(row.operation_json)),
    next: rows.length ? rows[rows.length - 1].sequence : after
  };
}
