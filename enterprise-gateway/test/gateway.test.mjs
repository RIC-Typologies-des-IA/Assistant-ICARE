import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayServer, validateConfig } from "../server.mjs";

const config = {
  listen: { host: "127.0.0.1", port: 8787 },
  cors: { allowedOrigins: ["https://icare.example.org"] },
  auth: { identityHeader: "x-icare-authenticated-user" },
  limits: { requestsPerMinute: 10, maxJsonBytes: 4096, maxAudioBytes: 4096, timeoutMs: 1000 },
  models: [{ id: "small-chat", provider: "test", upstreamBaseUrl: "https://provider.example/v1", upstreamModel: "real-small", apiKeyEnv: "ICARE_TEST_KEY", capabilities: ["chat"] }]
};

test("gateway configuration rejects unsafe origins and upstream URLs", () => {
  assert.throws(() => validateConfig({ ...config, cors: { allowedOrigins: ["*"] } }));
  assert.throws(() => validateConfig({ ...config, models: [{ ...config.models[0], upstreamBaseUrl: "http://provider.example/v1" }] }));
  assert.throws(() => validateConfig({ ...config, auth: { identityHeader: "authorization" } }));
});

test("gateway denies requests without an authenticated reverse-proxy identity", async t => {
  const server = createGatewayServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/v1/models", { headers: { Origin: "https://icare.example.org" } });
  assert.equal(response.status, 401);
});

test("gateway exposes only configured models to an authenticated user", async t => {
  const server = createGatewayServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/v1/models", { headers: { Origin: "https://icare.example.org", "X-ICARE-Authenticated-User": "alice" } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.map(model => model.id), ["small-chat"]);
});

test("gateway refuses origins not on the exact allowlist", async t => {
  const server = createGatewayServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/v1/models", { headers: { Origin: "https://evil.example" } });
  assert.equal(response.status, 403);
});

test("gateway rejects unconfigured models before any provider call", async t => {
  const server = createGatewayServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/v1/chat/completions", {
    method: "POST",
    headers: { Origin: "https://icare.example.org", "X-ICARE-Authenticated-User": "alice", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "not-published", messages: [{ role: "user", content: "hello" }] })
  });
  assert.equal(response.status, 403);
});
