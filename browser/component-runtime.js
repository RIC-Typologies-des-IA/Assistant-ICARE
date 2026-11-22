const KNOWN_CAPABILITIES = new Set([
  "context-read",
  "context-write",
  "project-storage-read",
  "project-storage-write",
  "component-messaging",
  "model-inference",
  "audio-transcription",
  "tool-execution"
]);
const MAX_PAYLOAD_BYTES = 256 * 1024;
const WORLD_CAPABILITIES = Object.freeze({
  "component-base": new Set(),
  "component-with-context": new Set(["context-read"])
});
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("Manifeste WASI absent ou invalide.");
  for (const field of ["componentId", "version", "displayName"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
      throw new Error("Champ de manifeste obligatoire invalide : " + field);
    }
  }
  if (!Array.isArray(manifest.requiredCapabilities)) throw new Error("Le manifeste doit déclarer requiredCapabilities.");
  const requested = [...new Set(manifest.requiredCapabilities)];
  for (const capability of requested) {
    if (typeof capability !== "string" || !KNOWN_CAPABILITIES.has(capability)) {
      throw new Error("Capacité inconnue ou non prise en charge : " + String(capability));
    }
  }
  return { ...manifest, requiredCapabilities: requested };
}

function assertJsonPayload(value) {
  if (typeof value !== "string") throw new TypeError("Le payload WIT doit être une chaîne JSON.");
  if (new TextEncoder().encode(value).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("Payload de composant trop volumineux (limite 256 Kio).");
  }
  try { JSON.parse(value); } catch { throw new Error("Le payload du composant n'est pas un JSON valide."); }
}

export function authorizeManifest(manifest, grants = []) {
  const checked = assertManifest(manifest);
  if (!Array.isArray(grants)) throw new Error("La politique de capacités hôte doit être une liste.");
  const granted = new Set(grants);
  const denied = checked.requiredCapabilities.filter(capability => !granted.has(capability));
  if (denied.length) {
    throw new Error("Capacités ICARE refusées : " + denied.join(", "));
  }
  return Object.freeze({ ...checked, requiredCapabilities: Object.freeze([...checked.requiredCapabilities]) });
}

export function createComponentRuntime({
  baseUrl = new URL("./", import.meta.url),
  fetchImpl = fetch,
  importModule = specifier => import(specifier),
  grants = {},
  contextProvider = () => null
} = {}) {
  const instances = new Map();
  let registryPromise;

  async function registry() {
    if (!registryPromise) {
      registryPromise = fetchImpl(new URL("components/registry.json", baseUrl), { cache: "no-cache" })
        .then(response => {
          if (!response.ok) throw new Error("Registre des composants indisponible (" + response.status + ").");
          return response.json();
        })
        .then(data => {
          if (data?.schemaVersion !== 1 || !Array.isArray(data.components)) throw new Error("Version du registre de composants non prise en charge.");
          const ids = new Set();
          for (const item of data.components) {
            if (!item || !ID_PATTERN.test(item.id) || ids.has(item.id)) throw new Error("Identifiant de composant invalide ou dupliqué.");
            if (!WORLD_CAPABILITIES[item.world]) throw new Error("Monde WIT non autorisé dans cette version du runtime.");
            if (!Array.isArray(item.requiredCapabilities)) throw new Error("Le registre doit épingler les capacités demandées.");
            if (item.requiredCapabilities.some(capability => !WORLD_CAPABILITIES[item.world].has(capability))) {
              throw new Error("Le registre demande une capacité absente du monde WIT.");
            }
            if (item.entrypoint !== "./components/" + item.id + "/" + item.id + ".js") {
              throw new Error("Point d'entrée hors du répertoire de composants autorisé.");
            }
            ids.add(item.id);
          }
          return new Map(data.components.map(item => [item.id, item]));
        });
    }
    return registryPromise;
  }

  async function load(id) {
    if (!ID_PATTERN.test(id)) throw new Error("Identifiant de composant invalide.");
    if (instances.has(id)) return instances.get(id);
    const entries = await registry();
    const entry = entries.get(id);
    if (!entry) throw new Error("Composant absent du registre : " + id);
    const moduleUrl = new URL(entry.entrypoint.slice(2), baseUrl);
    const requested = authorizeManifest({
      componentId: entry.componentId,
      version: entry.version || "0.1.0",
      displayName: entry.displayName || entry.id,
      requiredCapabilities: entry.requiredCapabilities
    }, grants[id] || []);
    const module = await importModule(moduleUrl.href);
    let componentExports = module;
    if (typeof module.instantiate === "function") {
      const imports = {};
      if (entry.world === "component-with-context") {
        imports["icare:component/context-api"] = {
          getProjectContext() {
            const value = contextProvider();
            if (value === null || value === undefined) return null;
            if (typeof value !== "string") throw new Error("Le contexte fourni à WASI doit être une chaîne JSON.");
            assertJsonPayload(value);
            return value;
          }
        };
      }
      const getCoreModule = async path => {
        const response = await fetchImpl(new URL(path, moduleUrl), { cache: "force-cache" });
        if (!response.ok) throw new Error("Module Wasm core indisponible (" + response.status + ").");
        return WebAssembly.compile(await response.arrayBuffer());
      };
      componentExports = await module.instantiate(getCoreModule, imports);
    }
    const lifecycle = componentExports.lifecycle || componentExports["icare:component/lifecycle@0.1.0"]?.lifecycle || componentExports["icare:component/lifecycle@0.1.0"];
    if (!lifecycle || typeof lifecycle.describe !== "function" || typeof lifecycle.invoke !== "function") {
      throw new Error("Le composant ne respecte pas le contrat lifecycle WIT.");
    }
    const described = lifecycle.describe();
    if (described?.componentId !== entry.componentId) throw new Error("L'identifiant du manifeste ne correspond pas au registre ICARE.");
    const manifest = authorizeManifest(described, grants[id] || []);
    if (JSON.stringify([...manifest.requiredCapabilities].sort()) !== JSON.stringify([...requested.requiredCapabilities].sort())) {
      throw new Error("Les capacités du manifeste diffèrent du registre ICARE.");
    }
    const instance = Object.freeze({
      manifest,
      async invoke(operation, payload = {}, correlationId = crypto.randomUUID()) {
        if (typeof operation !== "string" || !operation.trim()) throw new Error("Opération de composant obligatoire.");
        const payloadJson = JSON.stringify(payload);
        assertJsonPayload(payloadJson);
        const result = await lifecycle.invoke({ correlationId, operation, payloadJson });
        if (!result || result.correlationId !== correlationId || typeof result.payloadJson !== "string") {
          throw new Error("Réponse du composant invalide ou corrélation incohérente.");
        }
        assertJsonPayload(result.payloadJson);
        return JSON.parse(result.payloadJson);
      }
    });
    instances.set(id, instance);
    return instance;
  }

  return Object.freeze({ load, list: async () => [...(await registry()).values()].map(({ id, world }) => ({ id, world })) });
}
