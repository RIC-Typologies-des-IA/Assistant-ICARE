importScripts("./version.js");
const CACHE=`icare-browser-${self.ICARE_VERSION}-${self.ICARE_BUILD_ID||"dev"}`;
const FILES=["./","./index.html","./styles.css","./app.js","./experiments.js","./workflow-engine.js","./workflow.json","./gateway-config.js","./scoring.js","./scoring-payload.json","./pwa.js","./component-runtime.js","./components/registry.json","./security-policy.json","./components/ontology-validator/ontology-validator.js","./components/ontology-validator/ontology-validator.core.wasm","./components/context-summary/context-summary.js","./components/context-summary/context-summary.core.wasm","./components/storage-probe/storage-probe.js","./components/storage-probe/storage-probe.core.wasm","./markdown.js","./agent.js","./workspace-tools.js","./theme.js","./storage.js","./credentials.js","./inference.js","./ric-logo.png","./manifest.webmanifest","./version.js","./system-prompt.md","./guide-icare.md","./icare-referentiel.md","./icare.json","./laboratory.js","./laboratory-catalog.json","./lab-sources/ICARE_instructions_standard.md","./lab-sources/ICARE_instructions_locale.md","./lab-sources/ICARE_prompt_web_compact.md","./lab-sources/ICARE_referentiel.md","./lab-sources/enterprise-gateway-config.example.json","./lab-sources/README.md","./vendor/markdown-it.min.js","./vendor/purify.min.js","./vendor/highlight.min.js","./vendor/pdf.mjs","./vendor/pdf.worker.mjs","./vendor/tesseract.min.js","./vendor/tesseract-worker.min.js","./vendor/tesseract-core/tesseract-core.wasm.js","./vendor/tesseract-core/tesseract-core-simd.wasm.js","./vendor/tesseract-core/tesseract-core-lstm.wasm.js","./vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js","./vendor/tessdata/fra.traineddata.gz"];
const APP_SHELL=new Set(["/","/index.html","/styles.css","/app.js","/pwa.js","/version.js"]);
self.addEventListener("install",event=>event.waitUntil(
  caches.open(CACHE)
    .then(cache=>cache.addAll(FILES.map(file=>new Request(new URL(file,self.registration.scope),{cache:"reload"}))))
    .then(()=>self.skipWaiting())
));
self.addEventListener("activate",event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith("icare-browser-")&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));
self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(url.origin!==location.origin||request.method!=="GET")return;
  if(!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  const relativePath="/"+url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if(request.mode==="navigate"||APP_SHELL.has(relativePath)){
    event.respondWith(fetch(new Request(request,{cache:"no-cache"})).then(response=>{
      if(!response.ok)return response;
      return caches.open(CACHE).then(cache=>cache.put(request,response.clone())).then(()=>response);
    }).catch(()=>caches.match(request).then(cached=>cached||caches.match(new URL("./index.html",self.registration.scope).href))));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(!response.ok)return response;
    return caches.open(CACHE).then(cache=>cache.put(request,response.clone())).then(()=>response);
  })));
});
