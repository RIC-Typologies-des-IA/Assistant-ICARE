import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".md":"text/markdown; charset=utf-8"};
let version="0.9.0";
const html=`<!doctype html><html><body><output id="version"></output><script type="module">
  import {registerAppServiceWorker} from "./pwa.js";
  const response=await fetch("./version.js",{cache:"no-store"});
  const source=await response.text();
  document.querySelector("#version").textContent=source.match(/"([^"]+)"/)?.[1]||"unknown";
  window.registration=await registerAppServiceWorker();
  const key="icare-pwa-reload-count";
  sessionStorage.setItem(key,String(Number(sessionStorage.getItem(key)||"0")+1));
  document.body.dataset.reloadCount=sessionStorage.getItem(key);
</script></body></html>`;
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
    res.setHeader("Cache-Control","no-store");
    if(pathname==="/"||pathname==="/index.html"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}).end(html);return;}
    if(pathname==="/version.js"){res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"}).end(`self.ICARE_VERSION = "${version}";`);return;}
    const file=resolve(root,"."+pathname);
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    const body=await readFile(file);
    res.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream"}).end(body);
  }catch{res.writeHead(404).end("Not found");}
});
await new Promise(resolveListen=>server.listen(0,"127.0.0.1",resolveListen));
const url="http://127.0.0.1:"+server.address().port+"/";
let browser;
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({serviceWorkers:"allow"});
  const page=await context.newPage();
  await page.goto(url);
  await page.waitForFunction(()=>document.querySelector("#version")?.textContent==="0.9.0");
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  assert.equal(await page.locator("body").getAttribute("data-reload-count"),"1","la première installation ne doit pas provoquer de rechargement inutile");

  version="0.9.1";
  await page.evaluate(()=>window.registration.update());
  await page.waitForFunction(()=>document.querySelector("#version")?.textContent==="0.9.1",{timeout:15000});
  assert.equal(await page.locator("body").getAttribute("data-reload-count"),"2","un worker mis à jour doit recharger automatiquement l'onglet une seule fois");
  assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller?.state),"activated","le nouvel onglet doit être contrôlé par le worker activé");
  await context.close();
  console.log("PWA update test passed: new worker detected, activated and client tab automatically reloaded.");
}finally{
  if(browser)await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
