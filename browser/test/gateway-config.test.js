import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("gateway configuration exposes three independent services and three gateways",async()=>{
 const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
 for(const id of ["llm","audio","scoring"])assert.match(html,new RegExp("route-"+id));
 for(let n=1;n<=3;n++){assert.match(html,new RegExp("gateway-card-"+n));for(const service of ["llm","audio","scoring"])assert.match(html,new RegExp("gateway-"+n+"-"+service));}
});
test("gateway cards follow the progressive one-then-two unassigned services rule",async()=>{
 const module=await readFile(new URL("../gateway-config.js",import.meta.url),"utf8");
 assert.match(module,/id===2&&firstCount<3/);assert.match(module,/id===3&&firstCount<2/);
 assert.match(module,/capabilities:id===1\?\[\.\.\.SERVICES\]:\[\]/);
});
