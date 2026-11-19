import test from "node:test";
import assert from "node:assert/strict";
import {
  addORSet, assignMVRegister, compareVersionVectors, createMVRegister, createORSet,
  mergeMVRegisters, mergeORSets, mergeVersionVectors, nextDot, readMVRegister,
  readORSet, removeORSet
} from "../src/collaboration/crdt.js";

test("version vectors distinguish causality from concurrency", () => {
  assert.equal(compareVersionVectors({ a: 1 }, { a: 2 }), "before");
  assert.equal(compareVersionVectors({ a: 2 }, { a: 1 }), "after");
  assert.equal(compareVersionVectors({ a: 1 }, { b: 1 }), "concurrent");
  assert.equal(compareVersionVectors({ a: 1 }, { a: 1 }), "equal");
  assert.deepEqual(mergeVersionVectors({ a: 1, b: 1 }, { a: 2, c: 1 }), { a: 2, b: 1, c: 1 });
  assert.deepEqual(nextDot("a", { a: 4, b: 2 }), { replicaId: "a", counter: 5 });
});

test("MV-register preserves concurrent semantic alternatives and resolves causal succession", () => {
  const empty = createMVRegister();
  const left = assignMVRegister(empty, { text: "hypothèse A" }, { replicaId: "phone", counter: 1 }, {});
  const right = assignMVRegister(empty, { text: "hypothèse B" }, { replicaId: "desktop", counter: 1 }, {});
  const concurrent = mergeMVRegisters(left, right);
  assert.deepEqual(readMVRegister(concurrent), [{ text: "hypothèse A" }, { text: "hypothèse B" }]);

  const later = assignMVRegister(concurrent, { text: "hypothèse C" },
    { replicaId: "phone", counter: 2 }, { phone: 1, desktop: 1 });
  assert.deepEqual(readMVRegister(later), [{ text: "hypothèse C" }]);
  assert.deepEqual(mergeMVRegisters(left, right), mergeMVRegisters(right, left));
});

test("MV-register merge is associative, commutative and idempotent", () => {
  const base = createMVRegister();
  const a = assignMVRegister(base, "A", { replicaId: "a", counter: 1 }, {});
  const b = assignMVRegister(base, "B", { replicaId: "b", counter: 1 }, {});
  const c = assignMVRegister(base, "C", { replicaId: "c", counter: 1 }, {});
  assert.deepEqual(mergeMVRegisters(a, b), mergeMVRegisters(b, a));
  assert.deepEqual(mergeMVRegisters(mergeMVRegisters(a, b), c), mergeMVRegisters(a, mergeMVRegisters(b, c)));
  assert.deepEqual(mergeMVRegisters(a, a), a);
});

test("OR-set removes observed adds but does not erase a concurrent re-add", () => {
  const empty = createORSet();
  const first = addORSet(empty, "observation-1", { replicaId: "phone", counter: 1 });
  const concurrentAdd = addORSet(empty, "observation-1", { replicaId: "desktop", counter: 1 });
  const removed = removeORSet(first, "observation-1");
  const merged = mergeORSets(removed, concurrentAdd);
  assert.deepEqual(readORSet(merged), ["observation-1"]);
  assert.deepEqual(mergeORSets(removed, concurrentAdd), mergeORSets(concurrentAdd, removed));
});

test("OR-set merge is idempotent and rejects dot collisions", () => {
  const a = addORSet(createORSet(), { id: "x" }, { replicaId: "a", counter: 1 });
  assert.deepEqual(mergeORSets(a, a), a);
  assert.throws(() => mergeORSets(a,
    addORSet(createORSet(), { id: "y" }, { replicaId: "a", counter: 1 })), /Collision/);
});
