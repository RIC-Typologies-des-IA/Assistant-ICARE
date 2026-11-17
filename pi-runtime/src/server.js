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
const DIMENSIONS = {
  I: "Intention / finalité",
  C: "Contexte / situation",
  A: "Action / opération",
  R: "Régulation / organisation",
  E: "Évolution / temporalité"
};
const TEMPORAL = ["past", "present", "future", "unknown"];
const EVALUATION = ["desired", "undesired", "feared", "neutral", "unknown"];
const EPISTEMIC = ["asserted", "reported", "inferred", "hypothesis", "predicted", "unknown"];
const PRACTICAL = ["proposed", "considered", "decided", "committed", "in_progress", "completed", "abandoned", "unspecified"];
const EXPLORATION = ["unexplored", "insufficient", "sufficient", "not_applicable"];

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
- Distingue toujours le passé, le présent, le futur souhaité, les hypothèses, les décisions, les engagements et les réalisations.
- Souhaité ne signifie pas décidé ; décidé ne signifie pas engagé ; engagé ne signifie pas réalisé.
- Une évolution temporelle n'est pas automatiquement une contradiction.
- Conserve les points de vue divergents et leurs sources. Ne tranche pas sans preuve.
- Une information absente n'est pas « non applicable ».
- Tu proposes des interprétations avec prudence et expliques brièvement les incertitudes.
- N'invente jamais de faits, d'acteurs, de relations ou de décisions.
- Tu peux consulter la mémoire documentaire ICARE et l'état d'exploration avec les outils fournis.
- Tu peux enregistrer une proposition comme candidate à validation humaine, jamais comme un fait validé.
- Ne marque jamais une dimension comme suffisamment explorée ou non applicable de ta propre initiative.
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
const sessions = new Map();
const sessionBusy = new Set();

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
  const rows = db.prepare("SELECT * FROM dimensions ORDER BY code").all();
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
  const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.5)));
  const id = randomUUID();
  db.prepare(`INSERT INTO propositions
    (id,text,dimensions,primary_dimension,temporal,evaluation,epistemic,practical,confidence,source,aspect,review_status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, String(input.text || "").trim().slice(0,4000), JSON.stringify(dimensions), primary,
      temporal, evaluation, epistemic, practical, confidence, String(input.source || "conversation").slice(0,300),
      String(input.aspect || "").slice(0,300), "candidate", now()
    );
  return db.prepare("SELECT * FROM propositions WHERE id=?").get(id);
}

async function initializePi() {
  const modelsResponse = await fetch(BASE_URL + "/models", {
    headers: API_KEY ? { Authorization: "Bearer " + API_KEY } : {}
  });
  if (!modelsResponse.ok) throw new Error(`Lemonade ne répond pas sur ${BASE_URL} (HTTP ${modelsResponse.status}). Vérifie que Lemonade Server est démarré.`);
  const catalog = await modelsResponse.json();
  const models = catalog.data || [];
  const chatModels = models.filter(m => !m.labels || m.labels.includes("chat"));
  const modelId = process.env.ICARE_MODEL || chatModels[0]?.id;
  if (!modelId) throw new Error("Aucun modèle de chat n'est disponible dans Lemonade. Charge d'abord un modèle de langage.");
  const selected = models.find(m => m.id === modelId);
  const modelConfig = {
    id: modelId, name: selected?.name || modelId, api: "openai-completions",
    reasoning: Boolean(selected?.labels?.includes("reasoning")), input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(selected?.context_length || 32768), maxTokens: 4096
  };
  const provider = {
    name: "Lemonade local", baseUrl: BASE_URL, api: "openai-completions",
    models: [modelConfig]
  };
  if (API_KEY) provider.apiKey = "$LEMONADE_API_KEY";
  await writeFile(path.join(AGENT_DIR, "models.json"), JSON.stringify({ providers: { lemonade: provider } }, null, 2));
  process.env.LEMONADE_API_KEY = API_KEY;
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } =
    await import("@earendil-works/pi-coding-agent");
  const { Type } = await import("@earendil-works/pi-ai");
  modelRuntime = await ModelRuntime.create();
  selectedModel = modelRuntime.getModel("lemonade", modelId);
  if (!selectedModel) throw new Error(`Pi n'a pas pu charger le modèle Lemonade « ${modelId} » depuis models.json.`);

  const extensionFactory = (pi) => {
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
        epistemic: Type.Optional(Type.String()),
        practical: Type.Optional(Type.String()),
        confidence: Type.Optional(Type.Number()),
        source: Type.Optional(Type.String()),
        aspect: Type.Optional(Type.String())
      }),
      execute: async (_id, params) => {
        const p = recordCandidate(params);
        return { content: [{ type: "text", text: `Proposition candidate enregistrée (${p.id}). Elle attend une validation humaine dans le tableau de bord ; elle n'est pas considérée comme un fait validé.` }], details: { id: p.id } };
      }
    });
  };
  piModules = { createAgentSession, SessionManager, DefaultResourceLoader, registerTools: extensionFactory };
  return { modelId, modelName: selected?.name || modelId };
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
    if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, { ok: true, model: selectedModel.id, provider: "Lemonade via Pi SDK" });
    if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, { dimensions: getState(), propositions: getPropositions(), documents: db.prepare("SELECT id,title,created_at FROM reference_docs ORDER BY title").all() });
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
        const unsubscribe = session.subscribe(event => {
          if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            res.write("event: delta\ndata: " + JSON.stringify({ text: event.assistantMessageEvent.delta }) + "\n\n");
          }
        });
        await session.prompt(message);
        unsubscribe();
        res.write("event: done\ndata: " + JSON.stringify({ state: getState(), propositions: getPropositions().filter(p => p.review_status === "candidate") }) + "\n\n");
      } catch (error) {
        res.write("event: error\ndata: " + JSON.stringify({ message: error.message || String(error) }) + "\n\n");
      } finally {
        sessionBusy.delete(sessionId);
        res.end();
      }
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/propositions/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readBody(req);
      if (!["accepted", "rejected"].includes(body.review_status)) return json(res, 400, { error: "Statut de validation invalide." });
      const result = db.prepare("UPDATE propositions SET review_status=? WHERE id=? AND review_status='candidate'").run(body.review_status, id);
      if (!result.changes) return json(res, 404, { error: "Proposition candidate introuvable." });
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
