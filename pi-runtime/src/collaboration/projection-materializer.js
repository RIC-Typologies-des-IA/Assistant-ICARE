import { getCrdtObjectState } from "./operation-store.js";
import { readPropositionCrdtState } from "./model.js";

const FIELD_COLUMNS = Object.freeze({
  text: "text", dimensions: "dimensions", primaryDimension: "primary_dimension",
  temporal: "temporal", evaluation: "evaluation", epistemic: "epistemic",
  practical: "practical", confidence: "confidence", source: "source", aspect: "aspect",
  utteranceTime: "utterance_time", validTimeStart: "valid_time_start",
  validTimeEnd: "valid_time_end", eventPeriodStart: "event_period_start",
  eventPeriodEnd: "event_period_end", targetHorizon: "target_horizon",
  realizationTime: "realization_time", modality: "modality", subject: "subject",
  predicate: "predicate", value: "value", author: "author",
  sourceAgent: "source_agent", sourceInteraction: "source_interaction",
  justification: "justification"
});

const hasTable = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
).get(name));

function valuesFor(readState, field) {
  return readState.fields[field] || [];
}
function singleValue(readState, field) {
  const values = valuesFor(readState, field);
  return values.length === 1 ? values[0] : undefined;
}
function sqlValue(field, value) {
  return field === "dimensions" ? JSON.stringify(value) : value;
}

function materializeProposition(db, projectId, objectId, state, operation) {
  if (!hasTable(db, "propositions")) return { projected: false, reason: "legacy-table-missing" };
  const readState = readPropositionCrdtState(state);
  const textValues = valuesFor(readState, "text");
  const dimensionValues = valuesFor(readState, "dimensions");
  const primaryValues = valuesFor(readState, "primaryDimension");
  if (!textValues.length || !dimensionValues.length || !primaryValues.length) {
    return { projected: false, reason: "required-field-missing" };
  }
  const current = db.prepare("SELECT id FROM propositions WHERE id=? AND project_id=?").get(objectId, projectId);
  if (!current) {
    const fields = Object.fromEntries(Object.entries(FIELD_COLUMNS).map(([field]) => [
      field, singleValue(readState, field)
    ]));
    // The SQL row is only a display projection. If a required field conflicts,
    // use an explicit placeholder/union; the API separately exposes every sibling.
    if (textValues.length > 1) fields.text = "[Conflit CRDT — plusieurs formulations à examiner]";
    const dimensionUnion = [...new Set(dimensionValues.flat().filter(value => typeof value === "string"))];
    const dimensions = dimensionValues.length === 1 ? dimensionValues[0] : dimensionUnion;
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      return { projected: false, reason: "invalid-dimensions" };
    }
    if (primaryValues.length > 1 || !fields.primaryDimension) fields.primaryDimension = dimensions[0];
    const columns = [
      "id", "text", "dimensions", "primary_dimension", "temporal", "evaluation",
      "epistemic", "practical", "confidence", "source", "aspect", "review_status",
      "created_at", "utterance_time", "valid_time_start", "valid_time_end",
      "event_period_start", "event_period_end", "target_horizon", "realization_time",
      "modality", "subject", "predicate", "value", "author", "source_agent",
      "source_interaction", "justification", "project_id"
    ];
    const values = [
      objectId, fields.text, JSON.stringify(dimensions), fields.primaryDimension,
      fields.temporal ?? "unknown", fields.evaluation ?? "unknown",
      fields.epistemic ?? "reported", fields.practical ?? "unspecified",
      Number.isFinite(fields.confidence) ? fields.confidence : 0.5,
      fields.source ?? "replicated", fields.aspect ?? "",
      readState.legacyReviewStatus.length === 1 && ["candidate", "accepted", "rejected"].includes(readState.legacyReviewStatus[0]) ? readState.legacyReviewStatus[0] : "candidate",
      operation.createdAt, fields.utteranceTime ?? null, fields.validTimeStart ?? null,
      fields.validTimeEnd ?? null, fields.eventPeriodStart ?? null, fields.eventPeriodEnd ?? null,
      fields.targetHorizon ?? null, fields.realizationTime ?? null, fields.modality ?? "unknown",
      fields.subject ?? null, fields.predicate ?? null, fields.value ?? null,
      fields.author ?? null, fields.sourceAgent ?? null, fields.sourceInteraction ?? null,
      fields.justification ?? null, projectId
    ];
    db.prepare(`INSERT INTO propositions(${columns.join(",")})
      VALUES(${columns.map(() => "?").join(",")})`).run(...values);
  } else {
    const assignments = [];
    const values = [];
    for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
      const value = singleValue(readState, field);
      if (value === undefined) continue;
      assignments.push(column + "=?");
      values.push(sqlValue(field, value));
    }
    if (assignments.length) {
      db.prepare("UPDATE propositions SET " + assignments.join(",") + " WHERE id=? AND project_id=?")
        .run(...values, objectId, projectId);
    }
  }

  const decisions = readState.validationDecisions.filter(decision =>
    (decision.targetType === "proposition" || !decision.targetType) &&
    (decision.targetId === objectId || !decision.targetId));
  const decisionStatuses = new Set(decisions.map(decision => decision.status)
    .filter(status => ["accepted", "rejected"].includes(status)));
  if (decisionStatuses.size === 1) {
    db.prepare("UPDATE propositions SET review_status=? WHERE id=? AND project_id=?")
      .run([...decisionStatuses][0], objectId, projectId);
  } else if (decisionStatuses.size > 1) {
    db.prepare("UPDATE propositions SET review_status='candidate' WHERE id=? AND project_id=?")
      .run(objectId, projectId);
  }
  return {
    projected: true,
    conflicts: Object.fromEntries(Object.entries(readState.fields)
      .filter(([, values]) => values.length > 1))
  };
}

function materializeRelations(db, projectId, fromId, readState) {
  if (!hasTable(db, "relations")) return 0;
  let count = 0;
  for (const relation of readState.relations) {
    if (!relation?.id || !relation.targetId || !relation.type) continue;
    const duplicates = readState.relations.filter(item => item.id === relation.id);
    if (duplicates.length !== 1) continue;
    const existing = db.prepare("SELECT id FROM relations WHERE id=? AND project_id=?").get(relation.id, projectId);
    if (!existing) {
      db.prepare(`INSERT INTO relations
        (id,from_id,to_id,relation,note,review_status,created_at,project_id)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        relation.id, fromId, relation.targetId, relation.type, relation.note || "",
        ["candidate", "accepted", "rejected"].includes(relation.reviewStatus) ? relation.reviewStatus : "candidate",
        new Date().toISOString(), projectId
      );
    } else {
      db.prepare("UPDATE relations SET from_id=?,to_id=?,relation=?,note=? WHERE id=? AND project_id=?")
        .run(fromId, relation.targetId, relation.type, relation.note || "", relation.id, projectId);
    }
    count++;
  }
  return count;
}

function materializeRelationDecisions(db, projectId, readState) {
  if (!hasTable(db, "relations")) return;
  const grouped = new Map();
  for (const decision of readState.validationDecisions) {
    if (decision.targetType !== "relation" || !decision.targetId) continue;
    const list = grouped.get(decision.targetId) || [];
    list.push(decision);
    grouped.set(decision.targetId, list);
  }
  for (const [relationId, decisions] of grouped) {
    const statuses = new Set(decisions.map(decision => decision.status)
      .filter(status => ["accepted", "rejected"].includes(status)));
    if (statuses.size === 1) {
      db.prepare("UPDATE relations SET review_status=? WHERE id=? AND project_id=?")
        .run([...statuses][0], relationId, projectId);
    } else if (statuses.size > 1) {
      db.prepare("UPDATE relations SET review_status='candidate' WHERE id=? AND project_id=?")
        .run(relationId, projectId);
    }
  }
}

/**
 * Keep the legacy SQL tables as read projections, never as the CRDT source of
 * truth. Concurrent field values are deliberately not selected or overwritten.
 */
export function materializeCrdtOperation(db, operation) {
  if (operation.objectType !== "proposition") return { projected: false, reason: "unsupported-object-type" };
  const stored = getCrdtObjectState(db, operation.projectId, operation.objectType, operation.objectId);
  if (!stored) return { projected: false, reason: "state-missing" };
  const result = materializeProposition(
    db, operation.projectId, operation.objectId, stored.state, operation
  );
  if (!result.projected) return result;
  const readState = readPropositionCrdtState(stored.state);
  const relations = materializeRelations(db, operation.projectId, operation.objectId, readState);
  materializeRelationDecisions(db, operation.projectId, readState);
  if (hasTable(db, "projects")) {
    db.prepare("UPDATE projects SET updated_at=? WHERE id=?")
      .run(new Date().toISOString(), operation.projectId);
  }
  return { ...result, relations };
}
