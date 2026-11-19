import {
  addORSet, createORSet, readORSet, removeORSetObserved
} from "./crdt.js";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const dotKey = dot => dot.replicaId + ":" + dot.counter;

export function createProjectMembershipState() {
  return { type: "icare-project-membership-crdt", version: 1, members: createORSet() };
}

export function assertProjectMembershipState(state) {
  if (!isRecord(state) || state.type !== "icare-project-membership-crdt" ||
      state.version !== 1 || !isRecord(state.members) ||
      state.members.type !== "or-set" || state.members.version !== 1 ||
      !Array.isArray(state.members.adds) || !Array.isArray(state.members.removed)) {
    throw new TypeError("État CRDT des membres du projet invalide.");
  }
}

function validateMember(member) {
  if (!isRecord(member) || member.principalType !== "discord" ||
      typeof member.principalId !== "string" || !member.principalId.trim() ||
      !["owner", "member"].includes(member.role)) {
    throw new TypeError("Membre de projet invalide.");
  }
}

export function grantProjectMember(state, member, dot) {
  assertProjectMembershipState(state);
  validateMember(member);
  return { ...state, members: addORSet(state.members, member, dot) };
}

export function revokeProjectMember(state, member, observedAdds) {
  assertProjectMembershipState(state);
  validateMember(member);
  return {
    ...state,
    members: removeORSetObserved(state.members, member, observedAdds)
  };
}

export function readProjectMembers(state) {
  assertProjectMembershipState(state);
  return readORSet(state.members).sort((a, b) =>
    (a.principalType + ":" + a.principalId + ":" + a.role)
      .localeCompare(b.principalType + ":" + b.principalId + ":" + b.role));
}

export function getProjectMemberAccess(state, principalType, principalId) {
  const matches = readProjectMembers(state).filter(member =>
    member.principalType === principalType && member.principalId === principalId);
  if (!matches.length) return null;
  const roles = [...new Set(matches.map(member => member.role))];
  return {
    principalType, principalId,
    role: roles.length === 1 ? roles[0] : "member",
    roles, roleConflict: roles.length > 1
  };
}

export function getObservedProjectMemberAdds(state, principalType, principalId, role = null) {
  assertProjectMembershipState(state);
  const removed = new Set(state.members.removed.map(dotKey));
  return state.members.adds
    .filter(add => !removed.has(dotKey(add.dot)) &&
      add.value.principalType === principalType &&
      add.value.principalId === principalId &&
      (role === null || add.value.role === role))
    .map(add => ({ dot: structuredClone(add.dot), value: structuredClone(add.value) }));
}
