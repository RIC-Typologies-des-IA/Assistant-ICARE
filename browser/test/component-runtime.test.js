import test from "node:test";
import assert from "node:assert/strict";
import { createComponentRuntime, authorizeManifest } from "../component-runtime.js";

const manifest = {
  componentId: "icare:test/component",
  version: "1.0.0",
  displayName: "Test",
  requiredCapabilities: []
};
const registry = { schemaVersion: 1, components: [{ id: "sample", componentId: "icare:test/component", entrypoint: "./components/sample/sample.js", world: "component-base", requiredCapabilities: [] }] };

function runtime({ described = manifest, grants = [], invoke } = {}) {
  return createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => registry }),
    importModule: async () => ({
      lifecycle: {
        describe: () => described,
        invoke: invoke || (async request => ({
          correlationId: request.correlationId,
          payloadJson: JSON.stringify({ accepted: true })
        }))
      }
    }),
    grants: { sample: grants }
  });
}

test("loads a registered lifecycle component and correlates invocations", async () => {
  const component = await runtime().load("sample");
  assert.equal(component.manifest.componentId, manifest.componentId);
  assert.deepEqual(await component.invoke("inspect", { value: 42 }, "correlation-1"), { accepted: true });
});

test("denies a capability that was not granted by the host policy", async () => {
  const host = await runtime({ described: { ...manifest, requiredCapabilities: ["model-inference"] } });
  await assert.rejects(host.load("sample"), /Capacités ICARE refusées : model-inference/);
});

test("rejects unknown capabilities instead of silently granting them", () => {
  assert.throws(
    () => authorizeManifest({ ...manifest, requiredCapabilities: ["network-anywhere"] }, ["network-anywhere"]),
    /Capacité inconnue ou non prise en charge/
  );
});

test("a component cannot expand its capabilities beyond the registry declaration", async () => {
  const host = await runtime({ described: { ...manifest, requiredCapabilities: ["model-inference"] }, grants: ["model-inference"] });
  await assert.rejects(host.load("sample"), /capacités du manifeste diffèrent du registre ICARE/);
});

test("rejects malformed manifests and oversized payloads", async () => {
  assert.throws(() => authorizeManifest({ ...manifest, requiredCapabilities: "model-inference" }), /requiredCapabilities/);
  const host = await runtime();
  const component = await host.load("sample");
  await assert.rejects(component.invoke("large", { value: "x".repeat(300_000) }), /Payload de composant trop volumineux/);
});

test("rejects responses with a mismatched correlation identifier", async () => {
  const host = await runtime({ invoke: async () => ({ correlationId: "wrong", payloadJson: "{}" }) });
  const component = await host.load("sample");
  await assert.rejects(component.invoke("inspect", {}, "expected"), /corrélation incohérente/);
});

test("injects project context only through a granted WIT host import", async () => {
  const context = JSON.stringify({ projectId: "project-1", dimensionCount: 5 });
  let suppliedContext;
  const host = createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      schemaVersion: 1,
      components: [{
        id: "context-summary",
        componentId: "icare:context/summary",
        entrypoint: "./components/context-summary/context-summary.js",
        world: "component-with-context",
        requiredCapabilities: ["context-read"]
      }]
    }) }),
    importModule: async () => ({
      instantiate: async (_getCoreModule, imports) => {
        suppliedContext = imports["icare:component/context-api"].getProjectContext();
        return {
          lifecycle: {
            describe: () => ({
              componentId: "icare:context/summary",
              version: "0.1.0",
              displayName: "Context",
              requiredCapabilities: ["context-read"]
            }),
            invoke: async request => ({
              correlationId: request.correlationId,
              payloadJson: JSON.stringify({ context: JSON.parse(suppliedContext) })
            })
          }
        };
      }
    }),
    grants: { "context-summary": ["context-read"] },
    contextProvider: () => context
  });
  const component = await host.load("context-summary");
  assert.deepEqual(await component.invoke("read-project-context", {}, "context-1"), {
    context: { projectId: "project-1", dimensionCount: 5 }
  });
});

test("does not instantiate a context component without an explicit host grant", async () => {
  let instantiated = false;
  const host = createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      schemaVersion: 1,
      components: [{
        id: "context-summary",
        componentId: "icare:context/summary",
        entrypoint: "./components/context-summary/context-summary.js",
        world: "component-with-context",
        requiredCapabilities: ["context-read"]
      }]
    }) }),
    importModule: async () => ({ instantiate: async () => { instantiated = true; return {}; } })
  });
  await assert.rejects(host.load("context-summary"), /Capacités ICARE refusées : context-read/);
  assert.equal(instantiated, false);
});

test("registry cannot grant a capability absent from the component WIT world", async () => {
  const host = createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      schemaVersion: 1,
      components: [{
        id: "sample",
        componentId: "icare:test/component",
        entrypoint: "./components/sample/sample.js",
        world: "component-base",
        requiredCapabilities: ["context-read"]
      }]
    }) })
  });
  await assert.rejects(host.load("sample"), /registre demande une capacité absente du monde WIT/);
});

test("rejects registry paths that escape the component namespace", async () => {
  const host = createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      schemaVersion: 1,
      components: [{ id: "sample", entrypoint: "../app.js", world: "component-base", requiredCapabilities: [] }]
    }) })
  });
  await assert.rejects(host.load("sample"), /Point d'entrée hors du répertoire/);
});


test("commits scoped storage writes only after a successful component invocation", async () => {
  let persisted = { note: "before" };
  let imports;
  const host = createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      schemaVersion: 1,
      components: [{
        id: "storage-probe",
        componentId: "icare:storage/probe",
        entrypoint: "./components/storage-probe/storage-probe.js",
        world: "component-with-storage",
        requiredCapabilities: ["project-storage-read", "project-storage-write"]
      }]
    }) }),
    importModule: async () => ({
      instantiate: async (_getCoreModule, hostImports) => {
        imports = hostImports["icare:component/project-storage-api"];
        return { lifecycle: {
          describe: () => ({
            componentId: "icare:storage/probe",
            version: "0.1.0",
            displayName: "Storage",
            requiredCapabilities: ["project-storage-read", "project-storage-write"]
          }),
          invoke: async request => {
            const payload = JSON.parse(request.payloadJson);
            if (request.operation === "write") imports.write(payload.key, payload.value);
            if (request.operation === "write-then-fail") {
              imports.write(payload.key, payload.value);
              throw new Error("guest trap");
            }
            return { correlationId: request.correlationId, payloadJson: JSON.stringify({ value: imports.read(payload.key) }) };
          }
        }};
      }
    }),
    grants: { "storage-probe": ["project-storage-read", "project-storage-write"] },
    storageProvider: () => persisted,
    storageCommit: async (_id, next) => { persisted = next; }
  });
  const component = await host.load("storage-probe");
  await component.invoke("write", { key: "memo", value: "saved" });
  assert.equal(persisted.memo, "saved");
  await assert.rejects(component.invoke("write-then-fail", { key: "memo", value: "corrupted" }), /guest trap/);
  assert.equal(persisted.memo, "saved");
  assert.equal((await component.invoke("read", { key: "memo" })).value, "saved");
});

test("serializes storage-backed invocations to prevent transaction cross-talk", async () => {
  let persisted = {};
  let active = null;
  const host = createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      schemaVersion: 1,
      components: [{ id: "storage-probe", componentId: "icare:storage/probe", entrypoint: "./components/storage-probe/storage-probe.js", world: "component-with-storage", requiredCapabilities: ["project-storage-read", "project-storage-write"] }]
    }) }),
    importModule: async () => ({
      instantiate: async (_getCoreModule, hostImports) => {
        active = hostImports["icare:component/project-storage-api"];
        return { lifecycle: {
          describe: () => ({ componentId: "icare:storage/probe", version: "0.1.0", displayName: "Storage", requiredCapabilities: ["project-storage-read", "project-storage-write"] }),
          invoke: async request => {
            const p = JSON.parse(request.payloadJson);
            active.write(p.key, p.value);
            await new Promise(resolve => setTimeout(resolve, 5));
            return { correlationId: request.correlationId, payloadJson: JSON.stringify({ ok: true }) };
          }
        }};
      }
    }),
    grants: { "storage-probe": ["project-storage-read", "project-storage-write"] },
    storageProvider: () => persisted,
    storageCommit: async (_id, next) => { persisted = next; }
  });
  const component = await host.load("storage-probe");
  await Promise.all([
    component.invoke("write", { key: "first", value: "1" }),
    component.invoke("write", { key: "second", value: "2" })
  ]);
  assert.deepEqual(persisted, { first: "1", second: "2" });
});
