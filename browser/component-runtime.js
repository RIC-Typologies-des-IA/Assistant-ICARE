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
  "component-with-context": new Set(["context-read"]),
  "component-with-storage": new Set(["project-storage-read", "project-storage-write"])
});
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STORAGE_KEY_PATTERN = /^(?!__proto__$|prototype$|constructor$)[a-zA-Z0-9._:-]{1,128}$/;
const MAX_STORAGE_BYTES = 256 * 1024;

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
  contextProvider = () => null,
  storageProvider = () => ({}),
  storageCommit = async () => {}
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
    let activeStorage = null;
    if (typeof module.instantiate === "function") {
      const imports = {};
      if (entry.world === "component-with-storage") {
        const storageBinding = {
          read(key) {
            if (!requested.requiredCapabilities.includes("project-storage-read")) throw new Error("Capacité project-storage-read non accordée.");
            if (!activeStorage) throw new Error("Transaction de stockage inactive.");
            if (typeof key !== "string" || !STORAGE_KEY_PATTERN.test(key)) throw new Error("Clé de stockage ICARE invalide.");
            const value = activeStorage[key];
            return typeof value === "string" ? value : null;
          },
          write(key, value) {
            if (!requested.requiredCapabilities.includes("project-storage-write")) throw new Error("Capacité project-storage-write non accordée.");
            if (!activeStorage) throw new Error("Transaction de stockage inactive.");
            if (typeof key !== "string" || !STORAGE_KEY_PATTERN.test(key)) throw new Error("Clé de stockage ICARE invalide.");
            if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 65536) throw new Error("Valeur de stockage ICARE invalide ou trop volumineuse.");
            const previousBytes = Object.hasOwn(activeStorage, key) ? new TextEncoder().encode(activeStorage[key]).byteLength : 0;
            const nextBytes = Object.entries(activeStorage).reduce((total, [storedKey, storedValue]) => total + new TextEncoder().encode(storedKey).byteLength + new TextEncoder().encode(storedValue).byteLength, 0) - previousBytes + new TextEncoder().encode(key).byteLength + new TextEncoder().encode(value).byteLength;
            if (nextBytes > MAX_STORAGE_BYTES) throw new Error("Espace de stockage du composant supérieur à 256 Kio.");
            activeStorage[key] = value;
          }
        };
        imports["icare:component/project-storage-api@0.1.0"] = storageBinding;
        imports["icare:component/project-storage-api"] = storageBinding;
      }
      if (entry.world === "component-with-context") {
        const contextBinding = {
          getProjectContext() {
            const value = contextProvider();
            if (value === null || value === undefined) return null;
            if (typeof value !== "string") throw new Error("Le contexte fourni à WASI doit être une chaîne JSON.");
            assertJsonPayload(value);
            return value;
          }
        };
        imports["icare:component/context-api@0.1.0"] = contextBinding;
        imports["icare:component/context-api"] = contextBinding;
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
    let invocationQueue = Promise.resolve();
    const invokeOnce = async (operation, payload = {}, correlationId = crypto.randomUUID()) => {
      if (typeof operation !== "string" || !operation.trim()) throw new Error("Opération de composant obligatoire.");
      const payloadJson = JSON.stringify(payload);
      assertJsonPayload(payloadJson);
      if (entry.world === "component-with-storage") {
        const snapshot = storageProvider(id);
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Instantané de stockage projet invalide.");
        activeStorage = Object.create(null);
        for (const [key, value] of Object.entries(snapshot)) {
          if (!STORAGE_KEY_PATTERN.test(key) || typeof value !== "string") throw new Error("Instantané de stockage projet invalide.");
          activeStorage[key] = value;
        }
        const snapshotBytes = Object.entries(activeStorage).reduce((total, [key, value]) => total + new TextEncoder().encode(key).byteLength + new TextEncoder().encode(value).byteLength, 0);
        if (snapshotBytes > MAX_STORAGE_BYTES) throw new Error("Instantané de stockage projet supérieur à 256 Kio.");
      }
      try {
        const result = await lifecycle.invoke({ correlationId, operation, payloadJson });
        if (!result || result.correlationId !== correlationId || typeof result.payloadJson !== "string") {
          throw new Error("Réponse du composant invalide ou corrélation incohérente.");
        }
        assertJsonPayload(result.payloadJson);
        const parsed = JSON.parse(result.payloadJson);
        if (entry.world === "component-with-storage" && requested.requiredCapabilities.includes("project-storage-write")) await storageCommit(id, { ...activeStorage });
        return parsed;
      } finally { activeStorage = null; }
    };
    const instance = Object.freeze({
      manifest,
      invoke(operation, payload = {}, correlationId = crypto.randomUUID()) {
        const pending = invocationQueue.then(() => invokeOnce(operation, payload, correlationId));
        invocationQueue = pending.then(() => undefined, () => undefined);
        return pending;
      }
    });
    instances.set(id, instance);
    return instance;
  }

  return Object.freeze({ load, list: async () => [...(await registry()).values()].map(({ id, world }) => ({ id, world })) });
}
