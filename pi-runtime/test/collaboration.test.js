import test from "node:test";
import assert from "node:assert/strict";
import {
  createProjectEvent, createProjectManifest, createProjectUri, parseProjectUri,
  validateProjectEvent, validateProjectManifest
} from "../src/collaboration/project.js";

test("project URI is stable and round-trips opaque identifiers", () => {
  const id = "project:with spaces & symbols";
  const uri = createProjectUri(id);
  assert.equal(parseProjectUri(uri), id);
  assert.throws(() => parseProjectUri("https://example.test/project/123"));
  assert.throws(() => createProjectUri(""));
});

test("manifest is portable, versioned and preserves initial intent and context", () => {
  const manifest = createProjectManifest({
    id: "p-123", name: "Transition énergétique",
    created_at: "2026-11-18T10:00:00.000Z", updated_at: "2026-11-18T10:05:00.000Z"
  }, {
    description: "Atelier collectif",
    intention: "Comprendre les conditions de transition",
    context: { territory: "Bassin local", participants: ["A", "B"] },
    collaboration: { mode: "local-first", channel: "discord-channel-id" }
  });
  assert.equal(manifest.uri, "icare://project/p-123");
  assert.equal(manifest.intention, "Comprendre les conditions de transition");
  assert.deepEqual(manifest.context.participants, ["A", "B"]);
  assert.deepEqual(manifest.dimensions, ["I", "C", "A", "R", "E"]);
  assert.equal(validateProjectManifest(manifest).valid, true);
});

test("manifest validation rejects mismatched URI and non-canonical dimensions", () => {
  const manifest = createProjectManifest({ id: "p-1", name: "Projet" });
  manifest.uri = "icare://project/p-2";
  manifest.dimensions = ["I", "C", "A", "E", "R"];
  const result = validateProjectManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("correspondent")));
  assert.ok(result.errors.some(error => error.includes("I, C, A, R, E")));
});

test("event envelope carries actor, origin, causal context and is idempotently addressable", () => {
  const event = createProjectEvent({
    eventId: "event-1", projectId: "p-1", type: "observation.created",
    actor: { type: "human", id: "participant-1" },
    origin: "android",
    causalContext: { node: "device-a", sequence: 4 },
    payload: { observationId: "obs-1", text: "Une contribution" }
  });
  assert.equal(validateProjectEvent(event, "p-1").valid, true);
  assert.equal(validateProjectEvent(event, "p-2").valid, false);
  assert.equal(createProjectEvent({ ...event }).eventId, "event-1");
});

test("event validation rejects malformed payloads and missing identity", () => {
  const result = validateProjectEvent({ projectId: "p-1", payload: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 4);
});
