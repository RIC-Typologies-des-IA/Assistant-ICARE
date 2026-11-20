import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initializeCrdtOperationStore, getCrdtObjectState, listCrdtOperations, applyCrdtOperation } from "../src/collaboration/operation-store.js";
import { initializeReplicaStore } from "../src/collaboration/replica-store.js";
import { createLocalCrdtOperation, syncProjectWithPeer } from "../src/collaboration/sync-engine.js";
import { createProjectSyncPeer, authenticateProjectSyncPeer } from "../src/collaboration/peer-store.js";
import { readPropositionCrdtState } from "../src/collaboration/model.js";
import { requestContext } from "../src/collaboration/request-context.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO projects(id) VALUES('project-1')").run();
  initializeReplicaStore(db);
  initializeCrdtOperationStore(db);
  return db;
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json" }
  });
}

function remoteFetch(remoteDb) {
  return async (input, init = {}) => {
    const url = new URL(input);
    const projectId = decodeURIComponent(url.pathname.split("/")[3]);
    const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "");
    const permission = init.method === "POST" ? "write" : "read";
    if (!authenticateProjectSyncPeer(remoteDb, projectId, token, permission)) {
      return response({ error: "unauthorized" }, 401);
    }
    if (init.method === "POST") {
      const operation = JSON.parse(init.body);
      try {
        const result = applyCrdtOperation(remoteDb, operation);
        return response({ ok: true, ...result }, result.inserted ? 201 : 200);
      } catch (error) {
        return response({ error: error.message }, 409);
      }
    }
    const after = Number(url.searchParams.get("after") || 0);
    const limit = Number(url.searchParams.get("limit") || 100);
    return response(listCrdtOperations(remoteDb, projectId, { after, limit }));
  };
}

test("two replicas converge through bidirectional pull/push and resumable cursors", async () => {
  const local = database();
  const remote = database();
  const localOp = createLocalCrdtOperation(local, {
    projectId: "project-1", objectId: "proposal-1", kind: "field.set",
    payload: { field: "text", value: "Hypothèse depuis le téléphone" },
    actor: { type: "human", id: "alice" }
  });
  const remoteOp = createLocalCrdtOperation(remote, {
    projectId: "project-1", objectId: "proposal-1", kind: "field.set",
    payload: { field: "text", value: "Hypothèse depuis le poste fixe" },
    actor: { type: "human", id: "bob" }
  });
  assert.notEqual(localOp.dot.replicaId, remoteOp.dot.replicaId);
  const credential = createProjectSyncPeer(remote, "project-1", {
    label: "Téléphone", permissions: ["read", "write"]
  });

  const first = await syncProjectWithPeer(local, {
    projectId: "project-1", peerKey: credential.peerId,
    baseUrl: "https://replica.example.test", token: credential.token,
    fetchImpl: remoteFetch(remote), limit: 10
  });
  assert.equal(first.pulled, 1);
  assert.equal(first.pushed, 2);

  const localState = getCrdtObjectState(local, "project-1", "proposition", "proposal-1").state;
  const remoteState = getCrdtObjectState(remote, "project-1", "proposition", "proposal-1").state;
  assert.deepEqual(localState, remoteState);
  assert.equal(readPropositionCrdtState(localState).fields.text.length, 2);
  assert.equal(listCrdtOperations(local, "project-1").operations.length, 2);
  assert.equal(listCrdtOperations(remote, "project-1").operations.length, 2);

  const second = await syncProjectWithPeer(local, {
    projectId: "project-1", peerKey: credential.peerId,
    baseUrl: "https://replica.example.test", token: credential.token,
    fetchImpl: remoteFetch(remote), limit: 10
  });
  assert.equal(second.pulled, 0);
  assert.equal(second.pushed, 0);
  local.close();
  remote.close();
});

test("sync rejects non-HTTPS remote endpoints except loopback", async () => {
  const db = database();
  await assert.rejects(() => syncProjectWithPeer(db, {
    projectId: "project-1", peerKey: "peer", baseUrl: "http://replica.example.test",
    token: "token"
  }), /HTTPS/);
  db.close();
});

test("local operation creation allocates monotonic dots and carries causal context", () => {
  const db = database();
  const first = createLocalCrdtOperation(db, {
    projectId: "project-1", objectId: "proposal-1", kind: "field.set",
    payload: { field: "text", value: "A" }, actor: { type: "human", id: "alice" }
  });
  const second = createLocalCrdtOperation(db, {
    projectId: "project-1", objectId: "proposal-1", kind: "field.set",
    payload: { field: "text", value: "B" }, actor: { type: "human", id: "alice" }
  });
  assert.equal(second.dot.counter, first.dot.counter + 1);
  assert.equal(second.causalContext[first.dot.replicaId], first.dot.counter);
  db.close();
});

test("authenticated participant attribution is attached to new CRDT operations", () => {
  const db = database();
  const operation = requestContext.run({ discordIdentity: { id: "discord-user-7" } }, () =>
    createLocalCrdtOperation(db, {
      projectId: "project-1", objectId: "proposal-auth", kind: "field.set",
      payload: { field: "text", value: "Contribution authentifiée" },
      actor: { type: "human", id: "local-user" }
    })
  );
  assert.deepEqual(operation.actor.participant, { type: "discord", id: "discord-user-7" });
  db.close();
});

test("revoked participant operations are quarantined and never retried for publication", async () => {
  const db = database();
  const operation = createLocalCrdtOperation(db, {
    projectId: "project-1", objectId: "proposal-revoked", kind: "field.set",
    payload: { field: "text", value: "Modification hors ligne" },
    actor: { type: "human", id: "local-user", participant: { type: "discord", id: "revoked-user" } }
  });
  let postAttempts = 0;
  const fetchImpl = async (_input, init = {}) => {
    if (init.method === "POST") {
      postAttempts++;
      return response({
        error: "Participant révoqué.",
        code: "REJECTED_AUTHORIZATION",
        operationId: operation.opId
      }, 403);
    }
    return response({ operations: [], next: 0 });
  };
  const options = {
    projectId: "project-1", peerKey: "peer-1",
    baseUrl: "https://replica.example.test", token: "peer-token", fetchImpl
  };
  const first = await syncProjectWithPeer(db, options);
  assert.equal(first.pushed, 0);
  assert.equal(first.rejectedAuthorization, 1);
  assert.equal(postAttempts, 1);
  const stored = db.prepare("SELECT state FROM crdt_sync_rejections WHERE project_id=? AND peer_key=? AND operation_id=?")
    .get("project-1", "peer-1", operation.opId);
  assert.equal(stored.state, "REJECTED_AUTHORIZATION");
  const second = await syncProjectWithPeer(db, options);
  assert.equal(second.pushed, 0);
  assert.equal(postAttempts, 1);
  db.close();
});
