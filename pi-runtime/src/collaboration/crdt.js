/**
 * Small, transport-independent CRDT primitives for ICARE.
 *
 * These primitives preserve concurrent values; they do not decide whether
 * those values are semantically compatible. No wall-clock ordering is used.
 */

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validReplica = value => typeof value === "string" && value.trim().length > 0;
const dotKey = dot => `${dot.replicaId}:${dot.counter}`;

function assertDot(dot) {
  if (!isRecord(dot) || !validReplica(dot.replicaId) ||
      !Number.isSafeInteger(dot.counter) || dot.counter < 1) {
    throw new TypeError("Dot CRDT invalide.");
  }
}

export function normalizeVersionVector(vector = {}) {
  if (!isRecord(vector)) throw new TypeError("Un vecteur de versions doit être un objet.");
  const result = {};
  for (const [replica, counter] of Object.entries(vector)) {
    if (!validReplica(replica) || !Number.isSafeInteger(counter) || counter < 0) {
      throw new TypeError("Entrée invalide dans le vecteur de versions.");
    }
    if (counter > 0) result[replica] = counter;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

export function compareVersionVectors(left, right) {
  const a = normalizeVersionVector(left);
  const b = normalizeVersionVector(right);
  let less = false;
  let greater = false;
  for (const replica of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[replica] || 0;
    const bv = b[replica] || 0;
    if (av < bv) less = true;
    if (av > bv) greater = true;
  }
  if (!less && !greater) return "equal";
  if (less && !greater) return "before";
  if (!less && greater) return "after";
  return "concurrent";
}

export function mergeVersionVectors(...vectors) {
  const merged = {};
  for (const vector of vectors) {
    for (const [replica, counter] of Object.entries(normalizeVersionVector(vector))) {
      merged[replica] = Math.max(merged[replica] || 0, counter);
    }
  }
  return normalizeVersionVector(merged);
}

export function nextDot(replicaId, causalContext = {}) {
  if (!validReplica(replicaId)) throw new TypeError("replicaId est requis.");
  const context = normalizeVersionVector(causalContext);
  return { replicaId, counter: (context[replicaId] || 0) + 1 };
}

export function versionVectorSees(vector, dot) {
  assertDot(dot);
  return (normalizeVersionVector(vector)[dot.replicaId] || 0) >= dot.counter;
}

function assertEntry(entry) {
  if (!isRecord(entry)) throw new TypeError("Entrée CRDT invalide.");
  assertDot(entry.dot);
  normalizeVersionVector(entry.context);
  if (!Object.hasOwn(entry, "value")) throw new TypeError("Une entrée CRDT doit porter une valeur.");
}

function uniqueEntries(entries) {
  const byDot = new Map();
  for (const entry of entries) {
    assertEntry(entry);
    const key = dotKey(entry.dot);
    const previous = byDot.get(key);
    if (previous && canonical(previous) !== canonical(entry)) {
      throw new Error("Collision de dot CRDT avec des contenus différents : " + key);
    }
    byDot.set(key, structuredClone(entry));
  }
  return [...byDot.values()];
}

/**
 * Multi-value register: concurrent assignments are retained as siblings.
 * A causally later assignment supersedes only the values it has observed.
 */
export function createMVRegister() {
  return { type: "mv-register", version: 1, entries: [] };
}

export function assignMVRegister(state, value, dot, causalContext = {}) {
  if (!isRecord(state) || state.type !== "mv-register" || state.version !== 1 || !Array.isArray(state.entries)) {
    throw new TypeError("État MV-register invalide.");
  }
  assertDot(dot);
  const context = normalizeVersionVector(causalContext);
  if (versionVectorSees(context, dot)) throw new Error("Une affectation ne peut pas observer son propre dot.");
  const incoming = { dot: structuredClone(dot), context, value: structuredClone(value) };
  const entries = uniqueEntries([...state.entries, incoming]);
  const survivors = entries.filter(candidate =>
    !entries.some(other => dotKey(other.dot) !== dotKey(candidate.dot) &&
      versionVectorSees(other.context, candidate.dot))
  );
  return { type: "mv-register", version: 1, entries: survivors.sort((a, b) => dotKey(a.dot).localeCompare(dotKey(b.dot))) };
}

export function mergeMVRegisters(left, right) {
  for (const state of [left, right]) {
    if (!isRecord(state) || state.type !== "mv-register" || state.version !== 1 || !Array.isArray(state.entries)) {
      throw new TypeError("État MV-register invalide.");
    }
  }
  const entries = uniqueEntries([...left.entries, ...right.entries]);
  const survivors = entries.filter(candidate =>
    !entries.some(other => dotKey(other.dot) !== dotKey(candidate.dot) &&
      versionVectorSees(other.context, candidate.dot))
  );
  return { type: "mv-register", version: 1, entries: survivors.sort((a, b) => dotKey(a.dot).localeCompare(dotKey(b.dot))) };
}

export function readMVRegister(state) {
  if (!isRecord(state) || state.type !== "mv-register" || !Array.isArray(state.entries)) {
    throw new TypeError("État MV-register invalide.");
  }
  return state.entries.map(entry => structuredClone(entry.value));
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (isRecord(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

function assertORSet(state) {
  if (!isRecord(state) || state.type !== "or-set" || state.version !== 1 ||
      !Array.isArray(state.adds) || !Array.isArray(state.removed)) {
    throw new TypeError("État OR-set invalide.");
  }
  for (const add of state.adds) {
    assertDot(add.dot);
    if (!Object.hasOwn(add, "value")) throw new TypeError("Ajout OR-set sans valeur.");
  }
  for (const dot of state.removed) assertDot(dot);
}

/** Observed-remove set. Removes only the add-tags visible to that replica. */
export function createORSet() {
  return { type: "or-set", version: 1, adds: [], removed: [] };
}

export function addORSet(state, value, dot) {
  assertORSet(state);
  assertDot(dot);
  const adds = [...state.adds, { value: structuredClone(value), dot: structuredClone(dot) }];
  const byDot = new Map();
  for (const add of adds) {
    const key = dotKey(add.dot);
    const previous = byDot.get(key);
    if (previous && canonical(previous.value) !== canonical(add.value)) {
      throw new Error("Collision de dot OR-set avec des valeurs différentes : " + key);
    }
    byDot.set(key, add);
  }
  return { type: "or-set", version: 1, adds: [...byDot.values()].sort((a, b) => dotKey(a.dot).localeCompare(dotKey(b.dot))), removed: state.removed.map(x => structuredClone(x)) };
}

export function removeORSetObserved(state, value, observedDots) {
  assertORSet(state);
  if (!Array.isArray(observedDots)) throw new TypeError("Les dots observés doivent être un tableau.");
  const matching = new Map(state.adds.filter(add => canonical(add.value) === canonical(value)).map(add => [dotKey(add.dot), add.dot]));
  const observed = observedDots.map(dot => {
    assertDot(dot);
    const key = dotKey(dot);
    if (!matching.has(key)) throw new Error("Le retrait référence un ajout absent ou une valeur différente : " + key);
    return matching.get(key);
  });
  const removed = new Map([...state.removed, ...observed].map(dot => [dotKey(dot), structuredClone(dot)]));
  return { type: "or-set", version: 1, adds: state.adds.map(x => structuredClone(x)), removed: [...removed.values()].sort((a, b) => dotKey(a).localeCompare(dotKey(b))) };
}

export function removeORSet(state, value) {
  assertORSet(state);
  const key = canonical(value);
  const observed = state.adds.filter(add => canonical(add.value) === key).map(add => add.dot);
  return removeORSetObserved(state, value, observed);
}

export function mergeORSets(left, right) {
  assertORSet(left);
  assertORSet(right);
  const merged = createORSet();
  for (const add of [...left.adds, ...right.adds]) {
    const key = dotKey(add.dot);
    const previous = merged.adds.find(item => dotKey(item.dot) === key);
    if (previous && canonical(previous.value) !== canonical(add.value)) {
      throw new Error("Collision de dot OR-set avec des valeurs différentes : " + key);
    }
    if (!previous) merged.adds.push(structuredClone(add));
  }
  const removed = new Map([...left.removed, ...right.removed].map(dot => [dotKey(dot), structuredClone(dot)]));
  merged.adds.sort((a, b) => dotKey(a.dot).localeCompare(dotKey(b.dot)));
  merged.removed = [...removed.values()].sort((a, b) => dotKey(a).localeCompare(dotKey(b)));
  return merged;
}

export function readORSet(state) {
  assertORSet(state);
  const removed = new Set(state.removed.map(dotKey));
  const values = new Map();
  for (const add of state.adds) {
    if (!removed.has(dotKey(add.dot))) values.set(canonical(add.value), structuredClone(add.value));
  }
  return [...values.values()];
}
