import { createLocalCrdtOperation } from "./collaboration/sync-engine.js";
import { getCrdtObjectState } from "./collaboration/operation-store.js";
import {
  getObservedProjectMemberAdds, getProjectMemberAccess, readProjectMembers
} from "./collaboration/project-membership.js";

export function getDiscordProjectAccess(db, projectId, discordUserId) {
  const stored = getCrdtObjectState(db, projectId, "project", projectId);
  return stored ? getProjectMemberAccess(stored.state, "discord", discordUserId) : null;
}

export function listDiscordProjectMembers(db, projectId) {
  const stored = getCrdtObjectState(db, projectId, "project", projectId);
  return stored ? readProjectMembers(stored.state) : [];
}

export function grantDiscordProjectMember(db, {
  projectId, discordUserId, role = "member", actorDiscordUserId
}) {
  const member = { principalType: "discord", principalId: discordUserId, role };
  return createLocalCrdtOperation(db, {
    projectId, objectType: "project", objectId: projectId,
    kind: "project.member.grant", payload: { member },
    actor: { type: "human", id: "discord:" + actorDiscordUserId, participant: { type: "discord", id: actorDiscordUserId } }
  });
}

export function revokeDiscordProjectMember(db, {
  projectId, discordUserId, actorDiscordUserId
}) {
  const stored = getCrdtObjectState(db, projectId, "project", projectId);
  if (!stored) return false;
  const access = getProjectMemberAccess(stored.state, "discord", discordUserId);
  if (!access) return false;
  if (access.roles.includes("owner")) {
    const owners = new Set(readProjectMembers(stored.state)
      .filter(member => member.role === "owner").map(member => member.principalId));
    if (owners.size <= 1) throw new Error("Le dernier propriétaire du projet ne peut pas être révoqué.");
  }
  let revoked = false;
  for (const role of access.roles) {
    const member = { principalType: "discord", principalId: discordUserId, role };
    const observedAdds = getObservedProjectMemberAdds(stored.state, "discord", discordUserId, role);
    if (!observedAdds.length) continue;
    createLocalCrdtOperation(db, {
      projectId, objectType: "project", objectId: projectId,
      kind: "project.member.revoke", payload: { member, observedAdds },
      actor: { type: "human", id: "discord:" + actorDiscordUserId }
    });
    revoked = true;
  }
  return revoked;
}

/**
 * The first explicit channel binder bootstraps ownership only while no owner
 * exists. Discord server-management permission is never mapped to project
 * authority once a project has an owner.
 */
export function bootstrapDiscordProjectOwner(db, projectId, discordUserId) {
  const members = listDiscordProjectMembers(db, projectId);
  if (!members.some(member => member.role === "owner")) {
    grantDiscordProjectMember(db, {
      projectId, discordUserId, role: "owner", actorDiscordUserId: discordUserId
    });
  }
  return getDiscordProjectAccess(db, projectId, discordUserId);
}
