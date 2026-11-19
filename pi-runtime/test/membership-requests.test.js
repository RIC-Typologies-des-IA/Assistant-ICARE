import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initializeReplicaStore } from "../src/collaboration/replica-store.js";
import { initializeCrdtOperationStore } from "../src/collaboration/operation-store.js";
import {
  bootstrapDiscordProjectOwner, getDiscordProjectAccess,
  grantDiscordProjectMember
} from "../src/discord-access.js";
import {
  decideDiscordMembershipRequest, initializeMembershipRequestStore,
  listPendingDiscordMembershipRequests, requestDiscordProjectMembership
} from "../src/collaboration/membership-requests.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, updated_at TEXT); INSERT INTO projects VALUES('p1','')");
  initializeReplicaStore(db);
  initializeCrdtOperationStore(db);
  initializeMembershipRequestStore(db);
  bootstrapDiscordProjectOwner(db, "p1", "owner");
  return db;
}

test("requesting access creates a pending request but never membership", () => {
  const db = database();
  const result = requestDiscordProjectMembership(db, { projectId: "p1", discordUserId: "guest" });
  assert.equal(result.request.status, "pending");
  assert.equal(getDiscordProjectAccess(db, "p1", "guest"), null);
  db.close();
});

test("repeated requests are idempotent while one request is pending", () => {
  const db = database();
  const first = requestDiscordProjectMembership(db, { projectId: "p1", discordUserId: "guest" });
  const second = requestDiscordProjectMembership(db, { projectId: "p1", discordUserId: "guest" });
  assert.equal(second.duplicate, true);
  assert.equal(second.request.request_id, first.request.request_id);
  db.close();
});

test("members cannot list or decide requests; owners can accept and grant member", () => {
  const db = database();
  grantDiscordProjectMember(db, { projectId: "p1", discordUserId: "member", actorDiscordUserId: "owner" });
  const request = requestDiscordProjectMembership(db, { projectId: "p1", discordUserId: "guest" }).request;
  assert.throws(() => listPendingDiscordMembershipRequests(db, {
    projectId: "p1", actorDiscordUserId: "member"
  }), /Seul un propriétaire/);
  assert.throws(() => decideDiscordMembershipRequest(db, {
    projectId: "p1", requestId: request.request_id,
    actorDiscordUserId: "member", decision: "accepted"
  }), /Seul un propriétaire/);
  const decision = decideDiscordMembershipRequest(db, {
    projectId: "p1", requestId: request.request_id,
    actorDiscordUserId: "owner", decision: "accepted"
  });
  assert.equal(decision.status, "accepted");
  assert.equal(getDiscordProjectAccess(db, "p1", "guest").role, "member");
  assert.equal(listPendingDiscordMembershipRequests(db, {
    projectId: "p1", actorDiscordUserId: "owner"
  }).length, 0);
  db.close();
});

test("rejecting a request does not create membership", () => {
  const db = database();
  const request = requestDiscordProjectMembership(db, { projectId: "p1", discordUserId: "guest" }).request;
  decideDiscordMembershipRequest(db, {
    projectId: "p1", requestId: request.request_id,
    actorDiscordUserId: "owner", decision: "rejected"
  });
  assert.equal(getDiscordProjectAccess(db, "p1", "guest"), null);
  db.close();
});

test("already-members cannot create redundant requests and decisions are single-use", () => {
  const db = database();
  assert.equal(requestDiscordProjectMembership(db, {
    projectId: "p1", discordUserId: "owner"
  }).alreadyMember, true);
  const request = requestDiscordProjectMembership(db, { projectId: "p1", discordUserId: "guest" }).request;
  decideDiscordMembershipRequest(db, {
    projectId: "p1", requestId: request.request_id,
    actorDiscordUserId: "owner", decision: "rejected"
  });
  assert.throws(() => decideDiscordMembershipRequest(db, {
    projectId: "p1", requestId: request.request_id,
    actorDiscordUserId: "owner", decision: "accepted"
  }), /introuvable ou déjà traitée/);
  db.close();
});
