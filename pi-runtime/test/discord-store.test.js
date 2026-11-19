import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  bindDiscordChannelToProject, getDiscordBoundProject,
  initializeDiscordBindingStore, unbindDiscordChannel
} from "../src/discord-store.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY)");
  db.exec("INSERT INTO projects(id) VALUES('project-a'),('project-b')");
  initializeDiscordBindingStore(db);
  return db;
}

test("Discord channel and thread bindings resolve to an ICARE project", () => {
  const db = database();
  bindDiscordChannelToProject(db, {
    channelId: "channel-1", projectId: "project-a", boundBy: "discord-user-1"
  });
  bindDiscordChannelToProject(db, {
    channelId: "thread-1", projectId: "project-a", boundBy: "discord-user-1"
  });
  assert.equal(getDiscordBoundProject(db, { channelId: "thread-1" }), "project-a");
  assert.equal(getDiscordBoundProject(db, {
    channelId: "thread-2", parentChannelId: "channel-1"
  }), "project-a");
  db.close();
});

test("channel bindings can be changed and revoked without dimension-specific channels", () => {
  const db = database();
  bindDiscordChannelToProject(db, {
    channelId: "channel-1", projectId: "project-a", boundBy: "admin"
  });
  bindDiscordChannelToProject(db, {
    channelId: "channel-1", projectId: "project-b", boundBy: "admin"
  });
  assert.equal(getDiscordBoundProject(db, { channelId: "channel-1" }), "project-b");
  assert.equal(unbindDiscordChannel(db, "channel-1"), true);
  assert.equal(getDiscordBoundProject(db, { channelId: "channel-1" }), null);
  assert.equal(unbindDiscordChannel(db, "channel-1"), false);
  db.close();
});

test("unknown projects and incomplete bindings are rejected", () => {
  const db = database();
  assert.throws(() => bindDiscordChannelToProject(db, {
    channelId: "channel", projectId: "missing", boundBy: "admin"
  }), /introuvable/);
  assert.throws(() => bindDiscordChannelToProject(db, {
    channelId: "channel", projectId: "project-a", boundBy: ""
  }), /requis/);
  db.close();
});

test("stale bindings are removed when a project no longer exists locally", () => {
  const db = database();
  bindDiscordChannelToProject(db, {
    channelId: "channel-stale", projectId: "project-a", boundBy: "admin"
  });
  db.prepare("DELETE FROM projects WHERE id='project-a'").run();
  assert.equal(getDiscordBoundProject(db, { channelId: "channel-stale" }), null);
  assert.equal(db.prepare("SELECT channel_id FROM discord_project_bindings WHERE channel_id='channel-stale'").get(), undefined);
  db.close();
});
