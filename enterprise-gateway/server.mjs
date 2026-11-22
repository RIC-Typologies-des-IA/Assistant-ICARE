import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const DEFAULT_CONFIG = new URL("./config.json", import.meta.url);
const MAX_CONFIG_BYTES = 1024 * 1024;

export async function loadConfig(path = process.env.ICARE_GATEWAY_CONFIG || DEFAULT_CONFIG) {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) throw new Error("Gateway config is too large.");
  const config = JSON.parse(raw);
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Missing gateway configuration.");
  if (!config.listen || !Number.isInteger(config.listen.port) || config.listen.port < 1 || config.listen.port > 65535) {
    throw new Error("listen.host and a valid listen.port are required.");
  }
  if (!Array.isArray(config.cors?.allowedOrigins) || !config.cors.allowedOrigins.length) {
    throw new Error("At least one exact CORS allowed origin is required.");
  }
  for (const origin of config.cors.allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin) throw new Error("Allowed origins must be exact HTTPS origins.");
  }
  const identityHeader = String(config.auth?.identityHeader || "").toLowerCase();
  if (!/^x-[a-z0-9-]+$/.test(identityHeader)) throw new Error("A trusted reverse-proxy identityHeader is required.");
  if (!Array.isArray(config.models) || !config.models.length) throw new Error("At least one model must be configured.");
  const ids = new Set();
  for (const model of config.models) {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(model.id || "") || ids.has(model.id)) throw new Error("Model IDs must be unique safe identifiers.");
    ids.add(model.id);
    const upstream = new URL(model.upstreamBaseUrl);
    if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.search || upstream.hash) {
      throw new Error("Provider upstreamBaseUrl must be a credential-free HTTPS base URL.");
    }
    if (!/^ICARE_[A-Z0-9_]+$/.test(model.apiKeyEnv || "")) throw new Error("Each provider requires an ICARE_* apiKeyEnv variable.");
    if (!Array.isArray(model.capabilities) || !model.capabilities.length ||
        model.capabilities.some(capability => !["chat", "transcription"].includes(capability))) {
      throw new Error("Model capabilities must be chat and/or transcription.");
    }
    if (!String(model.upstreamModel || "").trim()) throw new Error("upstreamModel is required.");
  }
  const limits = config.limits || {};
  if (limits.requestsPerMinute !== undefined && (!Number.isInteger(limits.requestsPerMinute) || limits.requestsPerMinute < 1)) {
    throw new Error("limits.requestsPerMinute must be a positive integer.");
  }
  return config;
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function applyCors(req, res, config) {
  const origin = req.headers.origin;
  if (!origin || !config.cors.allowedOrigins.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
  return true;
}

function readBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request body exceeds the configured size limit."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function multipartFields(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw Object.assign(new Error("A valid multipart boundary is required."), { status: 400 });
  const boundary = Buffer.from("--" + (boundaryMatch[1] || boundaryMatch[2]).trim());
  const parts = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer.subarray(cursor, cursor + 2).toString() === "--") break;
    if (buffer.subarray(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const next = buffer.indexOf(boundary, cursor);
    if (next === -1) break;
    let part = buffer.subarray(cursor, next);
    if (part.subarray(-2).toString() === "\r\n") part = part.subarray(0, -2);
    const separator = part.indexOf(Buffer.from("\r\n\r\n"));
    if (separator < 0) { cursor = next; continue; }
    const headers = part.subarray(0, separator).toString("utf8");
    const disposition = /content-disposition:\s*form-data;[^\r\n]*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headers);
    if (disposition) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() || "application/octet-stream";
      parts.push({ name: disposition[1], filename: disposition[2], type, data: part.subarray(separator + 4) });
    }
    cursor = next;
  }
  return parts;
}

function createRateLimiter(limit) {
  const buckets = new Map();
  return user => {
    const now = Date.now();
    const bucket = buckets.get(user) || { start: now, count: 0 };
    if (now - bucket.start >= 60_000) { bucket.start = now; bucket.count = 0; }
    bucket.count++;
    buckets.set(user, bucket);
    return bucket.count <= limit;
  };
}

function modelFor(config, id, capability) {
  const model = config.models.find(candidate => candidate.id === id && candidate.capabilities.includes(capability));
  if (!model) throw Object.assign(new Error("The requested model or capability is not enabled by this enterprise gateway."), { status: 403 });
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey) throw Object.assign(new Error("The administrator has not configured credentials for this provider."), { status: 503 });
  return { ...model, apiKey };
}

async function upstreamFetch(model, suffix, options, config) {
  const base = model.upstreamBaseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.limits?.timeoutMs || 90_000);
  try {
    return await fetch(base + suffix, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function createGatewayServer(config) {
  validateConfig(config);
  const allowRequest = createRateLimiter(config.limits?.requestsPerMinute || 60);
  return createServer(async (req, res) => {
    try {
      if (!applyCors(req, res, config)) {
        json(res, 403, { error: { message: "Origin not allowed by this enterprise gateway." } });
        return;
      }
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
      const path = new URL(req.url, "http://gateway.invalid").pathname;
      if (req.method === "GET" && path === "/healthz") { json(res, 200, { status: "ok", service: "icare-enterprise-gateway" }); return; }
      const user = String(req.headers[String(config.auth.identityHeader).toLowerCase()] || "").trim();
      if (!user || user.length > 256 || /[\r\n]/.test(user)) {
        json(res, 401, { error: { message: "An authenticated enterprise identity is required. Configure the trusted authentication reverse proxy." } });
        return;
      }
      if (!allowRequest(user)) { json(res, 429, { error: { message: "Enterprise gateway request quota exceeded." } }); return; }

      if (req.method === "GET" && path === "/v1/models") {
        json(res, 200, { object: "list", data: config.models.map(model => ({ id: model.id, object: "model", owned_by: "icare-enterprise", labels: model.capabilities })) });
        return;
      }

      if (req.method === "POST" && path === "/v1/chat/completions") {
        const body = await readBody(req, config.limits?.maxJsonBytes || 2 * 1024 * 1024);
        let payload;
        try { payload = JSON.parse(body.toString("utf8")); } catch { json(res, 400, { error: { message: "Invalid JSON request." } }); return; }
        if (!Array.isArray(payload.messages) || payload.stream === true) {
          json(res, 400, { error: { message: "messages must be an array; streaming is not enabled by this gateway version." } }); return;
        }
        const model = modelFor(config, payload.model, "chat");
        const forwarded = { ...payload, model: model.upstreamModel, stream: false };
        const upstream = await upstreamFetch(model, "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + model.apiKey },
          body: JSON.stringify(forwarded)
        }, config);
        const text = await upstream.text();
        res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json", "Cache-Control": "no-store" });
        res.end(text);
        return;
      }

      if (req.method === "POST" && path === "/v1/audio/transcriptions") {
        const body = await readBody(req, config.limits?.maxAudioBytes || 25 * 1024 * 1024);
        const parts = multipartFields(body, req.headers["content-type"]);
        const modelPart = parts.find(part => part.name === "model");
        const filePart = parts.find(part => part.name === "file" && part.filename !== undefined);
        if (!modelPart || !filePart || !filePart.data.length) {
          json(res, 400, { error: { message: "A model field and non-empty audio file are required." } }); return;
        }
        const model = modelFor(config, modelPart.data.toString("utf8").trim(), "transcription");
        const form = new FormData();
        form.append("model", model.upstreamModel);
        form.append("file", new File([filePart.data], filePart.filename || "audio.bin", { type: filePart.type }));
        const upstream = await upstreamFetch(model, "/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: "Bearer " + model.apiKey },
          body: form
        }, config);
        const text = await upstream.text();
        res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json", "Cache-Control": "no-store" });
        res.end(text);
        return;
      }

      json(res, 404, { error: { message: "Route not found." } });
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 502, { error: { message: error.status ? error.message : "The upstream provider is unavailable or timed out." } });
      else res.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = await loadConfig();
  const server = createGatewayServer(config);
  server.listen(config.listen.port, config.listen.host, () => {
    process.stdout.write(`ICARE Enterprise Gateway listening on ${config.listen.host}:${config.listen.port}\n`);
  });
}
