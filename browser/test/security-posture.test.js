import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chatCompletionsEndpoint, audioTranscriptionsEndpoint } from "../inference.js";
import { webcrypto } from "node:crypto";
import { loadCredentialVault, saveCredentialVault } from "../credentials.js";
globalThis.crypto ||= webcrypto;

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("security contract is explicit and machine-readable", async () => {
  const policy = JSON.parse(await read("../security-policy.json"));
  assert.equal(policy.modelVersion, "1.0.0");
  assert.equal(policy.invariants.projectDataHasNoRemotePersistence, true);
  assert.equal(policy.invariants.credentialsPersistedOutsideSession, true);
  assert.equal(policy.invariants.credentialsEncryptedAtRest, true);
  assert.equal(policy.invariants.encryptionKeyNonExtractable, true);
  assert.equal(policy.invariants.remoteInferenceRequiresHttps, true);
  assert.equal(policy.assurance.notAComplianceCertification, true);
});

test("remote inference endpoints require HTTPS", () => {
  assert.equal(chatCompletionsEndpoint("https://inference.example/v1"), "https://inference.example/v1/chat/completions");
  assert.equal(audioTranscriptionsEndpoint("https://speech.example/v1"), "https://speech.example/v1/audio/transcriptions");
  assert.throws(() => chatCompletionsEndpoint("http://inference.example/v1"), /HTTPS est obligatoire/);
  assert.throws(() => audioTranscriptionsEndpoint("http://speech.example/v1"), /HTTPS est obligatoire/);
});

test("HTTP is restricted to loopback inference services", () => {
  assert.equal(chatCompletionsEndpoint("http://localhost:11434/v1"), "http://localhost:11434/v1/chat/completions");
  assert.equal(chatCompletionsEndpoint("http://127.0.0.1:13305/v1"), "http://127.0.0.1:13305/v1/chat/completions");
  assert.equal(chatCompletionsEndpoint("http://[::1]:11434/v1"), "http://[::1]:11434/v1/chat/completions");
  assert.throws(() => chatCompletionsEndpoint("http://192.168.1.20:11434/v1"), /HTTPS est obligatoire/);
});

test("credentials cannot be smuggled in endpoint URLs", () => {
  assert.throws(() => chatCompletionsEndpoint("https://alice:secret@inference.example/v1"), /identifiants ne doivent pas être intégrés/);
});

test("provider credentials are encrypted at rest and survive reloads", async () => {
  const records = new Map();
  const db = { transaction() { return { objectStore() { return {
    get(key) { const request = {}; queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); }); return request; },
    put(value) { const request = {}; queueMicrotask(() => { records.set(value.id, value); request.result = value.id; request.onsuccess?.(); }); return request; }
  }; } }; } };
  await saveCredentialVault(db, { text: "sk-text-secret", audio: "sk-audio-secret" });
  const persisted = [...records.values()];
  assert.ok(persisted.some(record => record.id === "credential-encryption-key-v1" && record.key.extractable === false));
  const vault = persisted.find(record => record.id === "credential-vault-v1");
  assert.ok(vault);
  assert.doesNotMatch(JSON.stringify(vault), /sk-text-secret|sk-audio-secret/);
  assert.deepEqual(await loadCredentialVault(db), { text: "sk-text-secret", audio: "sk-audio-secret" });
});

test("frontend uses the encrypted vault and never stores API keys in plaintext settings", async () => {
  const [app, html] = await Promise.all([read("../app.js"), read("../index.html")]);
  assert.match(app, /saveCredentialVault\\(db/);
  assert.match(app, /migrateLegacyCredentials\\(db/);
  assert.match(app, /sessionStorage\\.removeItem\\("icare-api-key"/);
  assert.doesNotMatch(app, /sessionStorage\\.setItem\\("icare-api-key"/);
  assert.doesNotMatch(html, /raw\\.githubusercontent\\.com/);
  assert.match(html, /AES-GCM/);
});
