import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Discord bot is an optional server-side adapter using ICARE chat sessions", async () => {
  const adapter = await read("../src/discord-adapter.js");
  const server = await read("../src/server.js");
  assert.ok(adapter.includes('from "discord.js"'));
  assert.ok(adapter.includes("GatewayIntentBits.MessageContent"));
  assert.ok(adapter.includes("message.mentions.has(client.user)"));
  assert.ok(adapter.includes('fetch("http://127.0.0.1:" + port + "/api/chat"'));
  assert.ok(adapter.includes('setName("bind")'));
  assert.ok(adapter.includes("PermissionFlagsBits.ManageGuild"));
  assert.ok(adapter.includes("allowedMentions: { parse: [] }"));
  assert.ok(adapter.includes("bootstrapDiscordProjectOwner"));
  assert.ok(adapter.includes("getDiscordProjectAccess"));
  assert.ok(adapter.includes('setName("invite")'));
  assert.ok(adapter.includes('setName("revoke")'));
  assert.ok(adapter.includes("defaultProjectId: isDm ? defaultProjectId : null"));
  assert.ok(server.includes("startDiscordBot({ db, port: PORT })"));
});

test("Discord project bindings are channel-scoped, not dimension-scoped", async () => {
  const store = await read("../src/discord-store.js");
  assert.ok(store.includes("discord_project_bindings"));
  assert.ok(store.includes("channel_id"));
  assert.ok(!store.toLowerCase().includes("dimension"));
});

test("Activity OAuth secrets remain server-side and origin-restricted", async () => {
  const server = await read("../src/server.js");
  const activity = await read("../public/discord-activity.js");
  const html = await read("../public/index.html");
  assert.ok(server.includes("DISCORD_CLIENT_SECRET"));
  assert.ok(server.includes("req.headers.origin === new URL(DISCORD_ACTIVITY_ORIGIN).origin"));
  assert.ok(server.includes("/api/discord/token"));
  assert.ok(server.includes("/api/discord/context"));
  assert.ok(server.includes("defaultProjectId: guildId ? null : process.env.ICARE_DISCORD_DEFAULT_PROJECT_ID"));
  assert.ok(server.includes("instance.users.includes(discordUser.id)"));
  assert.ok(server.includes("getDiscordProjectAccess(db, projectId, discordUser.id)"));
  assert.ok(server.includes("activity-instances/"));
  assert.ok(server.includes("process.env.DISCORD_BOT_TOKEN"));
  assert.ok(activity.includes("@discord/embedded-app-sdk@2.5.0"));
  assert.ok(activity.includes("discordSdk.commands.authenticate"));
  assert.ok(activity.includes("getActivityInstanceConnectedParticipants"));
  assert.ok(activity.includes("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE"));
  assert.ok(activity.includes("instanceId: discordSdk.instanceId || \"\""));
  assert.ok(!activity.includes("DISCORD_BOT_TOKEN"));
  assert.ok(!activity.includes("DISCORD_CLIENT_SECRET"));
  assert.ok(html.includes('src="/discord-activity.js"'));
  assert.ok(html.includes("icare:discord-ready"));
  assert.ok(html.includes('sessionId=("discord-activity-"+event.detail.instanceId)'));
  assert.ok(html.includes("renderDiscordParticipants"));
});

test("Activity project selection refuses to silently fall back to another project", async () => {
  const html = await read("../public/index.html");
  assert.ok(html.includes("discordActivityProjectId"));
  assert.ok(html.includes("Le projet Discord lié n'est pas encore présent"));
});

test("membership request API is Discord-authenticated and owner-gated", async () => {
  const server = await read("../src/server.js");
  const access = await read("../src/collaboration/membership-requests.js");
  assert.ok(server.includes("/membership-requests"));
  assert.ok(server.includes('req.headers.origin === new URL(DISCORD_ACTIVITY_ORIGIN).origin'));
  assert.ok(server.includes('https://discord.com/api/v10/users/@me'));
  assert.ok(server.includes("requestDiscordProjectMembership(db"));
  assert.ok(server.includes("listPendingDiscordMembershipRequests(db"));
  assert.ok(server.includes("decideDiscordMembershipRequest(db"));
  assert.ok(access.includes("Seul un propriétaire actif peut traiter une demande"));
  assert.ok(access.includes('role: "member"'));
});

test("project APIs require Discord authentication and current project membership", async () => {
  const server = await read("../src/server.js");
  assert.ok(server.includes("async function authenticateDiscordRequest(req)"));
  assert.ok(server.includes("All project APIs require a live Discord identity"));
  assert.ok(server.includes("getDiscordProjectAccess(db, projectId, identity.id)"));
  assert.ok(server.includes("Ce compte Discord n'est pas membre de ce projet"));
  assert.ok(server.includes("req.__icareBodyPromise"));
  assert.ok(server.includes("isPeerReplicationApi"));
});

test("non-members can reach the request flow without project content being loaded", async () => {
  const server = await read("../src/server.js");
  const html = await read("../public/index.html");
  const contextStart = server.indexOf('if (req.method === "POST" && url.pathname === "/api/discord/context")');
  const contextEnd = server.indexOf('const membershipRequestMatch', contextStart);
  const contextRoute = server.slice(contextStart, contextEnd);
  assert.ok(contextRoute.includes("isMember: Boolean(access"));
  assert.ok(!contextRoute.includes("if (projectId && !access)"));
  assert.ok(html.includes("Demander à rejoindre"));
  assert.ok(html.includes("await loadProjects();await refresh()"));
  assert.ok(html.includes("if(!context.isMember)"));
});

test("standalone web view does not load private project data without Discord authentication", async () => {
  const html = await read("../public/index.html");
  assert.ok(html.includes('has("frame_id")'));
  assert.ok(html.includes("ouvrez ICARE depuis son Activity Discord"));
  assert.ok(html.includes("installDiscordApiFetch"));
});

test("project list and creation are bound to the authenticated Discord participant", async () => {
  const server = await read("../src/server.js");
  assert.ok(server.includes(".filter(project => { const access = getDiscordProjectAccess(db, project.id, req.discordIdentity.id); return access && !access.roleConflict; })"));
  assert.ok(server.includes('id: "discord:" + req.discordIdentity.id'));
  assert.ok(server.includes('bootstrapDiscordProjectOwner(db, id, req.discordIdentity.id)'));
  assert.ok(!server.includes('const actor = body.actor ?? { type: "human", id: "local" }'));
});

test("project-scoped APIs reject requests without a project identifier", async () => {
  const server = await read("../src/server.js");
  assert.ok(server.includes("const projectScopedRoute"));
  assert.ok(server.includes("Identifiant de projet requis pour cette opération"));
  assert.ok(server.includes(".filter(project => { const access = getDiscordProjectAccess"));
});

test("new replication peers enforce participant identity and current membership", async () => {
  const server = await read("../src/server.js");
  const peerStore = await read("../src/collaboration/peer-store.js");
  const syncEngine = await read("../src/collaboration/sync-engine.js");
  assert.ok(server.includes("peerAuthorization?.requireParticipant"));
  assert.ok(server.includes("participantAccess = getDiscordProjectAccess"));
  assert.ok(server.includes("code: \"REJECTED_AUTHORIZATION\""));
  assert.ok(peerStore.includes("require_participant INTEGER NOT NULL DEFAULT 1"));
  assert.ok(syncEngine.includes("crdt_sync_rejections"));
  assert.ok(syncEngine.includes("previousRejection"));
  assert.ok(syncEngine.includes("rejectedAuthorization"));
});
