import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayServer, validateConfig } from "../server.mjs";

const config = {
  listen: { host: "127.0.0.1", port: 8787 },
  cors: { allowedOrigins: ["https://icare.example.org"] },
  auth: { identityHeader: "x-icare-authenticated-user", groupsHeader: "x-icare-authenticated-groups" },
  limits: { requestsPerMinute: 10, maxJsonBytes: 4096, maxAudioBytes: 4096, timeoutMs: 1000 },
  defaults: { chatModel: "small-chat" },
  models: [{ id: "small-chat", provider: "test", upstreamBaseUrl: "https://provider.example/v1", upstreamModel: "real-small", apiKeyEnv: "ICARE_TEST_KEY", capabilities: ["chat"], allowedGroups: ["research"] }]
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

test("gateway returns only defaults visible to the authenticated group", async t => {
  const server = createGatewayServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const denied = await fetch(url + "/v1/icare/config", { headers: { Origin: "https://icare.example.org", "X-ICARE-Authenticated-User": "alice", "X-ICARE-Authenticated-Groups": "staff" } });
  assert.equal((await denied.json()).defaults.chatModel, "");
  const allowed = await fetch(url + "/v1/icare/config", { headers: { Origin: "https://icare.example.org", "X-ICARE-Authenticated-User": "alice", "X-ICARE-Authenticated-Groups": "research" } });
  assert.equal((await allowed.json()).defaults.chatModel, "small-chat");
});

test("gateway exposes only configured models to an authenticated user", async t => {
  const server = createGatewayServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const denied = await fetch(url + "/v1/models", { headers: { Origin: "https://icare.example.org", "X-ICARE-Authenticated-User": "alice", "X-ICARE-Authenticated-Groups": "staff" } });
  assert.equal((await denied.json()).data.length, 0, "un membre hors du groupe autorisé ne doit pas voir le modèle");
  const response = await fetch(url + "/v1/models", { headers: { Origin: "https://icare.example.org", "X-ICARE-Authenticated-User": "alice", "X-ICARE-Authenticated-Groups": "research" } });
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

test("gateway maps a public alias to the admin provider model and never forwards client credentials", async t => {
  const server = createGatewayServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const originalFetch = globalThis.fetch;
  process.env.ICARE_TEST_KEY = "server-side-secret";
  let captured;
  globalThis.fetch = async (url, options) => { captured = { url: String(url), options, payload: JSON.parse(options.body) }; return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    const url = "http://127.0.0.1:" + server.address().port;
    const response = await originalFetch(url + "/v1/chat/completions", {
      method: "POST",
      headers: { Origin: "https://icare.example.org", "X-ICARE-Authenticated-User": "alice", "X-ICARE-Authenticated-Groups": "research", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "small-chat", apiKey: "attacker-controlled-value", messages: [{ role: "user", content: "hello" }] })
    });
    assert.equal(response.status, 200);
    assert.equal(captured.url, "https://provider.example/v1/chat/completions");
    assert.equal(captured.options.headers.Authorization, "Bearer server-side-secret");
    assert.equal(captured.payload.model, "real-small");
    assert.equal("apiKey" in captured.payload, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ICARE_TEST_KEY;
  }
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

test("gateway runs multilabel scoring locally without provider credentials or network inference", async t => {
  const scoringModel = { id: "horizon", provider: "local", runtime: "transformers-js", modelId: "Horizon-Labs/multilingual-zeroshot-base", capabilities: ["scoring"] };
  const scoringConfig = { ...config, auth: { ...config.auth, allowLoopbackWithoutIdentity: true }, defaults: { ...config.defaults, scoringModel: "horizon" }, models: [...config.models, scoringModel] };
  let received;
  const server = createGatewayServer(scoringConfig, { localScorer: async args => { received=args; return { scores:{I:.8,C:.7,A:.6,R:.5,E:.4}, labels:["I","C","A","R","E"] }; } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url="http://127.0.0.1:"+server.address().port;
  const origin="https://icare.example.org";
  const configResponse=await fetch(url+"/v1/icare/config",{headers:{Origin:origin,"X-ICARE-Authenticated-User":"alice"}});
  assert.equal((await configResponse.json()).defaults.scoringModel,"horizon");
  const response=await fetch(url+"/v1/icare/scoring",{method:"POST",headers:{Origin,"Content-Type":"application/json"},body:JSON.stringify({model:"horizon",text:"Bonjour, nous révisons notre stratégie.",multi_label:true,labels:["I","C","A","R","E"].map(code=>({code,label:code,description:"Dimension "+code}))})});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).scores,{I:.8,C:.7,A:.6,R:.5,E:.4});
  assert.equal(received.text,"Bonjour, nous révisons notre stratégie.");
  assert.equal(received.modelId,"Horizon-Labs/multilingual-zeroshot-base");
  const unauthenticatedChat=await fetch(url+"/v1/chat/completions",{method:"POST",headers:{Origin,"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:"hello"}]})});
  assert.equal(unauthenticatedChat.status,401,"l’accès loopback anonyme doit rester limité au scoring local");
});
test("gateway rejects malformed scoring requests", async t => {
  const server=createGatewayServer(config);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch("http://127.0.0.1:"+server.address().port+"/v1/icare/scoring",{method:"POST",headers:{Origin:"https://icare.example.org","X-ICARE-Authenticated-User":"alice","Content-Type":"application/json"},body:JSON.stringify({text:"Bonjour",multi_label:false,labels:[]})});
  assert.equal(response.status,400);
});
