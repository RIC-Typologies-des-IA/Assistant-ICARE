import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const browserRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(browserRoot, "components/hello");
await mkdir(output, { recursive: true });

function run(args) {
  const result = spawnSync("npx", ["--no-install", "jco", ...args], {
    cwd: browserRoot,
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Échec de jco " + args[0] + " (code " + result.status + ").");
}

run([
  "componentize",
  "../component-model/examples/hello/hello.js",
  "--wit", "../component-model/wit/icare-component.wit",
  "--world-name", "component-base",
  "--disable", "all",
  "-o", "components/hello/hello.wasm"
]);
run(["transpile", "components/hello/hello.wasm", "-o", "components/hello"]);

for (const file of ["hello.js", "hello.core.wasm"]) {
  await access(resolve(output, file));
}
console.log("WASI component built and browser-transpiled: hello");
