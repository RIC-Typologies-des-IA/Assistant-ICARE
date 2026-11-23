import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("gateway configuration exposes three independent services and three gateways",async()=>{const html=await readFile(new URL("../index.html",import.meta.url),"utf8");assert.match(html,/route-llm/);assert.match(html,/route-audio/);assert.match(html,/route-scoring/);for(let n=1;n<=3;n++){assert.match(html,new RegExp("gateway-card-"+n));assert.match(html,new RegExp("gateway-"+n+"-llm"));assert.match(html,new RegExp("gateway-"+n+"-audio"));assert.match(html,new RegExp("gateway-"+n+"-scoring"));}});
test("gateway config documents the two-service threshold",async()=>{const module=await readFile(new URL("../gateway-config.js",import.meta.url),"utf8");assert.match(module,/capabilities.length===3/);assert.match(module,/capabilities.length>=2/);assert.match(module,/inference-gateway-config/);});
