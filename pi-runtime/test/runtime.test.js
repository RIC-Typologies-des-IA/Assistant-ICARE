import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test("Node runtime provides SQLite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sample (value TEXT)");
  db.prepare("INSERT INTO sample(value) VALUES (?)").run("ICARE");
  assert.equal(db.prepare("SELECT value FROM sample").get().value, "ICARE");
  db.close();
});

test("Pi SDK loads a custom Lemonade OpenAI-compatible model", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "icare-pi-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousApiKey = process.env.LEMONADE_API_KEY;
  try {
    await mkdir(dir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = dir;
    process.env.LEMONADE_API_KEY = "test-local-key";
    await writeFile(path.join(dir, "models.json"), JSON.stringify({
      providers: {
        lemonade: {
          name: "Lemonade local",
          baseUrl: "http://127.0.0.1:13305/v1",
          api: "openai-completions",
          apiKey: "$LEMONADE_API_KEY",
          authHeader: true,
          models: [
            { id: "test-chat-model", name: "Test chat model", input: ["text"], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 },
            { id: "test-chat-model-2", name: "Second test model", input: ["text"], reasoning: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: 2048 }
          ]
        }
      }
    }));
    const { ModelRuntime, DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
    const { Type } = await import("typebox");
    const runtime = await ModelRuntime.create();
    const model = runtime.getModel("lemonade", "test-chat-model");
    assert.ok(model);
    assert.equal(model.provider, "lemonade");
    assert.equal(model.id, "test-chat-model");
    const { createAgentSession, SessionManager } = await import("@earendil-works/pi-coding-agent");
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      extensionFactories: [pi => {
        pi.registerTool({
          name: "icare_test_tool",
          label: "ICARE test",
          description: "Vérifie l'activation d'un outil d'extension ICARE.",
          exposure: "direct",
          parameters: Type.Object({}),
          execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} })
        });
      }]
    });
    await resourceLoader.reload();
    const loadedExtensions = resourceLoader.getExtensions();
    const loadedToolNames = loadedExtensions.extensions.flatMap(extension =>
      [...extension.tools.values()].map(tool => tool.definition.name)
    );
    assert.ok(loadedToolNames.includes("icare_test_tool"), JSON.stringify({
      errors: loadedExtensions.errors,
      loadedToolNames
    }));
    const { session } = await createAgentSession({
      model, modelRuntime: runtime, resourceLoader,
      sessionManager: SessionManager.inMemory(), noTools: "builtin"
    });
    try {
      await session.bindExtensions({});
      assert.ok(session.getAllTools().some(tool => tool.name === "icare_test_tool"),
        "Session registry: " + session.getAllTools().map(tool => tool.name).join(", "));
      session.setActiveToolsByName(["icare_test_tool"]);
      assert.ok(session.getActiveToolNames().includes("icare_test_tool"),
        "Active tools: " + session.getActiveToolNames().join(", "));
      const second = runtime.getModel("lemonade", "test-chat-model-2");
      assert.ok(second);
      await session.setModel(second);
      assert.equal(session.model.id, "test-chat-model-2");
    } finally {
      session.dispose();
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousApiKey === undefined) delete process.env.LEMONADE_API_KEY;
    else process.env.LEMONADE_API_KEY = previousApiKey;
    await rm(dir, { recursive: true, force: true });
  }
});


test("ICARE ontology defines dimensions in canonical I-C-A-R-E order", async () => {
  const ontology = JSON.parse(await readFile(new URL("../reference/icare.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(ontology.dimensions), ["I", "C", "A", "R", "E"]);
  assert.deepEqual(ontology.exploration_status, ["unexplored", "insufficient", "sufficient", "not_applicable"]);
  assert.ok(ontology.temporal.includes("past"));
  assert.ok(ontology.epistemic.includes("hypothesis"));
  assert.ok(ontology.practical.includes("committed"));
  assert.deepEqual(ontology.architecture.layers.map(layer => layer.id), [
    "icare", "state_time", "evaluation_modality", "epistemic_provenance", "practical_status", "proposition_relations"
  ]);
  assert.ok(ontology.temporal_qualifiers.valid_time);
  assert.ok(ontology.evaluation.includes("preferred"));
  assert.ok(ontology.modality.includes("necessary"));
  assert.ok(ontology.epistemic.includes("reported"));
  assert.ok(ontology.epistemic.includes("observed"));
  assert.ok(ontology.proposition_model.optional.includes("predicate"));
  assert.ok(ontology.relations.includes("target_state_of"));
  assert.ok(ontology.proposition_model.required.includes("source"));
  assert.match(ontology.proposition_model.confidenceSemantics, /certitude exprimée par la source/);
  assert.ok(ontology.reference_frameworks.some(item => item.name === "PROV-O"));
  assert.ok(ontology.reference_frameworks.every(item => typeof item.url === "string" && item.url.startsWith("https://")));
  assert.ok(ontology.reference_frameworks.some(item => item.name === "Allen interval algebra"));
});


test("ICARE exposes a manual proposal path independent of model tool-calling", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(server.includes('url.pathname === "/api/propositions"'));
  assert.ok(server.includes("recordCandidate({"));
  assert.ok(ui.includes('id="proposalForm"'));
  assert.ok(ui.includes("Enregistrer la proposition"));
  assert.ok(ui.includes('fetch("/api/propositions"'));
});

test("ICARE verifies custom tools after the Pi session has been created", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.ok(server.includes('await import("typebox")'));
  assert.ok(server.includes("session.getActiveToolNames()"));
  assert.ok(server.includes("await created.session.bindExtensions({})"));
  assert.ok(server.includes("session.setActiveToolsByName(ICARE_TOOL_NAMES)"));
  assert.ok(server.includes('toolInitializationStatus = "ready"'));
  assert.ok(server.includes('toolInitializationStatus = "failed"'));
  assert.ok(server.includes("toolDefinitions: [...activeIcareTools]"));
  for (const name of ["list_available_models", "get_ontology", "get_exploration_state", "search_reference_documents", "list_propositions", "propose_observation", "propose_relation"]) {
    assert.ok(server.includes(`name: "${name}"`));
    assert.ok(server.includes("exposure: \"direct\""));
  }
  assert.ok(!server.includes("pi.setActiveTools(icareToolNames)"));
});

test("Exploration dimensions require an explicit save action", async () => {
  const ui = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(ui.includes('save.textContent="Enregistrer"'));
  assert.ok(ui.includes("Justification (requise pour"));
  assert.ok(!ui.includes('sel.addEventListener("change",async()=>{const rr=await fetch("/api/dimensions/'));
});


test("Proposal registry keeps accepted, pending and rejected records visible", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(server.includes('SELECT * FROM propositions ORDER BY created_at DESC'));
  assert.ok(!server.includes('propositions: getPropositions().filter(p => p.review_status === "candidate")'));
  for (const id of ["acceptedPropositions", "candidatePropositions", "rejectedPropositions"]) {
    assert.ok(ui.includes('id="' + id + '"'));
  }
  assert.ok(ui.includes('id="rejectedPropositions"'));
  assert.ok(ui.includes('id="acceptedCount"'));
  assert.ok(ui.includes('id="candidateCount"'));
  assert.ok(ui.includes('id="rejectedCount"'));
});

test("Exploration dimension writes are checked by reading persisted state back", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.ok(server.includes("result.changes !== 1"));
  assert.ok(server.includes('SELECT code,status,justification,updated_at FROM dimensions WHERE code=?'));
  assert.ok(server.includes("persisted.status !== body.status"));
});


test("Projects isolate proposals, relations and the five exploration dimensions", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE project_dimensions(project_id TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(project_id,code));
    CREATE TABLE proposals(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, text TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO projects VALUES(?,?)").run("p1","Projet 1");
  db.prepare("INSERT INTO projects VALUES(?,?)").run("p2","Projet 2");
  for (const projectId of ["p1","p2"]) {
    for (const code of ["I","C","A","R","E"]) db.prepare("INSERT INTO project_dimensions VALUES(?,?,?)").run(projectId,code,"unexplored");
  }
  db.prepare("INSERT INTO proposals VALUES(?,?,?)").run("a","p1","Observation A");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_dimensions WHERE project_id=?").get("p1").n,5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE project_id=?").get("p2").n,0);
  db.close();
});

test("Project API, discussion history and temporal snapshots are persisted", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS projects',
    'CREATE TABLE IF NOT EXISTS project_dimensions',
    'CREATE TABLE IF NOT EXISTS conversation_turns',
    'CREATE TABLE IF NOT EXISTS exploration_snapshots',
    'url.pathname === "/api/projects"',
    'url.pathname === "/api/timeline"',
    'recordSnapshot(projectId, sessionId, turnIndex)',
    'WHERE project_id=?'
  ]) assert.ok(server.includes(fragment), "Missing project persistence contract: " + fragment);
  assert.ok(server.includes("appendSystemPromptOverride"));
  assert.ok(ui.includes('id="projectSelect"'));
  assert.ok(ui.includes('id="createProject"'));
  assert.ok(ui.includes('id="timelineSlider"'));
  assert.ok(ui.includes('id="radarArea"'));
  assert.ok(ui.includes("renderConversation(projectTurns.filter"));
});
