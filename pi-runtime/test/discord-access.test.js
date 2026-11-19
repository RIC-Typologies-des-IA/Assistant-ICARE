import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initializeReplicaStore } from "../src/collaboration/replica-store.js";
import { initializeCrdtOperationStore } from "../src/collaboration/operation-store.js";
import {
  bootstrapDiscordProjectOwner, getDiscordProjectAccess,
  grantDiscordProjectMember, revokeDiscordProjectMember
} from "../src/discord-access.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, updated_at TEXT)");
  db.exec("INSERT INTO projects(id,updated_at) VALUES('project-1','')");
  initializeReplicaStore(db);
  initializeCrdtOperationStore(db);
  return db;
}

test("the first channel binder bootstraps project ownership and can invite a member", () => {
  const db = database();
  const owner = bootstrapDiscordProjectOwner(db, "project-1", "discord-owner");
  assert.equal(owner.role, "owner");
  grantDiscordProjectMember(db, {
    projectId: "project-1", discordUserId: "discord-member",
    actorDiscordUserId: "discord-owner"
  });
  assert.equal(getDiscordProjectAccess(db, "project-1", "discord-member").role, "member");
  db.close();
});

test("only explicit project members receive access and membership revocation is causal", () => {
  const db = database();
  bootstrapDiscordProjectOwner(db, "project-1", "discord-owner");
  grantDiscordProjectMember(db, {
    projectId: "project-1", discordUserId: "discord-member",
    actorDiscordUserId: "discord-owner"
  });
  assert.equal(getDiscordProjectAccess(db, "project-1", "stranger"), null);
  assert.equal(revokeDiscordProjectMember(db, {
    projectId: "project-1", discordUserId: "discord-member",
    actorDiscordUserId: "discord-owner"
  }), true);
  assert.equal(getDiscordProjectAccess(db, "project-1", "discord-member"), null);
  db.close();
});

test("the last project owner cannot be revoked by the member command", () => {
  const db = database();
  bootstrapDiscordProjectOwner(db, "project-1", "discord-owner");
  assert.throws(() => revokeDiscordProjectMember(db, {
    projectId: "project-1", discordUserId: "discord-owner",
    actorDiscordUserId: "discord-owner"
  }), /propriétaire/);
  assert.equal(getDiscordProjectAccess(db, "project-1", "discord-owner").role, "owner");
  db.close();
});
