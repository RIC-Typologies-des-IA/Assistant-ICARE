import { randomUUID } from "node:crypto";
import { allocateLocalDot, getLocalReplicaState } from "./replica-store.js";
import { mergeVersionVectors } from "./crdt.js";
import {
  applyCrdtOperation, initializeCrdtOperationStore, listCrdtOperations, validateCrdtOperation
} from "./operation-store.js";
import { materializeCrdtOperation } from "./projection-materializer.js";

const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

export function getProjectCausalContext(db, projectId) {
  const rows = db.prepare("SELECT operation_json FROM crdt_operations WHERE project_id=?").all(projectId);
  const vectors = [];
  for (const row of rows) {
    const operation = JSON.parse(row.operation_json);
    vectors.push(operation.causalContext || {});
    vectors.push({ [operation.dot.replicaId]: operation.dot.counter });
  }
  const local = getLocalReplicaState(db);
  vectors.push({ [local.replicaId]: local.counter });
  return mergeVersionVectors(...vectors);
}

/** Create, dot, validate and persist a local semantic operation. */
export function createLocalCrdtOperation(db, {
  projectId, objectId, objectType = "proposition", kind, payload, actor
}) {
  if (!nonEmpty(projectId) || !nonEmpty(objectId)) throw new TypeError("Projet et objet requis.");
  const causalContext = getProjectCausalContext(db, projectId);
  const identity = getLocalReplicaState(db);
  const proposedDot = {
    replicaId: identity.replicaId,
    counter: Math.max(identity.counter, causalContext[identity.replicaId] || 0) + 1
  };
  const candidate = {
    version: 1, opId: randomUUID(), projectId, objectType, objectId, kind,
    dot: proposedDot, causalContext, actor, payload, createdAt: new Date().toISOString()
  };
  const validation = validateCrdtOperation(candidate);
  if (!validation.valid) throw new TypeError("Opération CRDT locale invalide : " + validation.errors.join(" "));
  const dot = allocateLocalDot(db, causalContext);
  if (dot.counter !== proposedDot.counter || dot.replicaId !== proposedDot.replicaId) {
    throw new Error("L'identité ou le compteur de réplique a changé pendant la création de l'opération.");
  }
  const operation = { ...candidate, dot };
  applyCrdtOperation(db, operation);
  materializeCrdtOperation(db, operation);
  return operation;
}

export function initializeCrdtSyncCursorStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crdt_sync_cursors (
      project_id TEXT NOT NULL,
      peer_key TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, peer_key, direction)
    );
  `);
}

function getCursor(db, projectId, peerKey, direction) {
  initializeCrdtSyncCursorStore(db);
  return db.prepare(`SELECT cursor FROM crdt_sync_cursors
    WHERE project_id=? AND peer_key=? AND direction=?`)
    .get(projectId, peerKey, direction)?.cursor || 0;
}

function setCursor(db, projectId, peerKey, direction, cursor) {
  db.prepare(`INSERT INTO crdt_sync_cursors(project_id,peer_key,direction,cursor,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(project_id,peer_key,direction)
    DO UPDATE SET cursor=MAX(cursor,excluded.cursor),updated_at=excluded.updated_at`)
    .run(projectId, peerKey, direction, cursor, new Date().toISOString());
}

function validateRemote(remoteUrl) {
  const url = new URL(remoteUrl);
  const localHttp = url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError("La réplication distante exige HTTPS (HTTP est réservé à la boucle locale).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("L'URL distante ne doit contenir ni identifiants, ni paramètres, ni fragment.");
  }
  return url.origin + url.pathname.replace(/\/$/, "");
}

/**
 * Bidirectional pull/push. Cursors advance only after a complete batch,
 * so an interrupted batch is safely replayed through operation idempotency.
 */
export async function syncProjectWithPeer(db, {
  projectId, peerKey, baseUrl, token, limit = 100, maxBatches = 10,
  fetchImpl = fetch, timeoutMs = 15000
}) {
  if (!nonEmpty(projectId) || !nonEmpty(peerKey) || !nonEmpty(token)) {
    throw new TypeError("Projet, identifiant de pair et jeton requis.");
  }
  const remote = validateRemote(baseUrl);
  const safeLimit = Math.max(1, Math.min(100, Number.isSafeInteger(limit) ? limit : 100));
  const safeBatches = Math.max(1, Math.min(50, Number.isSafeInteger(maxBatches) ? maxBatches : 10));
  initializeCrdtOperationStore(db);
  initializeCrdtSyncCursorStore(db);
  const endpoint = remote + "/api/projects/" + encodeURIComponent(projectId) + "/crdt/operations";
  const headers = { Authorization: "Bearer " + token, Accept: "application/json" };
  const request = async (url, method = "GET", body = undefined) => {
    const response = await fetchImpl(url, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Pair distant : HTTP " + response.status + " — " + (payload.error || response.statusText));
    return payload;
  };

  let pulled = 0, pushed = 0, inboundBatches = 0, outboundBatches = 0;
  let inboundCursor = getCursor(db, projectId, peerKey, "inbound");
  let outboundCursor = getCursor(db, projectId, peerKey, "outbound");

  for (; inboundBatches < safeBatches; inboundBatches++) {
    const batch = await request(endpoint + "?after=" + inboundCursor + "&limit=" + safeLimit);
    if (!Array.isArray(batch.operations) || !Number.isSafeInteger(batch.next) || batch.next < inboundCursor) {
      throw new Error("Réponse de pull distante invalide.");
    }
    for (const operation of batch.operations) {
      if (operation.projectId !== projectId) throw new Error("Le pair a renvoyé une opération d'un autre projet.");
      const applied = applyCrdtOperation(db, operation);
      materializeCrdtOperation(db, operation);
      if (applied.inserted) pulled++;
    }
    if (batch.operations.length === 0) break;
    if (batch.next === inboundCursor) throw new Error("Le curseur distant n'avance pas.");
    inboundCursor = batch.next;
    setCursor(db, projectId, peerKey, "inbound", inboundCursor);
    if (batch.operations.length < safeLimit) break;
  }

  for (; outboundBatches < safeBatches; outboundBatches++) {
    const batch = listCrdtOperations(db, projectId, { after: outboundCursor, limit: safeLimit });
    if (batch.operations.length === 0) break;
    for (const operation of batch.operations) {
      await request(endpoint, "POST", operation);
      pushed++;
    }
    if (batch.next <= outboundCursor) throw new Error("Le curseur local n'avance pas.");
    outboundCursor = batch.next;
    setCursor(db, projectId, peerKey, "outbound", outboundCursor);
    if (batch.operations.length < safeLimit) break;
  }

  return { projectId, peerKey, pulled, pushed, inboundCursor, outboundCursor,
    inboundBatches, outboundBatches };
}
