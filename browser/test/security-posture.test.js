import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chatCompletionsEndpoint, audioTranscriptionsEndpoint, chatCompletion, resolveInferenceRoute } from "../inference.js";
import { webcrypto } from "node:crypto";
import { loadCredentialVault, saveCredentialVault, migrateLegacyCredentials } from "../credentials.js";
globalThis.crypto ||= webcrypto;

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("security contract is explicit and machine-readable", async () => {
  const policy = JSON.parse(await read("../security-policy.json"));
  assert.equal(policy.modelVersion, "1.0.0");
  assert.equal(policy.invariants.projectDataHasNoRemotePersistence, true);
  assert.equal(policy.invariants.credentialsStoredOnlyEncrypted, true);
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

test("enterprise gateway requests can include the enterprise SSO session without a provider key", async () => {
  let captured;
  await chatCompletion({ baseUrl: "https://gateway.example", model: "managed-model", apiKey: "", credentials: "include", messages: [{ role: "user", content: "hello" }], fetchImpl: async (url, options) => { captured = { url, options }; return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }); } });
  assert.equal(captured.url, "https://gateway.example/v1/chat/completions");
  assert.equal(captured.options.credentials, "include");
  assert.equal(captured.options.headers.Authorization, undefined);
});

test("the selected gateway route resolves without a provider key and includes SSO cookies",()=>{
 const target=resolveInferenceRoute({kind:"text",routing:{text:"gateway",audio:"local"},gateways:{text:"https://gateway.example.org"},gatewayModels:{text:"managed-chat"}});
 assert.deepEqual(target,{baseUrl:"https://gateway.example.org",model:"managed-chat",apiKey:"",credentials:"include",route:"gateway"});
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
  await saveCredentialVault(db, { text: "sk-text-secret", audio: "sk-audio-secret", scoring: "sk-scoring-secret" });
  const persisted = [...records.values()];
  assert.ok(persisted.some(record => record.id === "credential-encryption-key-v1" && record.key.extractable === false));
  const vault = persisted.find(record => record.id === "credential-vault-v1");
  assert.ok(vault);
  assert.doesNotMatch(JSON.stringify(vault), /sk-text-secret|sk-audio-secret|sk-scoring-secret/);
  assert.deepEqual(await loadCredentialVault(db), { text: "sk-text-secret", audio: "sk-audio-secret", scoring: "sk-scoring-secret" });
});

test("legacy plaintext API keys are migrated into the encrypted vault", async () => {
  const records = new Map([
    ["inference-text", { id: "inference-text", baseUrl: "https://api.example/v1", model: "model-a", apiKey: "legacy-text-key" }],
    ["inference-transcription", { id: "inference-transcription", baseUrl: "https://speech.example/v1", model: "whisper", apiKey: "legacy-audio-key" }]
  ]);
  const db = { transaction() { return { objectStore() { return {
    get(key) { const request = {}; queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); }); return request; },
    put(value) { const request = {}; queueMicrotask(() => { records.set(value.id, value); request.result = value.id; request.onsuccess?.(); }); return request; }
  }; } }; } };
  const migrated = await migrateLegacyCredentials(db, { text: "legacy-text-key", audio: "legacy-audio-key" });
  assert.deepEqual(migrated, { text: "legacy-text-key", audio: "legacy-audio-key", scoring: "" });
  const vault = records.get("credential-vault-v1");
  assert.ok(vault.text && vault.audio);
  assert.doesNotMatch(JSON.stringify(vault), /legacy-text-key|legacy-audio-key/);
});

test("frontend uses the encrypted vault and never stores API keys in plaintext settings", async () => {
  const [app, html, wit] = await Promise.all([read("../app.js"), read("../index.html"), read("../../component-model/wit/icare-component.wit")]);
  assert.ok(app.includes("saveCredentialVault(db"));
  assert.match(app, /resolveInferenceRoute/);
  assert.match(app, /inference-gateways/);
  assert.match(html, /gateway-shared-url/);
  assert.match(html, /gateway-text-url/);
  assert.match(html, /gateway-audio-url/);
  assert.match(html, /route-scoring/);
  assert.match(html, /gateway-3-scoring/);
  assert.match(html, /direct-scoring-key/);
  assert.ok(app.includes("scoreIcareMultilabel"));
  assert.ok(app.includes("scoringApiKey"));
  assert.ok(app.includes("migrateLegacyCredentials(db"));
  assert.ok(app.includes('sessionStorage.removeItem("icare-api-key"'));
  assert.ok(!app.includes('sessionStorage.setItem("icare-api-key"'));
  assert.ok(!html.includes("raw.githubusercontent.com"));
  assert.ok(!html.includes("router.huggingface.co"), "aucun endpoint d’inférence Hugging Face distant ne doit être proposé");
  assert.ok(html.includes("AES-GCM"));
  assert.ok(wit.includes("world component-base"));
  assert.ok(wit.includes("export lifecycle"));
  assert.ok(wit.includes("interface inference-api"));
  assert.doesNotMatch(wit, /api-key|authorization/i, "le contrat WIT ne doit jamais exposer de secret fournisseur");
});

test("the RIC logo is used consistently as banner, browser favicon and PWA icon", async () => {
  const [html, manifestText, sw, logo] = await Promise.all([
    read("../index.html"),
    read("../manifest.webmanifest"),
    read("../sw.js"),
    readFile(new URL("../ric-logo.png", import.meta.url))
  ]);
  const manifest = JSON.parse(manifestText);
  assert.ok(html.includes('class="ric-logo" src="./ric-logo.png"'), "le logo RIC doit rester dans la bannière");
  assert.ok(html.includes('<link rel="icon" type="image/png" sizes="118x125" href="./ric-logo.png">'), "ric-logo.png doit être le favicon du navigateur");
  assert.ok(html.includes('<link rel="apple-touch-icon" href="./ric-logo.png">'), "ric-logo.png doit être l’icône Apple");
  assert.doesNotMatch(html, /favicon\.svg|icon\.svg/i, "aucune ancienne icône SVG ne doit être référencée");
  assert.equal(manifest.icons.length, 1, "la PWA doit déclarer une icône de marque unique");
  assert.equal(manifest.icons[0].src, "./ric-logo.png");
  assert.equal(manifest.icons[0].type, "image/png");
  assert.equal(manifest.icons[0].sizes, "118x125");
  assert.ok(sw.includes('"./ric-logo.png"'), "le Service Worker doit précacher l’icône utilisée partout");
  assert.ok(!sw.includes("favicon.svg"), "aucun ancien favicon SVG ne doit être précaché");
  assert.ok(!sw.includes('"./icon.svg"'), "l’ancienne icône ne doit plus être précachée");
  assert.ok(logo.byteLength > 1000, "le fichier ric-logo.png doit être présent");
});
