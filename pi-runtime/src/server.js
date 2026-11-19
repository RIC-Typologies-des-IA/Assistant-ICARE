import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createProjectEvent, createProjectManifest, validateProjectEvent, validateProjectManifest } from "./collaboration/project.js";
import { getLocalReplicaIdentity, initializeReplicaStore } from "./collaboration/replica-store.js";
import { applyCrdtOperation, getCrdtObjectState, initializeCrdtOperationStore, listCrdtOperations, validateCrdtOperation } from "./collaboration/operation-store.js";
import { authenticateProjectSyncPeer, createProjectSyncPeer, initializeProjectPeerStore, listProjectSyncPeers, revokeProjectSyncPeer } from "./collaboration/peer-store.js";
import { parseSyncPeerConfig, startSyncScheduler } from "./collaboration/sync-scheduler.js";
import { readPropositionCrdtState } from "./collaboration/model.js";
import { backfillCrdtProjections, projectPropositionToCrdt, projectRelationToCrdt, recordCrdtValidationDecision } from "./collaboration/projection-bridge.js";
import { materializeCrdtOperation } from "./collaboration/projection-materializer.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_DIR = path.resolve(process.env.ICARE_DATA_DIR || path.join(ROOT, "data"));
const AGENT_DIR = path.resolve(process.env.PI_CODING_AGENT_DIR || path.join(DATA_DIR, "pi-agent"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
const BASE_URL = (process.env.LEMONADE_BASE_URL || "http://127.0.0.1:13305/v1").replace(/\/$/, "");
const API_KEY = process.env.LEMONADE_API_KEY || "";
const HOST = process.env.ICARE_HOST || "127.0.0.1";
const PORT = Number(process.env.ICARE_PORT || 8765);
const SYNC_ADMIN_TOKEN = process.env.ICARE_SYNC_ADMIN_TOKEN || "";
// L'ontologie JSON est la source de vérité des dimensions et des catégories.
const ONTOLOGY = JSON.parse(await readFile(path.join(ROOT, "reference", "icare.json"), "utf8"));
const DIMENSION_ORDER = ["I", "C", "A", "R", "E"];
const DIMENSIONS = Object.fromEntries(
  DIMENSION_ORDER.map(code => [code, ONTOLOGY.dimensions[code]])
);
if (DIMENSION_ORDER.some(code => !DIMENSIONS[code]) ||
    Object.keys(ONTOLOGY.dimensions).length !== DIMENSION_ORDER.length) {
  throw new Error("L'ontologie ICARE doit définir exactement les dimensions I, C, A, R et E.");
}
const TEMPORAL = ONTOLOGY.temporal;
const EVALUATION = ONTOLOGY.evaluation;
const EPISTEMIC = ONTOLOGY.epistemic;
const PRACTICAL = ONTOLOGY.practical;
const EXPLORATION = ONTOLOGY.exploration_status;

await mkdir(DATA_DIR, { recursive: true });
await mkdir(AGENT_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "icare.sqlite"));
// Identité CRDT stable de cette installation, distincte des acteurs humains/agents.
initializeReplicaStore(db);
getLocalReplicaIdentity(db);
initializeCrdtOperationStore(db);
initializeProjectPeerStore(db);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS propositions (
    id TEXT PRIMARY KEY, text TEXT NOT NULL, dimensions TEXT NOT NULL,
    primary_dimension TEXT NOT NULL, temporal TEXT NOT NULL,
    evaluation TEXT NOT NULL, epistemic TEXT NOT NULL, practical TEXT NOT NULL,
    confidence REAL NOT NULL, source TEXT NOT NULL, aspect TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'candidate', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dimensions (
    code TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'unexplored',
    justification TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reference_docs (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
    relation TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    review_status TEXT NOT NULL DEFAULT 'candidate', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);
// Migrations additives : les bases déjà créées sont mises à niveau sans perte d'historique.
const propositionColumns = new Set(db.prepare("PRAGMA table_info(propositions)").all().map(column => column.name));
for (const [name, type] of [
  ["utterance_time", "TEXT"], ["valid_time_start", "TEXT"], ["valid_time_end", "TEXT"],
  ["event_period_start", "TEXT"], ["event_period_end", "TEXT"], ["target_horizon", "TEXT"],
  ["realization_time", "TEXT"], ["modality", "TEXT"], ["subject", "TEXT"], ["predicate", "TEXT"], ["value", "TEXT"], ["author", "TEXT"],
  ["source_agent", "TEXT"], ["source_interaction", "TEXT"], ["justification", "TEXT"]
]) {
  if (!propositionColumns.has(name)) db.exec(`ALTER TABLE propositions ADD COLUMN ${name} ${type}`);
}

const now = () => new Date().toISOString();
const getSetting = key => db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value || null;
const setSetting = (key, value) => db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, String(value), now());
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, archived_at TEXT,
    description TEXT NOT NULL DEFAULT '', intention TEXT NOT NULL DEFAULT '',
    context_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS project_events (
    event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, event_type TEXT NOT NULL,
    event_version INTEGER NOT NULL, actor_json TEXT NOT NULL, origin TEXT NOT NULL,
    occurred_at TEXT NOT NULL, causal_context_json TEXT NOT NULL, payload_json TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_events_order ON project_events(project_id, occurred_at, event_id);
  CREATE TABLE IF NOT EXISTS project_creation_requests (
    request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_dimensions (
    project_id TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unexplored',
    justification TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, code)
  );
  CREATE TABLE IF NOT EXISTS conversation_turns (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL, user_text TEXT NOT NULL, assistant_text TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(project_id, session_id, turn_index)
  );
  CREATE TABLE IF NOT EXISTS exploration_snapshots (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL, dimensions_json TEXT NOT NULL,
    propositions_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
`);
const projectMetadataColumns = new Set(db.prepare("PRAGMA table_info(projects)").all().map(column => column.name));
for (const [name, type] of [
  ["description", "TEXT NOT NULL DEFAULT ''"],
  ["intention", "TEXT NOT NULL DEFAULT ''"],
  ["context_json", "TEXT NOT NULL DEFAULT '{}'"]
]) {
  if (!projectMetadataColumns.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${type}`);
}
const projectColumns = {
  propositions: new Set(db.prepare("PRAGMA table_info(propositions)").all().map(column => column.name)),
  relations: new Set(db.prepare("PRAGMA table_info(relations)").all().map(column => column.name)),
  reference_docs: new Set(db.prepare("PRAGMA table_info(reference_docs)").all().map(column => column.name))
};
for (const table of Object.keys(projectColumns)) {
  if (!projectColumns[table].has("project_id")) db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT`);
}
db.prepare("INSERT OR IGNORE INTO projects(id,name,created_at,updated_at) VALUES('legacy','Mon premier projet',?,?)").run(now(), now());
const legacyProject = db.prepare("SELECT name FROM projects WHERE id='legacy'").get();
const activeProjectCount = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE archived_at IS NULL").get().n;
if (activeProjectCount === 1 && legacyProject?.name === "Projet existant") {
  db.prepare("UPDATE projects SET name='Mon premier projet',updated_at=? WHERE id='legacy'").run(now());
}
for (const table of ["propositions", "relations", "reference_docs"]) {
  db.exec(`UPDATE ${table} SET project_id='legacy' WHERE project_id IS NULL`);
}
const insertProjectDimension = db.prepare("INSERT OR IGNORE INTO project_dimensions(project_id,code,status,justification,updated_at) VALUES(?,?,?,?,?)");
for (const code of DIMENSION_ORDER) {
  const legacy = db.prepare("SELECT status,justification,updated_at FROM dimensions WHERE code=?").get(code);
  insertProjectDimension.run("legacy", code, legacy?.status || "unexplored", legacy?.justification || "", legacy?.updated_at || now());
}


const seedDoc = db.prepare("INSERT OR IGNORE INTO reference_docs(id,title,content,created_at,project_id) VALUES(?,?,?,?,?)");
for (const [id, title, filename] of [
  ["guide-icare", "Guide de la démarche ICARE", "guide-icare.md"],
  ["ontology-icare", "Ontologie ICARE (JSON)", "icare.json"]
]) {
  const file = path.join(HERE, "..", "reference", filename);
  if (existsSync(file)) seedDoc.run(id, title, await readFile(file, "utf8"), now(), "legacy");
}

if (db.prepare("SELECT COUNT(*) AS n FROM exploration_snapshots WHERE project_id='legacy'").get().n === 0) recordSnapshot("legacy", "migration", 0);

const SYSTEM_PROMPT = `Tu es ICARE, un agent méthodologique maïeutique. Tu aides un humain à comprendre et décrire un système par un dialogue ouvert, non linéaire et progressif.

ONTOLOGIE STRUCTURÉE DE RÉFÉRENCE
Le fichier reference/icare.json est la source de vérité. Voici son contenu complet :
${JSON.stringify(ONTOLOGY, null, 2)}
Respecte ses catégories et ses distinctions. En cas de doute, consulte l'outil get_ontology.

RÉFÉRENTIEL ICARE — les cinq dimensions restent toujours présentes dans ton analyse :
I — Intention / finalité
C — Contexte / situation
A — Action / opération
R — Régulation / organisation (une seule dimension combinée)
E — Évolution / temporalité

RÈGLES DE DIALOGUE
- Tu n'appliques jamais un questionnaire rigide et tu ne déroules pas systématiquement I puis C puis A puis R puis E.
- Tu choisis la question suivante selon ce qui manque réellement à la compréhension, les ambiguïtés, les tensions, les relations et les transformations.
- Tu gardes les cinq dimensions comme grille de vigilance, même quand la conversation approfondit une seule d'entre elles.
- Une proposition peut relever de plusieurs dimensions. N'impose pas une classification exclusive.
- ICARE est la couche descriptive : les couches temporelle, évaluative/modale, épistémique/provenance, pratique et relationnelle la complètent sans créer de nouvelles dimensions.
- Pour chaque proposition, distingue si possible le temps d'énonciation, la période de validité, la période d'un événement, l'horizon cible et le temps de réalisation. Laisse les champs inconnus vides ; n'invente jamais de date.
- Si cela clarifie l'information, structure la proposition autour d'un sujet, d'une propriété/predicat et d'une valeur, sans perdre le texte fidèle à la source.
- Distingue les évaluations (souhaité, non souhaité, redouté, préférable, défavorable) des modalités (possible, impossible, nécessaire, permis, interdit).
- Distingue constaté/affirmé, rapporté, inféré, hypothétique et prévisionnel ; conserve la source et le contexte d'origine. La confiance d'extraction n'est pas la certitude de la source.
- Distingue toujours le passé, le présent, le futur souhaité, les hypothèses, les décisions, les engagements et les réalisations.
- Souhaité ne signifie pas décidé ; décidé ne signifie pas engagé ; engagé ne signifie pas réalisé.
- Une évolution temporelle n'est pas automatiquement une contradiction.
- Conserve les points de vue divergents et leurs sources. Ne tranche pas sans preuve.
- Une information absente n'est pas « non applicable ».
- Tu proposes des interprétations avec prudence et expliques brièvement les incertitudes.
- N'invente jamais de faits, d'acteurs, de relations ou de décisions.
- Tu consultes l'ontologie structurée et l'état d'exploration avec les outils fournis lorsque cela aide à qualifier une information.
- CONSIGNE D'ALIMENTATION DU TABLEAU DE BORD : à chaque tour où l'utilisateur apporte une information nouvelle et substantielle sur le système, identifie les observations qui méritent d'être conservées et appelle propose_observation pour les enregistrer comme candidates. N'attends pas que l'utilisateur demande explicitement un enregistrement.
- Regroupe les éléments cohérents en propositions lisibles, attribue toutes les dimensions pertinentes (une proposition peut relever de plusieurs dimensions), précise temporalité, statut épistémique et statut pratique selon l'ontologie. N'invente aucune information manquante.
- Avant de proposer, vérifie si une proposition existante couvre déjà le même élément afin d'éviter les doublons ; préfère nuancer ou compléter dans le dialogue plutôt que multiplier les répétitions.
- Lorsque deux propositions existantes entretiennent un lien sémantique important (confirmation, précision, évolution d'état, contradiction sur une même période, dépendance, etc.), utilise propose_relation avec leurs identifiants issus de list_propositions. Les relations restent candidates et doivent être justifiées ; ne confonds pas évolution temporelle et contradiction.
- En cas d'incertitude de classement, conserve l'incertitude et explique-la brièvement ; ne force pas une dimension.
- Les outils mettent à jour les compteurs et la liste des propositions candidates visibles dans le panneau latéral. Explique naturellement à l'utilisateur qu'une proposition attend sa validation lorsqu'il est pertinent de le signaler.
- Tu peux enregistrer une proposition comme candidate à validation humaine, jamais comme un fait validé.
- RÈGLE DE VÉRACITÉ ABSOLUE : tu ne dis jamais « enregistré », « ajouté », « créé » ou « proposition candidate » au sens d'une action accomplie tant que l'outil correspondant n'a pas effectivement été appelé et n'a pas confirmé son succès. Une reformulation dans le chat n'est pas un enregistrement.
- Après chaque appel à propose_observation, vérifie que l'outil a renvoyé un identifiant. Si aucun identifiant n'est retourné, indique explicitement que l'enregistrement a échoué.
- Les propositions candidates sont des objets persistés dans le registre SQLite et visibles dans le panneau latéral ; ne prétends jamais que le seul texte de ta réponse les a créées.
- Tu ne modifies jamais le statut d'exploration d'une dimension : l'utilisateur seul décide si elle est insuffisamment documentée, suffisamment explorée ou non applicable, et justifie les deux derniers statuts.
- Le corpus documentaire est une référence méthodologique, pas une source de faits sur le système discuté.
- Tu n'as aucun outil de navigation Web, de shell, de fichiers arbitraires ou de réseau externe. Ne prétends pas avoir effectué une recherche Web.

STYLE
- Dialogue en français, naturel, clair et précis.
- Pose généralement une seule question utile à la fois.
- Reformule pour vérifier la compréhension sans enfermer la personne dans tes mots.
- Quand une information importante est explicitée, tu peux proposer de l'enregistrer comme proposition à valider.`;

let piModules;
let modelRuntime;
let selectedModel;
let catalogModels = [];
let catalogVoiceModels = [];
let voiceModel = null;
const sessions = new Map();
const sessionBusy = new Set();
const ICARE_TOOL_NAMES = ["list_available_models", "get_ontology", "get_exploration_state", "search_reference_documents", "list_propositions", "propose_observation", "propose_relation"];
let activeIcareTools = [];
let toolInitializationStatus = "pending";
let toolInitializationError = null;

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Requête trop volumineuse.");
  }
  return raw ? JSON.parse(raw) : {};
}
function bearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  return match?.[1] || null;
}
function secretMatches(provided, expected) {
  if (!provided || !expected) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
function requireSyncAdmin(req, res) {
  if (SYNC_ADMIN_TOKEN.length < 32) {
    json(res, 503, { error: "La gestion des pairs est désactivée : configure ICARE_SYNC_ADMIN_TOKEN (32 caractères minimum)." });
    return false;
  }
  if (!secretMatches(bearerToken(req), SYNC_ADMIN_TOKEN)) {
    json(res, 401, { error: "Authentification administrateur requise." });
    return false;
  }
  return true;
}
function authorizeSyncPeer(req, res, projectId, permission) {
  const peer = authenticateProjectSyncPeer(db, projectId, bearerToken(req), permission);
  if (!peer) {
    json(res, 401, { error: "Jeton de réplication invalide, révoqué ou insuffisant." });
    return null;
  }
  return peer;
}
function requireProject(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id=? AND archived_at IS NULL").get(projectId);
  if (!project) throw new Error("Projet introuvable ou archivé.");
  return project;
}

function getProjectManifest(projectId) {
  const project = requireProject(projectId);
  const manifest = createProjectManifest(project, {
    description: project.description,
    intention: project.intention,
    context: JSON.parse(project.context_json || "{}"),
    collaboration: { mode: "local-first" }
  });
  const validation = validateProjectManifest(manifest);
  if (!validation.valid) throw new Error("Manifeste de projet invalide : " + validation.errors.join(" "));
  return manifest;
}

function persistProjectEvent(event) {
  const validation = validateProjectEvent(event, event.projectId);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const existing = db.prepare("SELECT project_id,event_type,event_version,actor_json,origin,occurred_at,causal_context_json,payload_json FROM project_events WHERE event_id=?").get(event.eventId);
  if (existing) {
    const same = existing.project_id === event.projectId && existing.event_type === event.type &&
      existing.event_version === event.version &&
      existing.actor_json === JSON.stringify(event.actor) &&
      existing.origin === event.origin &&
      existing.occurred_at === event.occurredAt &&
      existing.causal_context_json === JSON.stringify(event.causalContext) &&
      existing.payload_json === JSON.stringify(event.payload);
    if (!same) throw new Error("Collision : cet eventId existe déjà avec un contenu différent.");
    return { inserted: false, event };
  }
  db.prepare(`INSERT INTO project_events
    (event_id,project_id,event_type,event_version,actor_json,origin,occurred_at,causal_context_json,payload_json,received_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      event.eventId, event.projectId, event.type, event.version, JSON.stringify(event.actor),
      event.origin, event.occurredAt, JSON.stringify(event.causalContext), JSON.stringify(event.payload), now()
    );
  return { inserted: true, event };
}
function getState(projectId = "legacy") {
  const rows = db.prepare("SELECT * FROM project_dimensions WHERE project_id=?").all(projectId)
    .sort((a, b) => DIMENSION_ORDER.indexOf(a.code) - DIMENSION_ORDER.indexOf(b.code));
  const counts = db.prepare("SELECT dimensions, review_status FROM propositions WHERE project_id=?").all(projectId);
  return rows.map(row => {
    const related = counts.filter(p => JSON.parse(p.dimensions).includes(row.code));
    return { ...row, label: DIMENSIONS[row.code], candidates: related.filter(p => p.review_status === "candidate").length,
      accepted: related.filter(p => p.review_status === "accepted").length,
      rejected: related.filter(p => p.review_status === "rejected").length };
  });
}
function activeCrdtDecisions(decisions) {
  const superseded = new Set(decisions.flatMap(decision =>
    Array.isArray(decision.resolves) ? decision.resolves : []));
  return decisions.filter(decision => !superseded.has(decision.id));
}
function getActiveCrdtDecisions(projectId, objectId, targetType, targetId = objectId) {
  const stored = getCrdtObjectState(db, projectId, "proposition", objectId);
  if (!stored) return [];
  const decisions = readPropositionCrdtState(stored.state).validationDecisions.filter(decision =>
    decision.targetType === targetType && decision.targetId === targetId);
  return activeCrdtDecisions(decisions);
}
function getPropositions(projectId = "legacy") {
  return db.prepare("SELECT * FROM propositions WHERE project_id=? ORDER BY created_at DESC").all(projectId)
    .map(p => {
      const crdt = getCrdtObjectState(db, projectId, "proposition", p.id);
      const crdtState = crdt ? readPropositionCrdtState(crdt.state) : null;
      const allDecisions = crdtState?.validationDecisions || [];
      const decisions = allDecisions.filter(decision =>
        (decision.targetType === "proposition" || !decision.targetType) &&
        (decision.targetId === p.id || !decision.targetId));
      const activeDecisions = activeCrdtDecisions(decisions);
      const decisionStatuses = new Set(activeDecisions.map(decision => decision.status));
      const conflicts = crdtState
        ? {
            ...Object.fromEntries(Object.entries(crdtState.fields).filter(([, values]) => values.length > 1)),
            ...(crdtState.legacyReviewStatus.length > 1 ? { legacyReviewStatus: crdtState.legacyReviewStatus } : {})
          }
        : {};
      return { ...p, dimensions: JSON.parse(p.dimensions),
        crdt_decisions: decisions, crdt_active_decisions: activeDecisions, crdt_conflicts: conflicts,
        crdt_decision_conflict: decisionStatuses.has("accepted") && decisionStatuses.has("rejected") };
    });
}
function getRelations(projectId = "legacy") {
  return db.prepare("SELECT * FROM relations WHERE project_id=? ORDER BY created_at DESC LIMIT 200").all(projectId)
    .map(relation => {
      const crdt = getCrdtObjectState(db, projectId, "proposition", relation.from_id);
      const decisions = crdt ? readPropositionCrdtState(crdt.state).validationDecisions
        .filter(decision => decision.targetType === "relation" && decision.targetId === relation.id) : [];
      const activeDecisions = activeCrdtDecisions(decisions);
      const statuses = new Set(activeDecisions.map(decision => decision.status));
      return { ...relation, crdt_decisions: decisions, crdt_active_decisions: activeDecisions,
        crdt_decision_conflict: statuses.has("accepted") && statuses.has("rejected") };
    });
}
function recordSnapshot(projectId, sessionId = "manual", turnIndex = 0) {
  const id = randomUUID();
  db.prepare("INSERT INTO exploration_snapshots(id,project_id,session_id,turn_index,dimensions_json,propositions_json,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, projectId, sessionId, turnIndex, JSON.stringify(getState(projectId)), JSON.stringify(getPropositions(projectId)), now());
  db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(now(), projectId);
  return id;
}
function searchDocs(query, projectId = "legacy") {
  const terms = String(query || "").toLowerCase().split(/\W+/).filter(t => t.length > 2);
  const docs = db.prepare("SELECT id,title,content FROM reference_docs WHERE project_id=?").all(projectId);
  return docs.map(doc => {
    const lower = doc.content.toLowerCase();
    const score = terms.reduce((n, term) => n + (lower.split(term).length - 1), 0);
    return { id: doc.id, title: doc.title, score, excerpt: doc.content.slice(0, 2400) };
  }).filter(d => d.score > 0 || terms.length === 0).sort((a,b) => b.score-a.score).slice(0,4);
}
function recordCandidate(input, projectId = "legacy") {
  const dimensions = [...new Set((input.dimensions || []).filter(d => Object.hasOwn(DIMENSIONS, d)))];
  if (!dimensions.length) throw new Error("Au moins une dimension ICARE valide est requise.");
  const primary = dimensions.includes(input.primary_dimension) ? input.primary_dimension : dimensions[0];
  const temporal = TEMPORAL.includes(input.temporal) ? input.temporal : "unknown";
  const evaluation = EVALUATION.includes(input.evaluation) ? input.evaluation : "unknown";
  const epistemic = EPISTEMIC.includes(input.epistemic) ? input.epistemic : "reported";
  const practical = PRACTICAL.includes(input.practical) ? input.practical : "unspecified";
  const rawConfidence = Number(input.confidence ?? 0.5);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0.5;
  const observationText = String(input.text || "").trim().slice(0,4000);
  if (!observationText) throw new Error("Le texte de l'observation ne peut pas être vide.");
  const id = randomUUID();
  const modality = ONTOLOGY.modality.includes(input.modality) ? input.modality : "unknown";
  const optionalText = key => input[key] == null || input[key] === "" ? null : String(input[key]).slice(0, 500);
  db.prepare(`INSERT INTO propositions
    (id,text,dimensions,primary_dimension,temporal,evaluation,epistemic,practical,confidence,source,aspect,review_status,created_at,
     utterance_time,valid_time_start,valid_time_end,event_period_start,event_period_end,target_horizon,realization_time,modality,
     subject,predicate,value,author,source_agent,source_interaction,justification,project_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, observationText, JSON.stringify(dimensions), primary,
      temporal, evaluation, epistemic, practical, confidence, String(input.source || "conversation").slice(0,300),
      String(input.aspect || "").slice(0,300), "candidate", now(),
      optionalText("utterance_time"), optionalText("valid_time_start"), optionalText("valid_time_end"),
      optionalText("event_period_start"), optionalText("event_period_end"), optionalText("target_horizon"),
      optionalText("realization_time"), modality, optionalText("subject"), optionalText("predicate"), optionalText("value"),
      optionalText("author"), optionalText("source_agent"), optionalText("source_interaction"), optionalText("justification"), projectId
    );
  const proposal = db.prepare("SELECT * FROM propositions WHERE id=? AND project_id=?").get(id, projectId);
  const actor = input.source === "user"
    ? { type: "human", id: "local-user" }
    : { type: "agent", id: String(input.source_agent || "icare-agent") };
  try {
    projectPropositionToCrdt(db, proposal, actor);
  } catch (error) {
    db.prepare("DELETE FROM propositions WHERE id=? AND project_id=?").run(id, projectId);
    throw error;
  }
  return proposal;
}
function recordRelationCandidate(input, projectId = "legacy") {
  const allowed = new Set(ONTOLOGY.relations);
  const relation = String(input.relation || "");
  if (!allowed.has(relation)) throw new Error("Relation inconnue dans l'ontologie complémentaire.");
  const fromId = String(input.from_id || "");
  const toId = String(input.to_id || "");
  if (!fromId || !toId || fromId === toId) throw new Error("Deux identifiants de propositions distincts sont requis.");
  const exists = db.prepare("SELECT id FROM propositions WHERE id IN (?,?) AND project_id=?").all(fromId, toId, projectId);
  if (exists.length !== 2) throw new Error("Les deux propositions doivent exister.");
  const id = randomUUID();
  const note = String(input.note || "").slice(0,1000);
  db.prepare("INSERT INTO relations(id,from_id,to_id,relation,note,review_status,created_at,project_id) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, fromId, toId, relation, note, "candidate", now(), projectId);
  try {
    projectRelationToCrdt(db, {
      id, project_id: projectId, from_id: fromId, to_id: toId,
      relation, note, review_status: "candidate"
    }, { type: "agent", id: "icare-agent" });
  } catch (error) {
    db.prepare("DELETE FROM relations WHERE id=? AND project_id=?").run(id, projectId);
    throw error;
  }
  return { id, from_id: fromId, to_id: toId, relation, review_status: "candidate" };
}

async function refreshModelCatalog() {
  const response = await fetch(BASE_URL + "/models?show_all=true", { headers: API_KEY ? { Authorization: "Bearer " + API_KEY } : {} });
  if (!response.ok) throw new Error("Impossible de lire le catalogue Lemonade (HTTP " + response.status + ").");
  const payload = await response.json();
  const allModels = payload.data || [];
  const models = allModels.filter(m => m.labels?.includes("chat"));
  catalogVoiceModels = allModels.filter(m => m.labels?.includes("transcription"));
  if (!models.length) throw new Error("Le catalogue Lemonade ne contient aucun modèle de conversation.");
  const availableModels = models.filter(m => m.downloaded === true);
  if (!availableModels.length) throw new Error("Aucun modèle de conversation n’est téléchargé dans Lemonade. Installe un modèle puis actualise le catalogue.");
  const modelConfigs = availableModels.map(m => ({ id: m.id, name: m.name || m.id, api: "openai-completions", reasoning: Boolean(m.labels?.includes("reasoning")), input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: Number(m.context_length || m.max_context_window || 32768), maxTokens: Number(m.max_output_tokens || m.max_completion_tokens || 4096) }));
  const provider = { name: "Lemonade local", baseUrl: BASE_URL, api: "openai-completions", models: modelConfigs };
  provider.apiKey = "$LEMONADE_API_KEY"; provider.authHeader = true;
  await writeFile(path.join(AGENT_DIR, "models.json"), JSON.stringify({ providers: { lemonade: provider } }, null, 2));
  const nextRuntime = await piModules.ModelRuntime.create();
  const currentId = selectedModel?.id || getSetting("chat_model") || process.env.ICARE_MODEL;
  const choice = availableModels.find(m => m.id === currentId) || availableModels.find(m => m.labels?.includes("tool-calling")) || availableModels[0];
  const nextModel = nextRuntime.getModel("lemonade", choice.id);
  if (!nextModel) throw new Error("Pi n'a pas pu charger le modèle Lemonade « " + choice.id + " ».");
  modelRuntime = nextRuntime; selectedModel = nextModel; catalogModels = models;
  setSetting("chat_model", selectedModel.id);
  const availableVoiceModels = catalogVoiceModels.filter(m => m.downloaded === true);
  const preferredVoiceId = getSetting("voice_model");
  const voiceChoice = availableVoiceModels.find(m => m.id === preferredVoiceId)
    || availableVoiceModels.find(m => /whisper/i.test(m.id))
    || availableVoiceModels[0];
  voiceModel = voiceChoice || null;
  if (voiceModel) setSetting("voice_model", voiceModel.id);
  return models;
}

async function initializePi() {
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { Type } = await import("typebox");
  piModules = { createAgentSession, SessionManager, DefaultResourceLoader, ModelRuntime, Type };
  process.env.LEMONADE_API_KEY = API_KEY || "local";
  await refreshModelCatalog();
  if (process.env.ICARE_MODEL && !catalogModels.some(m => m.id === process.env.ICARE_MODEL && m.downloaded === true)) throw new Error("Le modèle ICARE_MODEL demandé est absent du catalogue ou n’est pas téléchargé dans Lemonade.");
  const chosen = catalogModels.find(m => m.id === selectedModel.id);
  if (!chosen?.labels?.includes("tool-calling")) console.warn("[ICARE] Le modèle choisi n'est pas signalé comme compatible tool-calling.");
  const extensionFactory = (pi, projectId = "legacy") => {
    pi.registerTool({
      name: "list_available_models",
      exposure: "direct",
      label: "Catalogue des modèles Lemonade",
      description: "Consulte les modèles de conversation Lemonade, leurs capacités et leur disponibilité. Ne change pas le modèle actif.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(catalogModels.map(m => ({ id: m.id, name: m.name || m.id, labels: m.labels || [], downloaded: m.downloaded !== false, context_length: m.context_length || m.max_context_window || null, suggested: Boolean(m.suggested) })), null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "get_ontology",
      exposure: "direct",
      label: "Ontologie ICARE",
      description: "Renvoie l'ontologie structurée complète : dimensions ICARE et couches complémentaires des états/temps, de l'évaluation/modalité, de l'épistémique/provenance, des statuts pratiques et des relations historiques.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(ONTOLOGY, null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "get_exploration_state",
      exposure: "direct",
      label: "État d'exploration ICARE",
      description: "Consulte l'état documenté des cinq dimensions ICARE et les volumes de propositions validées ou en attente.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(getState(projectId), null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "search_reference_documents",
      exposure: "direct",
      label: "Rechercher dans les références ICARE",
      description: "Recherche dans le corpus documentaire méthodologique local. N'effectue aucune recherche sur Internet.",
      parameters: Type.Object({ query: Type.String({ description: "Notions à rechercher dans les documents de référence." }) }),
      execute: async (_id, params) => ({ content: [{ type: "text", text: JSON.stringify(searchDocs(params.query, projectId), null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "list_propositions",
      exposure: "direct",
      label: "Consulter les propositions",
      description: "Consulte les propositions ICARE enregistrées, avec leur statut de validation.",
      parameters: Type.Object({ review_status: Type.Optional(Type.String({ description: "candidate, accepted ou rejected" })) }),
      execute: async (_id, params) => {
        const rows = getPropositions(projectId).filter(p => !params.review_status || p.review_status === params.review_status);
        return { content: [{ type: "text", text: JSON.stringify(rows.slice(0,40), null, 2) }], details: {} };
      }
    });
    pi.registerTool({
      name: "propose_observation",
      exposure: "direct",
      label: "Proposer une observation",
      description: "Enregistre une observation comme candidate à validation humaine. N'enregistre jamais directement un fait accepté.",
      parameters: Type.Object({
        text: Type.String({ description: "Énoncé concis de l'observation, fidèle à la source." }),
        dimensions: Type.Array(Type.String(), { description: "Une ou plusieurs dimensions parmi I,C,A,R,E." }),
        primary_dimension: Type.Optional(Type.String()),
        temporal: Type.Optional(Type.String()),
        evaluation: Type.Optional(Type.String()),
        modality: Type.Optional(Type.String()),
        epistemic: Type.Optional(Type.String()),
        practical: Type.Optional(Type.String()),
        confidence: Type.Optional(Type.Number({ description: "Confiance du système dans l'extraction, pas certitude de la source." })),
        source: Type.Optional(Type.String()),
        aspect: Type.Optional(Type.String()),
        subject: Type.Optional(Type.String()),
        predicate: Type.Optional(Type.String()),
        value: Type.Optional(Type.String()),
        utterance_time: Type.Optional(Type.String()),
        valid_time_start: Type.Optional(Type.String()),
        valid_time_end: Type.Optional(Type.String()),
        event_period_start: Type.Optional(Type.String()),
        event_period_end: Type.Optional(Type.String()),
        target_horizon: Type.Optional(Type.String()),
        realization_time: Type.Optional(Type.String()),
        author: Type.Optional(Type.String()),
        source_agent: Type.Optional(Type.String()),
        source_interaction: Type.Optional(Type.String()),
        justification: Type.Optional(Type.String())
      }),
      execute: async (_id, params) => {
        const p = recordCandidate(params, projectId);
        return { content: [{ type: "text", text: `Proposition candidate enregistrée (${p.id}). Elle attend une validation humaine dans le tableau de bord ; elle n'est pas considérée comme un fait validé.` }], details: { id: p.id } };
      }
    });
    pi.registerTool({
      name: "propose_relation",
      exposure: "direct",
      label: "Proposer une relation entre observations",
      description: "Enregistre une relation candidate entre deux propositions existantes. La relation attend une validation humaine et ne modifie jamais les propositions sources.",
      parameters: Type.Object({
        from_id: Type.String({ description: "Identifiant de la proposition source." }),
        to_id: Type.String({ description: "Identifiant de la proposition cible." }),
        relation: Type.String({ description: "Type de relation défini dans l'ontologie complémentaire." }),
        note: Type.Optional(Type.String({ description: "Justification concise de la relation." }))
      }),
      execute: async (_id, params) => {
        const relation = recordRelationCandidate(params, projectId);
        return { content: [{ type: "text", text: `Relation candidate enregistrée (${relation.id}) ; elle attend une validation humaine.` }], details: relation };
      }
    });
    // Les outils "direct" sont activés par défaut lors de leur enregistrement.
    // Ne pas appeler pi.setActiveTools ici : l'extension est encore en phase de chargement
    // et le runtime n'a pas encore lié les méthodes d'action de l'API.
    console.log("[ICARE] Définitions des outils ICARE enregistrées.");
  };
  piModules.registerTools = extensionFactory;
  return { modelId: selectedModel.id, modelName: chosen?.name || selectedModel.id };
}
async function getSession(id, projectId = "legacy") {
  const sessionKey = projectId + ":" + id;
  requireProject(projectId);
  if (sessions.has(sessionKey)) return sessions.get(sessionKey);
  const { createAgentSession, SessionManager } = piModules;
  const resourceLoader = new piModules.DefaultResourceLoader({
    cwd: ROOT, agentDir: AGENT_DIR,
    systemPromptOverride: () => SYSTEM_PROMPT,
    appendSystemPromptOverride: () => {
      const turns = db.prepare("SELECT user_text,assistant_text FROM conversation_turns WHERE project_id=? ORDER BY turn_index").all(projectId);
      if (!turns.length) return [];
      const nl = String.fromCharCode(10);
      return ["HISTORIQUE DU PROJET — les échanges ci-dessous appartiennent à ce projet et servent de contexte de reprise :" + nl + turns.map((turn, index) => "Échange " + (index + 1) + nl + "Utilisateur : " + turn.user_text + nl + "ICARE : " + turn.assistant_text).join(nl + nl)];
    },
    
    extensionFactories: [pi => piModules.registerTools(pi, projectId)]
  });
  try {
    await resourceLoader.reload();
    const created = await createAgentSession({
      model: selectedModel, modelRuntime, resourceLoader, noTools: "builtin",
      sessionManager: SessionManager.create(ROOT)
    });
    // Lie le runtime des extensions à la session : cette étape déclenche session_start
    // et rend les outils enregistrés par la factory disponibles dans la session.
    await created.session.bindExtensions({});
    // noTools désactive la sélection initiale ; active ensuite les seuls outils ICARE.
    created.session.setActiveToolsByName(ICARE_TOOL_NAMES);
    const activeTools = created.session.getActiveToolNames();
    const missingTools = ICARE_TOOL_NAMES.filter(name => !activeTools.includes(name));
    if (missingTools.length) {
      created.session.dispose();
      throw new Error("Outils ICARE absents de la session Pi : " + missingTools.join(", "));
    }
    activeIcareTools = ICARE_TOOL_NAMES.filter(name => activeTools.includes(name));
    toolInitializationStatus = "ready";
    toolInitializationError = null;
    console.log("[ICARE] Outils ICARE présents dans la session Pi :", activeIcareTools.join(", "));
    sessions.set(sessionKey, created.session);
    return created.session;
  } catch (error) {
    toolInitializationStatus = "failed";
    toolInitializationError = error.message || String(error);
    console.error("[ICARE] Échec d'initialisation des outils :", toolInitializationError);
    throw error;
  }
}
function sendStatic(res, file, type, cacheControl = "no-store") {
  readFile(file).then(body => {
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff"
    });
    res.end(body);
  }).catch(() => json(res, 404, { error: "Fichier introuvable." }));
}

const PUBLIC_ASSET_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"]
]);

function sendPublicAsset(res, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice("/assets/".length));
  } catch {
    return json(res, 400, { error: "Chemin de ressource invalide." });
  }
  const segments = relativePath.split("/");
  if (!relativePath || relativePath.includes(String.fromCharCode(92)) ||
      segments.some(segment => !segment || segment === "." || segment === "..")) {
    return json(res, 400, { error: "Chemin de ressource invalide." });
  }
  const assetRoot = path.resolve(HERE, "..", "public", "assets");
  const file = path.resolve(assetRoot, relativePath);
  if (!file.startsWith(assetRoot + path.sep)) {
    return json(res, 400, { error: "Chemin de ressource invalide." });
  }
  const type = PUBLIC_ASSET_TYPES.get(path.extname(file).toLowerCase());
  if (!type) return json(res, 404, { error: "Type de ressource non autorisé." });
  return sendStatic(res, file, type, "public, max-age=3600");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + req.headers.host);
  try {
    if (req.method === "GET" && url.pathname === "/") return sendStatic(res, path.join(HERE, "..", "public", "index.html"), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) return sendPublicAsset(res, url.pathname);
    if (req.method === "GET" && url.pathname === "/api/status") {
      const modelInfo = catalogModels.find(m => m.id === selectedModel.id);
      return json(res, 200, {
        ok: true, model: selectedModel.id, provider: "Lemonade via Pi SDK",
        toolCalling: Boolean(modelInfo?.labels?.includes("tool-calling")),
        toolInitialization: toolInitializationStatus,
        toolInitializationError,
        toolDefinitions: [...activeIcareTools],
        dimensionsOrder: DIMENSION_ORDER
      });
    }
    if (req.method === "GET" && url.pathname === "/api/models") return json(res, 200, { models: catalogModels.map(m => ({ id: m.id, name: m.name || m.id, labels: m.labels || [], downloaded: m.downloaded !== false, context_length: m.context_length || m.max_context_window || null, suggested: Boolean(m.suggested) })), selected: selectedModel.id });
    if (req.method === "POST" && url.pathname === "/api/models/refresh") {
      if (sessionBusy.size) return json(res, 409, { error: "Attends la fin des réponses en cours avant d’actualiser le catalogue." });
      await refreshModelCatalog();
      for (const session of sessions.values()) await session.setModel(selectedModel);
      return json(res, 200, { models: catalogModels.map(m => ({ id: m.id, name: m.name || m.id, labels: m.labels || [], downloaded: m.downloaded !== false, context_length: m.context_length || m.max_context_window || null, suggested: Boolean(m.suggested) })), selected: selectedModel.id });
    }
    if (req.method === "GET" && url.pathname === "/api/voice/models") {
      return json(res, 200, {
        models: catalogVoiceModels.map(m => ({ id: m.id, name: m.name || m.id, labels: m.labels || [], downloaded: m.downloaded === true })),
        selected: voiceModel?.id || null
      });
    }
    if (req.method === "POST" && url.pathname === "/api/voice/models/select") {
      const body = await readBody(req);
      const info = catalogVoiceModels.find(m => m.id === body.model && m.downloaded === true);
      if (!info) return json(res, 400, { error: "Modèle vocal inconnu ou non téléchargé. Seuls les modèles de transcription audio sont sélectionnables." });
      voiceModel = info;
      setSetting("voice_model", voiceModel.id);
      return json(res, 200, { ok: true, selected: voiceModel.id });
    }
    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      if (!voiceModel || voiceModel.downloaded !== true) return json(res, 409, { error: "Aucun modèle de transcription vocale téléchargé n'est sélectionné." });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) return json(res, 413, { error: "Enregistrement trop volumineux (limite : 25 Mo)." });
        chunks.push(chunk);
      }
      const audio = Buffer.concat(chunks);
      if (audio.length < 44 || req.headers["content-type"] !== "audio/wav") return json(res, 400, { error: "Un enregistrement WAV valide est requis." });
      const form = new FormData();
      form.append("model", voiceModel.id);
      form.append("language", "fr");
      form.append("response_format", "json");
      form.append("file", new Blob([audio], { type: "audio/wav" }), "icare-dictation.wav");
      const headers = API_KEY ? { Authorization: "Bearer " + API_KEY } : {};
      const transcription = await fetch(BASE_URL + "/audio/transcriptions", { method: "POST", headers, body: form });
      const resultText = await transcription.text();
      let result;
      try { result = JSON.parse(resultText); } catch { result = { text: resultText }; }
      if (!transcription.ok) return json(res, 502, { error: result.error?.message || result.error || "Échec de la transcription Lemonade (HTTP " + transcription.status + ")." });
      const text = String(result.text || "").trim();
      if (!text) return json(res, 422, { error: "Aucune parole n'a été reconnue dans cet enregistrement." });
      return json(res, 200, { text, model: voiceModel.id });
    }
    if (req.method === "POST" && url.pathname === "/api/models/select") {
      if (sessionBusy.size) return json(res, 409, { error: "Attends la fin des réponses en cours avant de changer de modèle." });
      const body = await readBody(req);
      const info = catalogModels.find(m => m.id === body.model);
      const next = info && modelRuntime.getModel("lemonade", info.id);
      if (!next) return json(res, 400, { error: "Modèle inconnu de Pi. Actualise le catalogue." });
      for (const session of sessions.values()) await session.setModel(next);
      selectedModel = next;
      setSetting("chat_model", selectedModel.id);
      return json(res, 200, { ok: true, selected: selectedModel.id, toolCalling: Boolean(info.labels?.includes("tool-calling")) });
    }
    if (req.method === "GET" && url.pathname === "/api/projects") return json(res, 200, { projects: db.prepare("SELECT id,name,description,intention,created_at,updated_at FROM projects WHERE archived_at IS NULL ORDER BY updated_at DESC").all().map(project => ({ ...project, uri: createProjectManifest(project).uri })) });
    if (req.method === "POST" && url.pathname === "/api/projects") {
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0,120);
      if (!name) return json(res, 400, { error: "Un nom de projet est requis." });
      const intention = String(body.intention || "").trim().slice(0,4000);
      const description = String(body.description || "").trim().slice(0,4000);
      const context = body.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context : {};
      const requestId = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim().slice(0,160) : "";
      const actor = body.actor ?? { type: "human", id: "local" };
      const origin = body.origin ?? "local";
      if (body.context != null && (typeof body.context !== "object" || Array.isArray(body.context))) return json(res, 400, { error: "Le contexte doit être un objet JSON." });
      if (!actor || typeof actor !== "object" || Array.isArray(actor) || typeof actor.type !== "string" || !actor.type.trim()) return json(res, 400, { error: "L'acteur initial est invalide." });
      if (typeof origin !== "string" || !origin.trim()) return json(res, 400, { error: "L'origine initiale est invalide." });
      if (requestId) {
        const previous = db.prepare("SELECT project_id FROM project_creation_requests WHERE request_id=?").get(requestId);
        if (previous) return json(res, 200, { ok: true, duplicate: true, project: db.prepare("SELECT id,name,description,intention,created_at,updated_at FROM projects WHERE id=?").get(previous.project_id), manifest: getProjectManifest(previous.project_id) });
      }
      const id = randomUUID();
      const created = now();
      const createProject = db.transaction(() => {
        db.prepare("INSERT INTO projects(id,name,description,intention,context_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
          .run(id,name,description,intention,JSON.stringify(context),created,created);
        for (const code of DIMENSION_ORDER) db.prepare("INSERT INTO project_dimensions(project_id,code,status,justification,updated_at) VALUES(?,?,?,?,?)").run(id,code,"unexplored","",created);
        if (requestId) db.prepare("INSERT INTO project_creation_requests(request_id,project_id,created_at) VALUES(?,?,?)").run(requestId,id,created);
        const event = createProjectEvent({
          projectId: id, type: "project.created",
          actor,
          origin,
          occurredAt: created,
          payload: { name, description, intention, context }
        });
        persistProjectEvent(event);
      });
      createProject();
      recordSnapshot(id, "project-created", 0);
      const project = db.prepare("SELECT id,name,description,intention,created_at,updated_at FROM projects WHERE id=?").get(id);
      return json(res, 201, { ok: true, project, manifest: getProjectManifest(id) });
    }
    const manifestMatch = /^\/api\/projects\/([^/]+)\/manifest$/.exec(url.pathname);
    if (req.method === "GET" && manifestMatch) {
      let projectId;
      try { projectId = decodeURIComponent(manifestMatch[1]); } catch { return json(res, 400, { error: "Identifiant de projet invalide." }); }
      try { return json(res, 200, { manifest: getProjectManifest(projectId) }); }
      catch (error) { return json(res, 404, { error: error.message }); }
    }
    const eventsMatch = /^\/api\/projects\/([^/]+)\/events$/.exec(url.pathname);
    if (eventsMatch) {
      let projectId;
      try { projectId = decodeURIComponent(eventsMatch[1]); } catch { return json(res, 400, { error: "Identifiant de projet invalide." }); }
      try { requireProject(projectId); } catch (error) { return json(res, 404, { error: error.message }); }
      if (req.method === "GET") {
        const after = url.searchParams.get("after");
        let rows;
        if (after) {
          const cursor = db.prepare("SELECT occurred_at,event_id FROM project_events WHERE event_id=? AND project_id=?").get(after,projectId);
          if (!cursor) return json(res, 400, { error: "Curseur d'événement inconnu pour ce projet." });
          rows = db.prepare("SELECT * FROM project_events WHERE project_id=? AND (occurred_at>? OR (occurred_at=? AND event_id>?)) ORDER BY occurred_at,event_id LIMIT 500").all(projectId,cursor.occurred_at,cursor.occurred_at,cursor.event_id);
        } else {
          rows = db.prepare("SELECT * FROM project_events WHERE project_id=? ORDER BY occurred_at,event_id LIMIT 500").all(projectId);
        }
        return json(res, 200, { events: rows.map(row => ({
          eventId: row.event_id, projectId: row.project_id, version: row.event_version, type: row.event_type,
          actor: JSON.parse(row.actor_json), origin: row.origin, occurredAt: row.occurred_at,
          causalContext: JSON.parse(row.causal_context_json), payload: JSON.parse(row.payload_json)
        })), next: rows.length ? rows[rows.length - 1].event_id : null });
      }
      if (req.method === "POST") {
        const event = await readBody(req);
        const validation = validateProjectEvent(event, projectId);
        if (!validation.valid) return json(res, 400, { error: "Événement invalide.", details: validation.errors });
        const stored = persistProjectEvent(event);
        return json(res, stored.inserted ? 201 : 200, { ok: true, duplicate: !stored.inserted, eventId: event.eventId });
      }
    }
    const peerCollectionMatch = /^\/api\/projects\/([^/]+)\/crdt\/peers$/.exec(url.pathname);
    if (peerCollectionMatch && ["GET", "POST"].includes(req.method)) {
      let projectId;
      try { projectId = decodeURIComponent(peerCollectionMatch[1]); }
      catch { return json(res, 400, { error: "Identifiant de projet invalide." }); }
      try { requireProject(projectId); }
      catch (error) { return json(res, 404, { error: error.message }); }
      if (!requireSyncAdmin(req, res)) return;
      if (req.method === "GET") return json(res, 200, { peers: listProjectSyncPeers(db, projectId) });
      const body = await readBody(req);
      try {
        const peer = createProjectSyncPeer(db, projectId, {
          label: body.label || "Replica", permissions: body.permissions || ["read", "write"]
        });
        return json(res, 201, { ok: true, peer });
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    const peerItemMatch = /^\/api\/projects\/([^/]+)\/crdt\/peers\/([^/]+)$/.exec(url.pathname);
    if (peerItemMatch && req.method === "DELETE") {
      let projectId, peerId;
      try { projectId = decodeURIComponent(peerItemMatch[1]); peerId = decodeURIComponent(peerItemMatch[2]); }
      catch { return json(res, 400, { error: "Identifiant de pair invalide." }); }
      try { requireProject(projectId); }
      catch (error) { return json(res, 404, { error: error.message }); }
      if (!requireSyncAdmin(req, res)) return;
      return json(res, 200, { ok: true, revoked: revokeProjectSyncPeer(db, projectId, peerId) });
    }
    const crdtOperationsMatch = /^\/api\/projects\/([^/]+)\/crdt\/operations$/.exec(url.pathname);
    if (crdtOperationsMatch) {
      let projectId;
      try { projectId = decodeURIComponent(crdtOperationsMatch[1]); }
      catch { return json(res, 400, { error: "Identifiant de projet invalide." }); }
      try { requireProject(projectId); }
      catch (error) { return json(res, 404, { error: error.message }); }
      const requiredPermission = req.method === "GET" ? "read" : req.method === "POST" ? "write" : null;
      if (requiredPermission && !authorizeSyncPeer(req, res, projectId, requiredPermission)) return;
      if (req.method === "GET") {
        const after = Number(url.searchParams.get("after") || 0);
        const limit = Number(url.searchParams.get("limit") || 200);
        try {
          return json(res, 200, listCrdtOperations(db, projectId, { after, limit }));
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === "POST") {
        const operation = await readBody(req);
        const validation = validateCrdtOperation(operation);
        if (!validation.valid) return json(res, 400, { error: "Opération CRDT invalide.", details: validation.errors });
        if (operation.projectId !== projectId) return json(res, 400, { error: "L'opération ne correspond pas au projet de l'URL." });
        try {
          const result = applyCrdtOperation(db, operation);
          const projection = materializeCrdtOperation(db, operation);
          return json(res, result.inserted ? 201 : 200, { ok: true, ...result, projection });
        } catch (error) {
          const conflict = /Collision/.test(error.message);
          return json(res, conflict ? 409 : 400, { error: error.message });
        }
      }
    }
    const crdtObjectMatch = /^\/api\/projects\/([^/]+)\/crdt\/objects\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && crdtObjectMatch) {
      let projectId, objectType, objectId;
      try {
        projectId = decodeURIComponent(crdtObjectMatch[1]);
        objectType = decodeURIComponent(crdtObjectMatch[2]);
        objectId = decodeURIComponent(crdtObjectMatch[3]);
      } catch { return json(res, 400, { error: "Identifiant CRDT invalide." }); }
      try { requireProject(projectId); }
      catch (error) { return json(res, 404, { error: error.message }); }
      if (!authorizeSyncPeer(req, res, projectId, "read")) return;
      if (objectType !== "proposition") return json(res, 400, { error: "Type d'objet CRDT non pris en charge." });
      return json(res, 200, { projectId, objectType, objectId, ...((getCrdtObjectState(db, projectId, objectType, objectId)) || { state: null }) });
    }
    if (req.method === "GET" && url.pathname === "/api/timeline") {
      const projectId = url.searchParams.get("projectId") || "legacy";
      requireProject(projectId);
      return json(res, 200, { snapshots: db.prepare("SELECT id,session_id,turn_index,dimensions_json,propositions_json,created_at FROM exploration_snapshots WHERE project_id=? ORDER BY created_at,id").all(projectId).map(row => ({ ...row, dimensions: JSON.parse(row.dimensions_json), propositions: JSON.parse(row.propositions_json) })) });
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      const projectId = url.searchParams.get("projectId") || "legacy";
      requireProject(projectId);
      return json(res, 200, { projectId, dimensions: getState(projectId), propositions: getPropositions(projectId), relations: getRelations(projectId), documents: db.prepare("SELECT id,title,created_at FROM reference_docs WHERE project_id=? ORDER BY title").all(projectId), turns: db.prepare("SELECT id,turn_index,user_text,assistant_text,created_at FROM conversation_turns WHERE project_id=? ORDER BY turn_index").all(projectId) });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      const sessionId = String(body.sessionId || randomUUID()).slice(0,100);
      const projectId = String(body.projectId || "legacy");
      try { requireProject(projectId); } catch (error) { return json(res, 404, { error: error.message }); }
      if (!message) return json(res, 400, { error: "Message vide." });
      const busyKey = projectId + ":" + sessionId;
      if (sessionBusy.has(busyKey)) return json(res, 409, { error: "Une réponse est déjà en cours dans cette conversation." });
      sessionBusy.add(busyKey);
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write("event: session\ndata: " + JSON.stringify({ sessionId }) + "\n\n");
      try {
        const session = await getSession(sessionId, projectId);
        const initialIds = new Set(db.prepare("SELECT id FROM propositions WHERE project_id=?").all(projectId).map(row => row.id));
        let assistantText = "";
        let reconciliationPass = false;
        const toolEvents = [];
        const unsubscribe = session.subscribe(event => {
          if (typeof event.type === "string" && event.type.startsWith("tool_")) {
            toolEvents.push({
              type: event.type,
              name: event.toolName || event.name || event.toolCall?.name || null
            });
          }
          if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            const delta = event.assistantMessageEvent.delta;
            if (!reconciliationPass) {
              assistantText += delta;
              res.write("event: delta\ndata: " + JSON.stringify({ text: delta }) + "\n\n");
            }
          }
        });
        await session.prompt(message);

        // Le texte du chat ne suffit pas : si aucune proposition n'a été persistée,
        // demander à Pi une passe interne de rattrapage avec appel d'outil.
        let newPropositions = db.prepare("SELECT * FROM propositions WHERE project_id=?").all(projectId).filter(row => !initialIds.has(row.id));
        const claimsPersistence = /(?:enregistr|ajout|créé|proposition.{0,30}candidate|attend.{0,20}validation)/i.test(assistantText);
        const substantialInput = message.length >= 80;
        let reconciliationError = null;
        if (newPropositions.length === 0 && (claimsPersistence || substantialInput)) {
          reconciliationPass = true;
          try {
            await session.prompt(
              "PASSE INTERNE DE PERSISTANCE — ne rédige pas une nouvelle réponse conversationnelle. " +
              "Vérifie les propositions existantes avec list_propositions pour éviter les doublons. " +
              "Reprends les informations substantielles formulées par l'utilisateur dans les messages récents, notamment lorsqu'un dernier message bref confirme une demande d'enregistrement. " +
              "Si elles contiennent une ou plusieurs observations nouvelles qui méritent d'être conservées, appelle réellement propose_observation pour chacune, avec les dimensions ICARE pertinentes et les qualifications connues. " +
              "N'invente aucun fait et laisse inconnus les champs incertains. Si aucune observation nouvelle ne mérite d'être enregistrée, n'appelle aucun outil. " +
              "N'affirme jamais qu'une opération a été effectuée sans confirmation de l'outil."
            );
          } catch (error) {
            reconciliationError = error.message || String(error);
          } finally {
            reconciliationPass = false;
          }
          newPropositions = db.prepare("SELECT * FROM propositions WHERE project_id=?").all(projectId).filter(row => !initialIds.has(row.id));
        }
        unsubscribe();
        const turnIndex = Number(db.prepare("SELECT COALESCE(MAX(turn_index),0)+1 AS next FROM conversation_turns WHERE project_id=? AND session_id=?").get(projectId, sessionId).next);
        db.prepare("INSERT INTO conversation_turns(id,project_id,session_id,turn_index,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), projectId, sessionId, turnIndex, message, assistantText, now());
        db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(now(), projectId);
        recordSnapshot(projectId, sessionId, turnIndex);
        const candidatePropositions = newPropositions.filter(p => p.review_status === "candidate");
        res.write("event: persistence\ndata: " + JSON.stringify({
          created: candidatePropositions.length,
          propositions: candidatePropositions.map(p => ({ id: p.id, text: p.text, dimensions: JSON.parse(p.dimensions), review_status: p.review_status })),
          unconfirmedClaim: candidatePropositions.length === 0 && claimsPersistence,
          reconciliationError,
          toolEvents
        }) + "\n\n");
        res.write("event: done\ndata: " + JSON.stringify({ state: getState(projectId), propositions: getPropositions(projectId), relations: getRelations(projectId) }) + "\n\n");
      } catch (error) {
        res.write("event: error\ndata: " + JSON.stringify({ message: error.message || String(error) }) + "\n\n");
      } finally {
        sessionBusy.delete(busyKey);
        res.end();
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/propositions") {
      const body = await readBody(req);
      const projectId = String(body.projectId || "legacy");
      requireProject(projectId);
      const proposal = recordCandidate({
        ...body,
        source: body.source || "user",
        epistemic: body.epistemic || "reported",
        practical: body.practical || "unspecified"
      }, projectId);
      recordSnapshot(projectId, "proposal-created", Number(db.prepare("SELECT COALESCE(MAX(turn_index),0) AS current FROM conversation_turns WHERE project_id=?").get(projectId).current));
      return json(res, 201, { ok: true, proposition: { ...proposal, dimensions: JSON.parse(proposal.dimensions) } });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/propositions/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readBody(req);
      if (!["accepted", "rejected"].includes(body.review_status)) return json(res, 400, { error: "Statut de validation invalide." });
      const justification = String(body.justification || "").trim();
      if (justification.length < 8) return json(res, 400, { error: "Une justification d'au moins 8 caractères est requise pour historiser la décision." });
      const projectId = String(body.projectId || url.searchParams.get("projectId") || "legacy");
      try { requireProject(projectId); } catch (error) { return json(res, 404, { error: error.message }); }
      const result = db.prepare("UPDATE propositions SET review_status=? WHERE id=? AND project_id=? AND review_status='candidate'").run(body.review_status, id, projectId);
      if (!result.changes) return json(res, 404, { error: "Proposition candidate introuvable." });
      let decisionId;
      try {
        ({ decisionId } = recordCrdtValidationDecision(db, {
          projectId, objectId: id, targetType: "proposition", targetId: id,
          status: body.review_status, justification,
          resolves: getActiveCrdtDecisions(projectId, id, "proposition").map(decision => decision.id)
        }));
      } catch (error) {
        db.prepare("UPDATE propositions SET review_status='candidate' WHERE id=? AND project_id=? AND review_status=?")
          .run(id, projectId, body.review_status);
        return json(res, 500, { error: "La décision n'a pas pu être inscrite dans le journal CRDT : " + error.message });
      }
      recordSnapshot(projectId, "proposal-" + id, Number(db.prepare("SELECT COALESCE(MAX(turn_index),0) AS current FROM conversation_turns WHERE project_id=?").get(projectId).current));
      return json(res, 200, { ok: true, decisionId });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/relations/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readBody(req);
      if (!["accepted", "rejected"].includes(body.review_status)) return json(res, 400, { error: "Statut de validation invalide." });
      const justification = String(body.justification || "").trim();
      if (justification.length < 8) return json(res, 400, { error: "Une justification d'au moins 8 caractères est requise pour historiser la décision." });
      const projectId = String(body.projectId || url.searchParams.get("projectId") || "legacy");
      try { requireProject(projectId); } catch (error) { return json(res, 404, { error: error.message }); }
      const relation = db.prepare("SELECT * FROM relations WHERE id=? AND project_id=? AND review_status='candidate'").get(id, projectId);
      if (!relation) return json(res, 404, { error: "Relation candidate introuvable." });
      const result = db.prepare("UPDATE relations SET review_status=? WHERE id=? AND project_id=? AND review_status='candidate'").run(body.review_status, id, projectId);
      if (!result.changes) return json(res, 404, { error: "Relation candidate introuvable." });
      let decisionId;
      try {
        ({ decisionId } = recordCrdtValidationDecision(db, {
          projectId, objectId: relation.from_id, targetType: "relation", targetId: id,
          status: body.review_status, justification,
          resolves: getActiveCrdtDecisions(projectId, relation.from_id, "relation", id).map(decision => decision.id)
        }));
      } catch (error) {
        db.prepare("UPDATE relations SET review_status='candidate' WHERE id=? AND project_id=? AND review_status=?")
          .run(id, projectId, body.review_status);
        return json(res, 500, { error: "La décision n'a pas pu être inscrite dans le journal CRDT : " + error.message });
      }
      recordSnapshot(projectId, "relation-" + id, Number(db.prepare("SELECT COALESCE(MAX(turn_index),0) AS current FROM conversation_turns WHERE project_id=?").get(projectId).current));
      return json(res, 200, { ok: true, decisionId });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/dimensions/")) {
      const code = url.pathname.split("/").pop();
      const body = await readBody(req);
      if (!Object.hasOwn(DIMENSIONS, code) || !EXPLORATION.includes(body.status)) return json(res, 400, { error: "Dimension ou statut invalide." });
      const justification = String(body.justification || "").trim();
      if (["sufficient", "not_applicable"].includes(body.status) && justification.length < 8) return json(res, 400, { error: "Une justification est requise pour ce statut." });
      const projectId = String(body.projectId || url.searchParams.get("projectId") || "legacy");
      try { requireProject(projectId); } catch (error) { return json(res, 404, { error: error.message }); }
      const result = db.prepare("UPDATE project_dimensions SET status=?,justification=?,updated_at=? WHERE code=? AND project_id=?").run(body.status, justification, now(), code, projectId);
      if (result.changes !== 1) return json(res, 404, { error: "Dimension introuvable ; aucune modification enregistrée." });
      const persisted = db.prepare("SELECT code,status,justification,updated_at FROM project_dimensions WHERE code=? AND project_id=?").get(code, projectId);
      if (!persisted || persisted.status !== body.status || persisted.justification !== justification) return json(res, 500, { error: "La vérification après écriture a échoué." });
      recordSnapshot(projectId, "dimension-" + code, Number(db.prepare("SELECT COALESCE(MAX(turn_index),0) AS current FROM conversation_turns WHERE project_id=?").get(projectId).current));
      return json(res, 200, { ok: true, dimension: persisted });
    }
    if (req.method === "POST" && url.pathname === "/api/references") {
      const body = await readBody(req);
      const title = String(body.title || "").trim().slice(0,200);
      const content = String(body.content || "").trim().slice(0,100000);
      if (!title || !content) return json(res, 400, { error: "Titre et contenu requis." });
      const id = randomUUID();
      const projectId = String(body.projectId || "legacy");
      requireProject(projectId);
      db.prepare("INSERT INTO reference_docs(id,title,content,created_at,project_id) VALUES(?,?,?,?,?)").run(id,title,content,now(),projectId);
      return json(res, 201, { ok: true, id });
    }
    return json(res, 404, { error: "Route inconnue." });
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: error.message || String(error) });
    else res.end();
  }
});

try {
  const { modelId, modelName } = await initializePi();
  const backfill = backfillCrdtProjections();
  if (backfill.propositions || backfill.relations) console.log("[ICARE CRDT] Projections historiques importées :", backfill.propositions, "propositions,", backfill.relations, "relations.");
  const syncPeers = parseSyncPeerConfig(process.env.ICARE_SYNC_PEERS || "[]");
  if (syncPeers.length) {
    const intervalMs = Number(process.env.ICARE_SYNC_INTERVAL_MS || 30000);
    startSyncScheduler(db, syncPeers, {
      intervalMs,
      onResult: result => console.log("[ICARE sync] Pair synchronisé :", result.projectId, result.peerKey,
        "tirées=" + result.pulled, "envoyées=" + result.pushed),
      onError: failure => console.warn("[ICARE sync] Pair indisponible ; nouvelle tentative planifiée :",
        failure.projectId, failure.peerKey, failure.error)
    });
    console.log("[ICARE sync] Synchronisation automatique activée pour", syncPeers.length, "pair(s).");
  }
  server.listen(PORT, HOST, () => {
    console.log(`ICARE prêt : http://${HOST}:${PORT}`);
    console.log(`Pi SDK connecté à Lemonade : ${modelName} (${modelId})`);
    console.log("Aucun outil shell, fichier arbitraire ou navigateur n'est exposé à l'agent.");
  });
} catch (error) {
  console.error("[ICARE] Démarrage impossible :", error.message || error);
  process.exit(1);
}
