import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
  try {
    await mkdir(dir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = dir;
    await writeFile(path.join(dir, "models.json"), JSON.stringify({
      providers: {
        lemonade: {
          name: "Lemonade local",
          baseUrl: "http://127.0.0.1:13305/v1",
          api: "openai-completions",
          models: [{
            id: "test-chat-model", name: "Test chat model",
            input: ["text"], reasoning: false,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192, maxTokens: 1024
          }]
        }
      }
    }));
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create();
    const model = runtime.getModel("lemonade", "test-chat-model");
    assert.ok(model);
    assert.equal(model.provider, "lemonade");
    assert.equal(model.id, "test-chat-model");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
