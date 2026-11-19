/**
 * Durable operation journal for ICARE proposition CRDTs.
 *
 * Operations are immutable, idempotent and applied transactionally with their
 * materialized object state. A replica may receive operations out of order.
 */
import {
  assignMVRegister, normalizeVersionVector, removeORSetObserved
} from "./crdt.js";
import {
  PROPOSITION_REGISTER_FIELDS, createPropositionCrdtState, editPropositionField,
  addPropositionObservation, addPropositionRelation, initializePropositionFields,
  recordPropositionDecision, upgradePropositionCrdtState
} from "./model.js";
import {
  assertProjectMembershipState, createProjectMembershipState,
  grantProjectMember, getProjectMemberAccess, readProjectMembers, revokeProjectMember
} from "./project-membership.js";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (isRecord(value)) return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}

const OPERATION_KINDS = new Set([
  "field.set", "proposition.snapshot", "observation.add", "observation.remove",
  "relation.add", "relation.remove", "decision.record",
  "project.member.grant", "project.member.revoke"
]);

export function validateCrdtOperation(operation) {
  const errors = [];
  if (!isRecord(operation)) return { valid: false, errors: ["L'opération doit être un objet."] };
  if (operation.version !== 1) errors.push("Version d'opération CRDT non prise en charge.");
  for (const key of ["opId", "projectId", "objectId", "createdAt"]) {
    if (!nonEmpty(operation[key])) errors.push("Champ requis invalide : " + key);
  }
  if (!["proposition", "project"].includes(operation.objectType)) errors.push("Type d'objet CRDT non pris en charge.");
  if (operation.objectType === "project" && operation.objectId !== operation.projectId) errors.push("L'objet de membership doit être le projet lui-même.");
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
    if (operation.objectType === "project") {
      if (!["project.member.grant", "project.member.revoke"].includes(operation.kind)) {
        errors.push("Opération de projet non prise en charge.");
      }
      if (operation.actor?.type !== "human") errors.push("Une opération de membership doit être attribuée à un acteur humain.");
      const member = operation.payload.member;
      if (!isRecord(member) || member.principalType !== "discord" ||
          !nonEmpty(member.principalId) || !["owner", "member"].includes(member.role)) {
        errors.push("Membre de projet invalide.");
      }
      if (operation.kind === "project.member.revoke") {
        if (!Array.isArray(operation.payload.observedAdds)) errors.push("La révocation doit déclarer les grants observés.");
        else for (const entry of operation.payload.observedAdds) {
          const dot = entry?.dot;
          if (!isRecord(entry) || !isRecord(dot) || !nonEmpty(dot.replicaId) ||
              !Number.isSafeInteger(dot.counter) || dot.counter < 1 ||
              !isRecord(entry.value) || canonical(entry.value) !== canonical(member)) {
            errors.push("Grant observé invalide.");
          } else if ((context[dot.replicaId] || 0) < dot.counter) {
            errors.push("Le contexte causal ne couvre pas tous les grants révoqués.");
          }
        }
      }
    }
    if (operation.objectType === "proposition" && ["project.member.grant", "project.member.revoke"].includes(operation.kind)) {
      errors.push("Une opération de membership doit cibler un objet projet.");
    }
    if (operation.kind === "field.set" && (!nonEmpty(operation.payload.field) || !Object.hasOwn(operation.payload, "value"))) errors.push("Champ et valeur de proposition requis.");
    if (operation.kind === "proposition.snapshot") {
      if (!isRecord(operation.payload.fields) || Object.keys(operation.payload.fields).length === 0) {
        errors.push("Instantané de proposition vide ou invalide.");
      } else {
        for (const field of Object.keys(operation.payload.fields)) {
          if (!PROPOSITION_REGISTER_FIELDS.includes(field)) errors.push("Champ d'instantané non pris en charge : " + field);
        }
      }
      if (operation.payload.legacyReviewStatus !== undefined &&
          !["candidate", "accepted", "rejected"].includes(operation.payload.legacyReviewStatus)) {
        errors.push("Statut historique de proposition invalide.");
      }
    }
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
      if (decision?.resolves !== undefined &&
          (!Array.isArray(decision.resolves) || decision.resolves.some(id => !nonEmpty(id)) ||
           new Set(decision.resolves).size !== decision.resolves.length)) {
        errors.push("La liste des décisions résolues est invalide.");
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
    case "proposition.snapshot": {
      const initialized = initializePropositionFields(state, payload.fields, dot, context);
      return payload.legacyReviewStatus === undefined ? initialized : {
        ...initialized,
        legacyReviewStatus: assignMVRegister(initialized.legacyReviewStatus, payload.legacyReviewStatus, dot, context)
      };
    }
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

export function applyProjectMembershipOperation(state, operation) {
  const validation = validateCrdtOperation(operation);
  if (!validation.valid) throw new TypeError("Opération de membership CRDT invalide : " + validation.errors.join(" "));
  assertProjectMembershipState(state);
  const actorId = operation.actor.id.startsWith("discord:")
    ? operation.actor.id.slice("discord:".length) : "";
  if (!actorId) throw new Error("L'acteur de membership doit être une identité Discord vérifiée.");
  const members = readProjectMembers(state);
  const owners = new Set(members.filter(member => member.role === "owner").map(member => member.principalId));
  const actorAccess = getProjectMemberAccess(state, "discord", actorId);

  if (operation.kind === "project.member.grant") {
    const target = operation.payload.member;
    if (owners.size === 0) {
      if (target.role !== "owner" || target.principalId !== actorId) {
        throw new Error("Seul le premier propriétaire peut initialiser l'accès au projet.");
      }
    } else if (actorAccess?.role !== "owner" || actorAccess.roleConflict) {
      throw new Error("Seul un propriétaire actif peut accorder un accès au projet.");
    }
    return grantProjectMember(state, target, operation.dot);
  }
  if (operation.kind === "project.member.revoke") {
    if (actorAccess?.role !== "owner" || actorAccess.roleConflict) {
      throw new Error("Seul un propriétaire actif peut révoquer un accès au projet.");
    }
    const target = operation.payload.member;
    const targetAccess = getProjectMemberAccess(state, "discord", target.principalId);
    if (!targetAccess) throw new Error("Le grant à révoquer doit être reçu avant sa révocation.");
    if (target.role === "owner" && owners.size <= 1) {
      throw new Error("Le dernier propriétaire du projet ne peut pas être révoqué.");
    }
    for (const entry of operation.payload.observedAdds) {
      const existing = state.members.adds.find(add =>
        add.dot.replicaId === entry.dot.replicaId && add.dot.counter === entry.dot.counter);
      if (!existing || canonical(existing.value) !== canonical(entry.value)) {
        throw new Error("Le grant observé doit être reçu avant sa révocation.");
      }
    }
    return revokeProjectMember(state, target, operation.payload.observedAdds);
  }
  throw new TypeError("Opération de membership non prise en charge.");
}

export function _unusedApplyProjectMembershipOperationMarker(state, operation) {
  if (operation.kind === "project.member.grant") {
    return grantProjectMember(state, operation.payload.member, operation.dot);
  }
  if (operation.kind === "project.member.revoke") {
    return revokeProjectMember(state, operation.payload.member, operation.payload.observedAdds);
  }
  throw new TypeError("Opération de membership non prise en charge.");
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

    if (operation.kind === "decision.record" && operation.payload.decision.resolves?.length) {
      const rows = db.prepare(`SELECT operation_json FROM crdt_operations
        WHERE project_id=? AND object_type=? AND object_id=? AND operation_kind='decision.record'`)
        .all(operation.projectId, operation.objectType, operation.objectId);
      const known = new Map();
      for (const row of rows) {
        const prior = JSON.parse(row.operation_json);
        const decision = prior.payload?.decision;
        if (decision?.id) known.set(decision.id, { decision, dot: prior.dot });
      }
      for (const resolvedId of operation.payload.decision.resolves) {
        const prior = known.get(resolvedId);
        if (!prior) throw new Error("Dépendance de résolution manquante : la décision " + resolvedId + " doit être reçue avant sa résolution.");
        if ((operation.causalContext[prior.dot.replicaId] || 0) < prior.dot.counter) {
          throw new Error("La résolution ne possède pas de contexte causal couvrant la décision " + resolvedId + ".");
        }
        if (prior.decision.targetType !== operation.payload.decision.targetType ||
            prior.decision.targetId !== operation.payload.decision.targetId) {
          throw new Error("Une décision ne peut résoudre qu'une décision portant sur la même cible.");
        }
      }
    }

    const current = db.prepare(
      "SELECT state_json FROM crdt_object_states WHERE project_id=? AND object_type=? AND object_id=?"
    ).get(operation.projectId, operation.objectType, operation.objectId);
    const state = current
      ? (operation.objectType === "proposition"
        ? upgradePropositionCrdtState(JSON.parse(current.state_json))
        : JSON.parse(current.state_json))
      : (operation.objectType === "proposition" ? createPropositionCrdtState() : createProjectMembershipState());
    const nextState = operation.objectType === "proposition"
      ? applyPropositionOperation(state, operation)
      : applyProjectMembershipOperation(state, operation);
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
  if (!row) return null;
  const storedState = JSON.parse(row.state_json);
  const state = objectType === "proposition"
    ? upgradePropositionCrdtState(storedState)
    : storedState;
  if (objectType === "project") assertProjectMembershipState(state);
  if (JSON.stringify(state) !== JSON.stringify(storedState)) {
    db.prepare("UPDATE crdt_object_states SET state_json=? WHERE project_id=? AND object_type=? AND object_id=?")
      .run(JSON.stringify(state), projectId, objectType, objectId);
  }
  return { state, updatedAt: row.updated_at };
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
