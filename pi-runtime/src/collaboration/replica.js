/**
 * Stable local replica identity, distinct from the human/agent actor identity.
 * The caller is responsible for persisting installationId in local durable
 * storage and for keeping it stable across restarts of the same installation.
 */
import { randomUUID } from "node:crypto";

const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

export function createInstallationIdentity(existingId = null) {
  if (existingId !== null && !nonEmpty(existingId)) {
    throw new TypeError("L'identifiant d'installation existant est invalide.");
  }
  return Object.freeze({
    replicaId: existingId || randomUUID(),
    scope: "installation"
  });
}

export function createActorIdentity(type, id, label = null) {
  if (!nonEmpty(type) || !nonEmpty(id)) throw new TypeError("L'identité de l'acteur est incomplète.");
  return Object.freeze({
    type,
    id,
    ...(nonEmpty(label) ? { label } : {})
  });
}

export function createReplicaDot(replicaIdentity, counter) {
  if (!replicaIdentity || replicaIdentity.scope !== "installation" ||
      !nonEmpty(replicaIdentity.replicaId) || !Number.isSafeInteger(counter) || counter < 1) {
    throw new TypeError("Identité de réplique ou compteur invalide.");
  }
  return { replicaId: replicaIdentity.replicaId, counter };
}
