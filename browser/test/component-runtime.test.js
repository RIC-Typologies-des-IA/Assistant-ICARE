import test from "node:test";
import assert from "node:assert/strict";
import { createComponentRuntime, authorizeManifest } from "../component-runtime.js";

const manifest = {
  componentId: "icare:test/component",
  version: "1.0.0",
  displayName: "Test",
  requiredCapabilities: []
};
const registry = { schemaVersion: 1, components: [{ id: "sample", componentId: "icare:test/component", entrypoint: "./components/sample/sample.js", world: "component-base" }] };

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

test("component-base cannot claim capabilities because its WIT world has no imports", async () => {
  const host = await runtime({ described: { ...manifest, requiredCapabilities: ["model-inference"] }, grants: ["model-inference"] });
  await assert.rejects(host.load("sample"), /component-base ne déclare aucun import de capacité/);
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

test("rejects registry paths that escape the component namespace", async () => {
  const host = createComponentRuntime({
    baseUrl: new URL("https://icare.invalid/"),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      schemaVersion: 1,
      components: [{ id: "sample", entrypoint: "../app.js", world: "component-base" }]
    }) })
  });
  await assert.rejects(host.load("sample"), /Point d'entrée hors du répertoire/);
});
