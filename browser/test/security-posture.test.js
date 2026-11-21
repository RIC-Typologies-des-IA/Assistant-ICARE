import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chatCompletionsEndpoint, audioTranscriptionsEndpoint } from "../inference.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("security contract is explicit and machine-readable", async () => {
  const policy = JSON.parse(await read("../security-policy.json"));
  assert.equal(policy.modelVersion, "1.0.0");
  assert.equal(policy.invariants.projectDataHasNoRemotePersistence, true);
  assert.equal(policy.invariants.credentialsPersistedOutsideSession, false);
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

test("frontend never persists provider credentials or loads the logo from a third-party origin", async () => {
  const [app, html] = await Promise.all([read("../app.js"), read("../index.html")]);
  assert.match(app, /sessionStorage\.setItem\("icare-api-key"/);
  assert.match(app, /apiKey:"",rememberKey:false/);\n  assert.match(app, /id:"inference",apiKey:"",rememberKey:false/);\n  assert.match(app, /persistedTextKey/);
  assert.doesNotMatch(app, /apiKey:remember\?key:""/);
  assert.doesNotMatch(html, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(html, /id="remember-key"|id="remember-transcription-key"/);
});
