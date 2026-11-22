importScripts("./version.js");
const CACHE=`icare-browser-${self.ICARE_VERSION}`;
const FILES=["./","./index.html","./styles.css","./app.js","./pwa.js","./markdown.js","./agent.js","./workspace-tools.js","./theme.js","./storage.js","./credentials.js","./inference.js","./icon.svg","./manifest.webmanifest","./version.js","./system-prompt.md","./guide-icare.md","./icare.json","./vendor/markdown-it.min.js","./vendor/purify.min.js"];
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
  if(request.mode==="navigate"||APP_SHELL.has(url.pathname)){
    event.respondWith(fetch(new Request(request,{cache:"no-cache"})).then(response=>{
      if(response.ok)event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,response.clone())));
      return response;
    }).catch(()=>caches.match(request).then(cached=>cached||caches.match(new URL("./index.html",self.registration.scope).href))));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok)event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,response.clone())));
    return response;
  })));
});
