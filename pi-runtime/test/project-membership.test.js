import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyCrdtOperation, getCrdtObjectState, initializeCrdtOperationStore } from "../src/collaboration/operation-store.js";
import { getProjectMemberAccess, readProjectMembers } from "../src/collaboration/project-membership.js";
import { materializeCrdtOperation } from "../src/collaboration/projection-materializer.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, updated_at TEXT)");
  db.exec("INSERT INTO projects(id,updated_at) VALUES('project-1','')");
  initializeCrdtOperationStore(db);
  return db;
}

function operation(overrides = {}) {
  return {
    version: 1, opId: "grant-1", projectId: "project-1",
    objectType: "project", objectId: "project-1",
    kind: "project.member.grant",
    dot: { replicaId: "phone", counter: 1 }, causalContext: {},
    actor: { type: "human", id: "discord:owner-1" },
    payload: { member: { principalType: "discord", principalId: "user-1", role: "owner" } },
    createdAt: "2026-11-19T08:00:00.000Z",
    ...overrides
  };
}

test("project membership grants replicate and materialize into the local ACL table", () => {
  const db = database();
  const grant = operation();
  applyCrdtOperation(db, grant);
  const projection = materializeCrdtOperation(db, grant);
  assert.equal(projection.projected, true);
  assert.equal(projection.members.length, 1);
  assert.deepEqual(readProjectMembers(getCrdtObjectState(db, "project-1", "project", "project-1").state), [
    { principalType: "discord", principalId: "user-1", role: "owner" }
  ]);
  const row = db.prepare("SELECT * FROM project_members WHERE project_id='project-1'").get();
  assert.equal(row.principal_id, "user-1");
  assert.equal(row.role, "owner");
  db.close();
});

test("a revoke removes only observed grants and preserves a concurrent grant", () => {
  const db = database();
  const member = { principalType: "discord", principalId: "user-2", role: "member" };
  const first = operation({
    opId: "grant-phone", payload: { member }
  });
  const concurrent = operation({
    opId: "grant-desktop", dot: { replicaId: "desktop", counter: 1 },
    actor: { type: "human", id: "discord:owner-2" }, payload: { member }
  });
  applyCrdtOperation(db, first);
  applyCrdtOperation(db, concurrent);
  const revoke = operation({
    opId: "revoke-phone", kind: "project.member.revoke",
    dot: { replicaId: "phone", counter: 2 }, causalContext: { phone: 1 },
    payload: { member, observedAdds: [{ dot: first.dot, value: member }] }
  });
  applyCrdtOperation(db, revoke);
  materializeCrdtOperation(db, revoke);
  const state = getCrdtObjectState(db, "project-1", "project", "project-1").state;
  assert.deepEqual(readProjectMembers(state), [member]);
  assert.equal(getProjectMemberAccess(state, "discord", "user-2").role, "member");
  db.close();
});

test("concurrent role grants are surfaced as a role conflict, never promoted to owner", () => {
  const db = database();
  const ownerGrant = operation({
    opId: "owner", payload: { member: { principalType: "discord", principalId: "user-3", role: "owner" } }
  });
  const memberGrant = operation({
    opId: "member", dot: { replicaId: "desktop", counter: 1 },
    actor: { type: "human", id: "discord:owner-2" },
    payload: { member: { principalType: "discord", principalId: "user-3", role: "member" } }
  });
  applyCrdtOperation(db, ownerGrant);
  applyCrdtOperation(db, memberGrant);
  const state = getCrdtObjectState(db, "project-1", "project", "project-1").state;
  const access = getProjectMemberAccess(state, "discord", "user-3");
  assert.equal(access.role, "member");
  assert.equal(access.roleConflict, true);
  db.close();
});

test("project membership operations reject invalid roles and non-human actors", () => {
  const db = database();
  assert.throws(() => applyCrdtOperation(db, operation({
    payload: { member: { principalType: "discord", principalId: "user-4", role: "administrator" } }
  })), /Membre de projet invalide/);
  assert.throws(() => applyCrdtOperation(db, operation({
    actor: { type: "agent", id: "icare" }
  })), /acteur humain/);
  db.close();
});
