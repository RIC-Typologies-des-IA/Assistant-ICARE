const NAME="icare-browser",VERSION=1;
export function openDatabase(){return new Promise((resolve,reject)=>{const r=indexedDB.open(NAME,VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("projects"))d.createObjectStore("projects",{keyPath:"id"});if(!d.objectStoreNames.contains("turns")){const s=d.createObjectStore("turns",{keyPath:"id"});s.createIndex("projectId","projectId");}if(!d.objectStoreNames.contains("settings"))d.createObjectStore("settings",{keyPath:"id"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function run(db,store,mode,fn){return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),r=fn(tx.objectStore(store));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.onabort=()=>reject(tx.error);});}
export const get=(db,s,k)=>run(db,s,"readonly",o=>o.get(k));
export const getAll=(db,s)=>run(db,s,"readonly",o=>o.getAll());
export const put=(db,s,v)=>run(db,s,"readwrite",o=>o.put(v));
