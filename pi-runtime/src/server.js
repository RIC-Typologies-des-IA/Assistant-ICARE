import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_DIR = path.resolve(process.env.ICARE_DATA_DIR || path.join(ROOT, "data"));
const AGENT_DIR = path.resolve(path.join(DATA_DIR, "pi-agent"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
const BASE_URL = (process.env.LEMONADE_BASE_URL || "http://127.0.0.1:13305/v1").replace(/\/$/, "");
const API_KEY = process.env.LEMONADE_API_KEY || "";
const HOST = process.env.ICARE_HOST || "127.0.0.1";
const PORT = Number(process.env.ICARE_PORT || 8765);
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
const insertDimension = db.prepare("INSERT OR IGNORE INTO dimensions(code,status,justification,updated_at) VALUES(?,?,?,?)");
for (const code of Object.keys(DIMENSIONS)) insertDimension.run(code, "unexplored", "", now());
const seedDoc = db.prepare("INSERT OR IGNORE INTO reference_docs(id,title,content,created_at) VALUES(?,?,?,?)");
for (const [id, title, filename] of [
  ["guide-icare", "Guide de la démarche ICARE", "guide-icare.md"],
  ["ontology-icare", "Ontologie ICARE (JSON)", "icare.json"]
]) {
  const file = path.join(HERE, "..", "reference", filename);
  if (existsSync(file)) seedDoc.run(id, title, await readFile(file, "utf8"), now());
}

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
const sessions = new Map();
const sessionBusy = new Set();
let activeIcareTools = [];

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
function getState() {
  const rows = db.prepare("SELECT * FROM dimensions").all()
    .sort((a, b) => DIMENSION_ORDER.indexOf(a.code) - DIMENSION_ORDER.indexOf(b.code));
  const counts = db.prepare("SELECT dimensions, review_status FROM propositions").all();
  return rows.map(row => {
    const related = counts.filter(p => JSON.parse(p.dimensions).includes(row.code));
    return { ...row, label: DIMENSIONS[row.code], candidates: related.filter(p => p.review_status === "candidate").length,
      accepted: related.filter(p => p.review_status === "accepted").length };
  });
}
function getPropositions() {
  return db.prepare("SELECT * FROM propositions ORDER BY created_at DESC LIMIT 100").all()
    .map(p => ({ ...p, dimensions: JSON.parse(p.dimensions) }));
}
function getRelations() {
  return db.prepare("SELECT * FROM relations ORDER BY created_at DESC LIMIT 200").all();
}
function searchDocs(query) {
  const terms = String(query || "").toLowerCase().split(/\W+/).filter(t => t.length > 2);
  const docs = db.prepare("SELECT id,title,content FROM reference_docs").all();
  return docs.map(doc => {
    const lower = doc.content.toLowerCase();
    const score = terms.reduce((n, term) => n + (lower.split(term).length - 1), 0);
    return { id: doc.id, title: doc.title, score, excerpt: doc.content.slice(0, 2400) };
  }).filter(d => d.score > 0 || terms.length === 0).sort((a,b) => b.score-a.score).slice(0,4);
}
function recordCandidate(input) {
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
     subject,predicate,value,author,source_agent,source_interaction,justification)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, observationText, JSON.stringify(dimensions), primary,
      temporal, evaluation, epistemic, practical, confidence, String(input.source || "conversation").slice(0,300),
      String(input.aspect || "").slice(0,300), "candidate", now(),
      optionalText("utterance_time"), optionalText("valid_time_start"), optionalText("valid_time_end"),
      optionalText("event_period_start"), optionalText("event_period_end"), optionalText("target_horizon"),
      optionalText("realization_time"), modality, optionalText("subject"), optionalText("predicate"), optionalText("value"),
      optionalText("author"), optionalText("source_agent"), optionalText("source_interaction"), optionalText("justification")
    );
  return db.prepare("SELECT * FROM propositions WHERE id=?").get(id);
}
function recordRelationCandidate(input) {
  const allowed = new Set(ONTOLOGY.relations);
  const relation = String(input.relation || "");
  if (!allowed.has(relation)) throw new Error("Relation inconnue dans l'ontologie complémentaire.");
  const fromId = String(input.from_id || "");
  const toId = String(input.to_id || "");
  if (!fromId || !toId || fromId === toId) throw new Error("Deux identifiants de propositions distincts sont requis.");
  const exists = db.prepare("SELECT id FROM propositions WHERE id IN (?,?)").all(fromId, toId);
  if (exists.length !== 2) throw new Error("Les deux propositions doivent exister.");
  const id = randomUUID();
  db.prepare("INSERT INTO relations(id,from_id,to_id,relation,note,review_status,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, fromId, toId, relation, String(input.note || "").slice(0,1000), "candidate", now());
  return { id, from_id: fromId, to_id: toId, relation, review_status: "candidate" };
}

async function refreshModelCatalog() {
  const response = await fetch(BASE_URL + "/models?show_all=true", { headers: API_KEY ? { Authorization: "Bearer " + API_KEY } : {} });
  if (!response.ok) throw new Error("Impossible de lire le catalogue Lemonade (HTTP " + response.status + ").");
  const payload = await response.json();
  const models = (payload.data || []).filter(m => m.labels?.includes("chat"));
  if (!models.length) throw new Error("Le catalogue Lemonade ne contient aucun modèle de conversation.");
  const availableModels = models.filter(m => m.downloaded === true);
  if (!availableModels.length) throw new Error("Aucun modèle de conversation n’est téléchargé dans Lemonade. Installe un modèle puis actualise le catalogue.");
  const modelConfigs = availableModels.map(m => ({ id: m.id, name: m.name || m.id, api: "openai-completions", reasoning: Boolean(m.labels?.includes("reasoning")), input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: Number(m.context_length || m.max_context_window || 32768), maxTokens: Number(m.max_output_tokens || m.max_completion_tokens || 4096) }));
  const provider = { name: "Lemonade local", baseUrl: BASE_URL, api: "openai-completions", models: modelConfigs };
  provider.apiKey = "$LEMONADE_API_KEY"; provider.authHeader = true;
  await writeFile(path.join(AGENT_DIR, "models.json"), JSON.stringify({ providers: { lemonade: provider } }, null, 2));
  const nextRuntime = await piModules.ModelRuntime.create();
  const currentId = selectedModel?.id || process.env.ICARE_MODEL;
  const choice = availableModels.find(m => m.id === currentId) || availableModels.find(m => m.labels?.includes("tool-calling")) || availableModels[0];
  const nextModel = nextRuntime.getModel("lemonade", choice.id);
  if (!nextModel) throw new Error("Pi n'a pas pu charger le modèle Lemonade « " + choice.id + " ».");
  modelRuntime = nextRuntime; selectedModel = nextModel; catalogModels = models;
  return models;
}

async function initializePi() {
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { Type } = await import("@earendil-works/pi-ai");
  piModules = { createAgentSession, SessionManager, DefaultResourceLoader, ModelRuntime, Type };
  process.env.LEMONADE_API_KEY = API_KEY || "local";
  await refreshModelCatalog();
  if (process.env.ICARE_MODEL && !catalogModels.some(m => m.id === process.env.ICARE_MODEL && m.downloaded === true)) throw new Error("Le modèle ICARE_MODEL demandé est absent du catalogue ou n’est pas téléchargé dans Lemonade.");
  const chosen = catalogModels.find(m => m.id === selectedModel.id);
  if (!chosen?.labels?.includes("tool-calling")) console.warn("[ICARE] Le modèle choisi n'est pas signalé comme compatible tool-calling.");
  const extensionFactory = (pi) => {
    const icareToolNames = ["list_available_models", "get_ontology", "get_exploration_state", "search_reference_documents", "list_propositions", "propose_observation", "propose_relation"];
    pi.registerTool({
      name: "list_available_models",
      label: "Catalogue des modèles Lemonade",
      description: "Consulte les modèles de conversation Lemonade, leurs capacités et leur disponibilité. Ne change pas le modèle actif.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(catalogModels.map(m => ({ id: m.id, name: m.name || m.id, labels: m.labels || [], downloaded: m.downloaded !== false, context_length: m.context_length || m.max_context_window || null, suggested: Boolean(m.suggested) })), null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "get_ontology",
      label: "Ontologie ICARE",
      description: "Renvoie l'ontologie structurée complète : dimensions ICARE et couches complémentaires des états/temps, de l'évaluation/modalité, de l'épistémique/provenance, des statuts pratiques et des relations historiques.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(ONTOLOGY, null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "get_exploration_state",
      label: "État d'exploration ICARE",
      description: "Consulte l'état documenté des cinq dimensions ICARE et les volumes de propositions validées ou en attente.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(getState(), null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "search_reference_documents",
      label: "Rechercher dans les références ICARE",
      description: "Recherche dans le corpus documentaire méthodologique local. N'effectue aucune recherche sur Internet.",
      parameters: Type.Object({ query: Type.String({ description: "Notions à rechercher dans les documents de référence." }) }),
      execute: async (_id, params) => ({ content: [{ type: "text", text: JSON.stringify(searchDocs(params.query), null, 2) }], details: {} })
    });
    pi.registerTool({
      name: "list_propositions",
      label: "Consulter les propositions",
      description: "Consulte les propositions ICARE enregistrées, avec leur statut de validation.",
      parameters: Type.Object({ review_status: Type.Optional(Type.String({ description: "candidate, accepted ou rejected" })) }),
      execute: async (_id, params) => {
        const rows = getPropositions().filter(p => !params.review_status || p.review_status === params.review_status);
        return { content: [{ type: "text", text: JSON.stringify(rows.slice(0,40), null, 2) }], details: {} };
      }
    });
    pi.registerTool({
      name: "propose_observation",
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
        const p = recordCandidate(params);
        return { content: [{ type: "text", text: `Proposition candidate enregistrée (${p.id}). Elle attend une validation humaine dans le tableau de bord ; elle n'est pas considérée comme un fait validé.` }], details: { id: p.id } };
      }
    });
    pi.registerTool({
      name: "propose_relation",
      label: "Proposer une relation entre observations",
      description: "Enregistre une relation candidate entre deux propositions existantes. La relation attend une validation humaine et ne modifie jamais les propositions sources.",
      parameters: Type.Object({
        from_id: Type.String({ description: "Identifiant de la proposition source." }),
        to_id: Type.String({ description: "Identifiant de la proposition cible." }),
        relation: Type.String({ description: "Type de relation défini dans l'ontologie complémentaire." }),
        note: Type.Optional(Type.String({ description: "Justification concise de la relation." }))
      }),
      execute: async (_id, params) => {
        const relation = recordRelationCandidate(params);
        return { content: [{ type: "text", text: `Relation candidate enregistrée (${relation.id}) ; elle attend une validation humaine.` }], details: relation };
      }
    });
    // L'API SDK distingue les outils enregistrés des outils actifs : active explicitement ICARE.
    pi.setActiveTools(icareToolNames);
    activeIcareTools = [...icareToolNames];
    console.log("[ICARE] Outils ICARE enregistrés et activés :", activeIcareTools.join(", "));
  };
  piModules.registerTools = extensionFactory;
  return { modelId: selectedModel.id, modelName: chosen?.name || selectedModel.id };
}
async function getSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  const { createAgentSession, SessionManager } = piModules;
  const resourceLoader = new piModules.DefaultResourceLoader({
    cwd: ROOT, agentDir: AGENT_DIR,
    systemPromptOverride: () => SYSTEM_PROMPT,
    appendSystemPromptOverride: () => [],
    extensionFactories: [pi => piModules.registerTools(pi)]
  });
  await resourceLoader.reload();
  const created = await createAgentSession({
    model: selectedModel, modelRuntime, resourceLoader, noTools: "builtin",
    sessionManager: SessionManager.create(ROOT)
  });
  sessions.set(id, created.session);
  return created.session;
}
function sendStatic(res, file, type) {
  readFile(file).then(body => {
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  }).catch(() => json(res, 404, { error: "Fichier introuvable." }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + req.headers.host);
  try {
    if (req.method === "GET" && url.pathname === "/") return sendStatic(res, path.join(HERE, "..", "public", "index.html"), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/status") {
      const modelInfo = catalogModels.find(m => m.id === selectedModel.id);
      return json(res, 200, {
        ok: true, model: selectedModel.id, provider: "Lemonade via Pi SDK",
        toolCalling: Boolean(modelInfo?.labels?.includes("tool-calling")),
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
    if (req.method === "POST" && url.pathname === "/api/models/select") {
      if (sessionBusy.size) return json(res, 409, { error: "Attends la fin des réponses en cours avant de changer de modèle." });
      const body = await readBody(req);
      const info = catalogModels.find(m => m.id === body.model);
      const next = info && modelRuntime.getModel("lemonade", info.id);
      if (!next) return json(res, 400, { error: "Modèle inconnu de Pi. Actualise le catalogue." });
      for (const session of sessions.values()) await session.setModel(next);
      selectedModel = next;
      return json(res, 200, { ok: true, selected: selectedModel.id, toolCalling: Boolean(info.labels?.includes("tool-calling")) });
    }
    if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, { dimensions: getState(), propositions: getPropositions(), relations: getRelations(), documents: db.prepare("SELECT id,title,created_at FROM reference_docs ORDER BY title").all() });
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      const sessionId = String(body.sessionId || randomUUID()).slice(0,100);
      if (!message) return json(res, 400, { error: "Message vide." });
      if (sessionBusy.has(sessionId)) return json(res, 409, { error: "Une réponse est déjà en cours dans cette conversation." });
      sessionBusy.add(sessionId);
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write("event: session\ndata: " + JSON.stringify({ sessionId }) + "\n\n");
      try {
        const session = await getSession(sessionId);
        const initialIds = new Set(db.prepare("SELECT id FROM propositions").all().map(row => row.id));
        let assistantText = "";
        let reconciliationPass = false;
        const unsubscribe = session.subscribe(event => {
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
        let newPropositions = db.prepare("SELECT * FROM propositions").all().filter(row => !initialIds.has(row.id));
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
          newPropositions = db.prepare("SELECT * FROM propositions").all().filter(row => !initialIds.has(row.id));
        }
        unsubscribe();
        const candidatePropositions = newPropositions.filter(p => p.review_status === "candidate");
        res.write("event: persistence\ndata: " + JSON.stringify({
          created: candidatePropositions.length,
          propositions: candidatePropositions.map(p => ({ id: p.id, text: p.text, dimensions: JSON.parse(p.dimensions), review_status: p.review_status })),
          unconfirmedClaim: candidatePropositions.length === 0 && claimsPersistence,
          reconciliationError
        }) + "\n\n");
        res.write("event: done\ndata: " + JSON.stringify({ state: getState(), propositions: getPropositions().filter(p => p.review_status === "candidate"), relations: getRelations() }) + "\n\n");
      } catch (error) {
        res.write("event: error\ndata: " + JSON.stringify({ message: error.message || String(error) }) + "\n\n");
      } finally {
        sessionBusy.delete(sessionId);
        res.end();
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/propositions") {
      const body = await readBody(req);
      const proposal = recordCandidate({
        ...body,
        source: body.source || "user",
        epistemic: body.epistemic || "reported",
        practical: body.practical || "unspecified"
      });
      return json(res, 201, { ok: true, proposition: { ...proposal, dimensions: JSON.parse(proposal.dimensions) } });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/propositions/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readBody(req);
      if (!["accepted", "rejected"].includes(body.review_status)) return json(res, 400, { error: "Statut de validation invalide." });
      const result = db.prepare("UPDATE propositions SET review_status=? WHERE id=? AND review_status='candidate'").run(body.review_status, id);
      if (!result.changes) return json(res, 404, { error: "Proposition candidate introuvable." });
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/relations/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readBody(req);
      if (!["accepted", "rejected"].includes(body.review_status)) return json(res, 400, { error: "Statut de validation invalide." });
      const result = db.prepare("UPDATE relations SET review_status=? WHERE id=? AND review_status='candidate'").run(body.review_status, id);
      if (!result.changes) return json(res, 404, { error: "Relation candidate introuvable." });
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/dimensions/")) {
      const code = url.pathname.split("/").pop();
      const body = await readBody(req);
      if (!Object.hasOwn(DIMENSIONS, code) || !EXPLORATION.includes(body.status)) return json(res, 400, { error: "Dimension ou statut invalide." });
      const justification = String(body.justification || "").trim();
      if (["sufficient", "not_applicable"].includes(body.status) && justification.length < 8) return json(res, 400, { error: "Une justification est requise pour ce statut." });
      db.prepare("UPDATE dimensions SET status=?,justification=?,updated_at=? WHERE code=?").run(body.status, justification, now(), code);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/references") {
      const body = await readBody(req);
      const title = String(body.title || "").trim().slice(0,200);
      const content = String(body.content || "").trim().slice(0,100000);
      if (!title || !content) return json(res, 400, { error: "Titre et contenu requis." });
      const id = randomUUID();
      db.prepare("INSERT INTO reference_docs(id,title,content,created_at) VALUES(?,?,?,?)").run(id,title,content,now());
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
  server.listen(PORT, HOST, () => {
    console.log(`ICARE prêt : http://${HOST}:${PORT}`);
    console.log(`Pi SDK connecté à Lemonade : ${modelName} (${modelId})`);
    console.log("Aucun outil shell, fichier arbitraire ou navigateur n'est exposé à l'agent.");
  });
} catch (error) {
  console.error("[ICARE] Démarrage impossible :", error.message || error);
  process.exit(1);
}
