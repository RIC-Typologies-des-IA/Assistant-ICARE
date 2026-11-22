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
  const result = await page.evaluate(async () => {
    const { createComponentRuntime } = await import("./component-runtime.js");
    const runtime = createComponentRuntime();
    const component = await runtime.load("hello");
    return {
      manifest: component.manifest,
      output: await component.invoke("greet", { name: "ICARE" }, "browser-smoke-1")
    };
  });
  assert.equal(result.manifest.componentId, "icare:example/hello");
  assert.deepEqual(result.manifest.requiredCapabilities, []);
  assert.match(result.output.message, /Bonjour ICARE depuis un composant WebAssembly/);
  assert.deepEqual(errors, []);
  console.log("WASI browser smoke test passed: component loaded, lifecycle invoked, and output returned.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
