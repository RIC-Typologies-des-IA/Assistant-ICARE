/**
 * Portable collaboration primitives.
 *
 * This module deliberately has no dependency on Discord, SQLite, a network
 * transport, or a CRDT implementation. It defines the stable project
 * identity, manifest and event envelope shared by future adapters.
 */
import { randomUUID } from "node:crypto";

export const PROJECT_MANIFEST_TYPE = "org.ric.icare.project";
export const PROJECT_MANIFEST_VERSION = 1;
export const PROJECT_EVENT_VERSION = 1;
export const DIMENSION_ORDER = Object.freeze(["I", "C", "A", "R", "E"]);

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmptyString = value => typeof value === "string" && value.trim().length > 0;

export function createProjectUri(projectId) {
  if (!nonEmptyString(projectId)) throw new TypeError("Un identifiant de projet est requis.");
  return `icare://project/${encodeURIComponent(projectId)}`;
}

export function parseProjectUri(uri) {
  if (!nonEmptyString(uri)) throw new TypeError("URI de projet invalide.");
  const match = /^icare:\/\/project\/([^/?#]+)$/.exec(uri);
  if (!match) throw new TypeError("L'URI doit suivre le format icare://project/<identifiant>.");
  let projectId;
  try { projectId = decodeURIComponent(match[1]); }
  catch { throw new TypeError("Identifiant encodé invalide dans l'URI du projet."); }
  if (!nonEmptyString(projectId) || projectId.includes("/")) throw new TypeError("Identifiant de projet invalide.");
  return projectId;
}

export function createProjectManifest(project, options = {}) {
  if (!isRecord(project) || !nonEmptyString(project.id) || !nonEmptyString(project.name)) {
    throw new TypeError("Le projet doit posséder un identifiant et un nom.");
  }
  const createdAt = project.created_at || project.createdAt || options.createdAt || new Date().toISOString();
  const updatedAt = project.updated_at || project.updatedAt || createdAt;
  const context = options.context ?? project.context ?? {};
  if (!isRecord(context)) throw new TypeError("Le contexte initial doit être un objet JSON.");
  return {
    type: PROJECT_MANIFEST_TYPE,
    version: PROJECT_MANIFEST_VERSION,
    projectId: project.id,
    uri: createProjectUri(project.id),
    name: project.name,
    description: String(options.description ?? project.description ?? ""),
    intention: String(options.intention ?? project.intention ?? ""),
    context: structuredClone(context),
    createdAt,
    updatedAt,
    dimensions: [...DIMENSION_ORDER],
    collaboration: {
      mode: options.collaboration?.mode || "local-first",
      ...(options.collaboration?.channel ? { channel: options.collaboration.channel } : {})
    }
  };
}

export function validateProjectManifest(manifest) {
  const errors = [];
  if (!isRecord(manifest)) return { valid: false, errors: ["Le manifeste doit être un objet JSON."] };
  if (manifest.type !== PROJECT_MANIFEST_TYPE) errors.push("Type de manifeste ICARE inconnu.");
  if (manifest.version !== PROJECT_MANIFEST_VERSION) errors.push("Version de manifeste non prise en charge.");
  if (!nonEmptyString(manifest.projectId)) errors.push("projectId est requis.");
  if (!nonEmptyString(manifest.uri)) errors.push("uri est requis.");
  else {
    try {
      if (parseProjectUri(manifest.uri) !== manifest.projectId) errors.push("L'URI et projectId ne correspondent pas.");
    } catch (error) { errors.push(error.message); }
  }
  if (!nonEmptyString(manifest.name)) errors.push("name est requis.");
  if (typeof manifest.description !== "string") errors.push("description doit être une chaîne.");
  if (typeof manifest.intention !== "string") errors.push("intention doit être une chaîne.");
  if (!isRecord(manifest.context)) errors.push("context doit être un objet JSON.");
  if (!nonEmptyString(manifest.createdAt)) errors.push("createdAt est requis.");
  if (!nonEmptyString(manifest.updatedAt)) errors.push("updatedAt est requis.");
  if (!Array.isArray(manifest.dimensions) || manifest.dimensions.join(",") !== DIMENSION_ORDER.join(",")) {
    errors.push("Les dimensions doivent être exactement I, C, A, R, E dans cet ordre.");
  }
  if (!isRecord(manifest.collaboration)) errors.push("collaboration doit être un objet.");
  return { valid: errors.length === 0, errors };
}

export function createProjectEvent(input) {
  if (!isRecord(input) || !nonEmptyString(input.projectId) || !nonEmptyString(input.type)) {
    throw new TypeError("Un événement exige projectId et type.");
  }
  if (!isRecord(input.payload ?? {})) throw new TypeError("Le payload d'événement doit être un objet JSON.");
  const actor = input.actor ?? { type: "human", id: "local" };
  if (!isRecord(actor) || !nonEmptyString(actor.type)) throw new TypeError("L'acteur de l'événement est invalide.");
  const causalContext = input.causalContext ?? {};
  if (!isRecord(causalContext)) throw new TypeError("Le contexte causal doit être un objet JSON.");
  return {
    eventId: input.eventId || randomUUID(),
    projectId: input.projectId,
    version: PROJECT_EVENT_VERSION,
    type: input.type,
    actor: structuredClone(actor),
    origin: input.origin || "local",
    occurredAt: input.occurredAt || new Date().toISOString(),
    causalContext: structuredClone(causalContext),
    payload: structuredClone(input.payload ?? {})
  };
}

export function validateProjectEvent(event, expectedProjectId) {
  const errors = [];
  if (!isRecord(event)) return { valid: false, errors: ["L'événement doit être un objet JSON."] };
  for (const key of ["eventId", "projectId", "type", "origin", "occurredAt"]) {
    if (!nonEmptyString(event[key])) errors.push(`${key} est requis.`);
  }
  if (expectedProjectId && event.projectId !== expectedProjectId) errors.push("L'événement appartient à un autre projet.");
  if (event.version !== PROJECT_EVENT_VERSION) errors.push("Version d'événement non prise en charge.");
  if (!isRecord(event.actor) || !nonEmptyString(event.actor.type)) errors.push("actor est invalide.");
  if (!isRecord(event.causalContext)) errors.push("causalContext doit être un objet.");
  if (!isRecord(event.payload)) errors.push("payload doit être un objet.");
  return { valid: errors.length === 0, errors };
}
