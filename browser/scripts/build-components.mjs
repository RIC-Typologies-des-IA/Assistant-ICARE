import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const browserRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const components = [
  { id: "ontology-validator", source: "../component-model/examples/ontology-validator/ontology-validator.js", world: "component-base" },
  { id: "context-summary", source: "../component-model/examples/context-summary/context-summary.js", world: "component-with-context", instantiation: true }
];
for (const component of components) await mkdir(resolve(browserRoot, "components", component.id), { recursive: true });

function run(args) {
  const result = spawnSync("npx", ["--no-install", "jco", ...args], {
    cwd: browserRoot,
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Échec de jco " + args[0] + " (code " + result.status + ").");
}

for (const component of components) {
  run([
    "componentize",
    component.source,
    "--wit", "../component-model/wit/icare-component.wit",
    "--world-name", component.world || "component-base",
    "--disable", "all",
    "-o", "components/" + component.id + "/" + component.id + ".wasm"
  ]);
  run(["transpile", "components/" + component.id + "/" + component.id + ".wasm", ...(component.instantiation ? ["--instantiation", "async"] : []), "-o", "components/" + component.id]);
  for (const file of [component.id + ".js", component.id + ".core.wasm"]) {
    await access(resolve(browserRoot, "components", component.id, file));
  }
}
console.log("WASI components built and browser-transpiled: " + components.map(item => item.id).join(", "));
