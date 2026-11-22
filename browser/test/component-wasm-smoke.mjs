import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm"
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch { res.writeHead(404).end("Not found"); }
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port + "/");
  const validator = await (await page.evaluate(async () => {
    const { createComponentRuntime } = await import("./component-runtime.js");
    const component = await createComponentRuntime().load("ontology-validator");
    return {
      manifest: component.manifest,
      valid: await component.invoke("validate-observation", {
        observation: { text: "Observation", dimensions: ["I", "R"], primary_dimension: "I", epistemic: "reported", confidence: 0.8, source: "conversation" },
        vocabularies: {
          temporal: ["past", "present", "future", "unknown"],
          evaluation: ["desired", "undesired", "feared", "preferred", "unfavorable", "neutral", "unknown"],
          modality: ["possible", "impossible", "necessary", "permitted", "forbidden", "unknown"],
          epistemic: ["observed", "asserted", "reported", "inferred", "hypothesis", "predicted", "unknown"],
          practical: ["considered", "proposed", "decided", "committed", "in_progress", "completed", "abandoned", "unspecified"]
        }
      }),
      relation: await component.invoke("validate-relation", {
        relation: { from_id: "p1", to_id: "p2", relation: "revises" },
        existingProposalIds: ["p1", "p2"],
        allowedRelations: ["complements", "revises"]
      }),
      invalidRelation: await component.invoke("validate-relation", {
        relation: { from_id: "p1", to_id: "p1", relation: "revises" },
        existingProposalIds: ["p1", "p2"],
        allowedRelations: ["complements", "revises"]
      }),
      status: await component.invoke("validate-exploration-status", {
        status: { dimension: "C", status: "sufficient", justification: "Éléments suffisants." },
        vocabularies: { dimensions: ["I", "C", "A", "R", "E"], explorationStatuses: ["unexplored", "insufficient", "sufficient", "not_applicable"] }
      }),
      invalidStatus: await component.invoke("validate-exploration-status", {
        status: { dimension: "C", status: "sufficient", justification: "" },
        vocabularies: { dimensions: ["I", "C", "A", "R", "E"], explorationStatuses: ["unexplored", "insufficient", "sufficient", "not_applicable"] }
      }),
      invalid: await component.invoke("validate-observation", {
        observation: { text: "Observation", dimensions: ["I"], primary_dimension: "E", epistemic: "reported", confidence: 1.4, source: "conversation" },
        vocabularies: {
          temporal: ["past", "present", "future", "unknown"],
          evaluation: ["desired", "undesired", "feared", "preferred", "unfavorable", "neutral", "unknown"],
          modality: ["possible", "impossible", "necessary", "permitted", "forbidden", "unknown"],
          epistemic: ["observed", "asserted", "reported", "inferred", "hypothesis", "predicted", "unknown"],
          practical: ["considered", "proposed", "decided", "committed", "in_progress", "completed", "abandoned", "unspecified"]
        }
      })
    };
  }));
  assert.equal(validator.manifest.componentId, "icare:ontology/validator");
  assert.equal(validator.valid.valid, true);
  assert.equal(validator.valid.normalized.primary_dimension, "I");
  assert.equal(validator.invalid.valid, false);
  assert.equal(validator.relation.valid, true);
  assert.equal(validator.invalidRelation.valid, false);
  assert.equal(validator.status.valid, true);
  assert.equal(validator.invalidStatus.valid, false);
  assert.ok(validator.invalid.errors.some(error => error.includes("dimension principale")));
  assert.ok(validator.invalid.errors.some(error => error.includes("confiance")));
  assert.deepEqual(errors, []);
  console.log("WASI browser smoke test passed: lifecycle, ontology validation, and explicit context-read host import.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
