importScripts("./version.js");
const CACHE=`icare-browser-${self.ICARE_VERSION}`;const FILES=["./","./index.html","./styles.css","./app.js","./agent.js","./storage.js","./inference.js","./icon.svg","./manifest.webmanifest","./version.js","./system-prompt.md","./guide-icare.md","./icare.json"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=="GET")return;e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok&&u.pathname.includes("/browser/"))caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r;})));});
