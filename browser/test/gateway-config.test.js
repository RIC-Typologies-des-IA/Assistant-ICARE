import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("gateway configuration exposes three independent services and three gateways",async()=>{
 const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
 for(const id of ["llm","audio","scoring"])assert.match(html,new RegExp("route-"+id));
 assert.match(html,/direct-scoring-key/);
 for(let n=1;n<=3;n++){assert.match(html,new RegExp("gateway-card-"+n));for(const service of ["llm","audio","scoring"])assert.match(html,new RegExp("gateway-"+n+"-"+service));}
});
test("gateway cards follow the progressive one-then-two unassigned services rule",async()=>{
 const module=await readFile(new URL("../gateway-config.js",import.meta.url),"utf8");
 assert.match(module,/id===2&&firstCount<3/);assert.match(module,/id===3&&firstCount<2/);
 assert.match(module,/capabilities:id===1\?\[\.\.\.SERVICES\]:\[\]/);
});

test("settings expose mutually exclusive Direct and Gateway tabs without duplicate legacy controls",async()=>{
 const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
 const app=await readFile(new URL("../app.js",import.meta.url),"utf8");
 for(const id of ["settings-tab-direct","settings-tab-gateway","settings-panel-direct","settings-panel-gateway"])assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,"unique "+id);
 for(const id of ["text-route","audio-route","gateway-text-url","gateway-audio-url","same-gateway","gateway-shared-url"])assert.equal(html.includes('id="'+id+'"'),false,"legacy duplicate "+id+" must be removed");
 assert.match(app,/function setSettingsTab\(mode\)/);
 assert.match(app,/settings-panel-direct"\)\.hidden=gateway/);
 assert.match(app,/settings-panel-gateway"\)\.hidden=!gateway/);
});
test("gateway route choices only include gateways that declare the selected capability",async()=>{
 const module=await readFile(new URL("../gateway-config.js",import.meta.url),"utf8");
 assert.match(module,/if\(eligible\(service,id\)\)/);
 assert.doesNotMatch(module,/eligible\(service,id\)\|\|previous/);
});
