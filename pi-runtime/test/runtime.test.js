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
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create();
    const model = runtime.getModel("lemonade", "test-chat-model");
    assert.ok(model);
    assert.equal(model.provider, "lemonade");
    assert.equal(model.id, "test-chat-model");
    const { createAgentSession, SessionManager } = await import("@earendil-works/pi-coding-agent");
    const { session } = await createAgentSession({ model, modelRuntime: runtime, sessionManager: SessionManager.inMemory(), noTools: "builtin" });
    try {
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
  assert.ok(ontology.reference_frameworks.some(item => item.name === "Allen interval algebra"));
});
