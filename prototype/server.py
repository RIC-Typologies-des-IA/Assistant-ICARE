#!/usr/bin/env python3
"""Standalone ICARE prototype with persistent exploration and document memory."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64, json, math, mimetypes, os, re, sqlite3, threading, urllib.request, uuid
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parent
DATA=ROOT/"data"; DOCS=DATA/"documents"; DB=DATA/"icare.sqlite3"; STATIC=ROOT/"static"
DOCS.mkdir(parents=True,exist_ok=True); STATIC.mkdir(parents=True,exist_ok=True)
OLLAMA_URL=os.environ.get("ICARE_OLLAMA_URL","").rstrip("/")
EMBED_MODEL=os.environ.get("ICARE_EMBED_MODEL","nomic-embed-text")
ONTOLOGY={"I":"Intention / finalité","C":"Contexte / situation","A":"Action / opération","R":"Régulation / organisation","E":"Évolution / temporalité"}
KEYWORDS={
"I":["objectif","but","finalité","intention","souhaite","souhaitons","voulons","veut","mission"],
"C":["contexte","situation","environnement","acteur","partie prenante","territoire","ressource","contrainte"],
"A":["action","agir","faire","opération","activité","processus","réalise","produit","intervention"],
"R":["organisation","régulation","règle","décision","gouvernance","responsabilité","coordination","centralis","autonomie","structure"],
"E":["évolution","évolue","change","transformation","avant","aujourd'hui","demain","désormais","progress","historique"]}
TEMPORAL=[("past",["avant","autrefois","auparavant","était","étaient","jadis"]),("present",["aujourd'hui","actuellement","désormais","maintenant","est","sont"]),("future",["demain","à terme","bientôt","sera","seront","prochain","envisageons"])]
EVALUATIVE=[("desired",["souhaite","souhaitons","voudrais","voudrions","veut","voulons","objectif","préférable","idéal"]),("undesired",["ne voulons plus","ne souhaite pas","indésirable","à éviter","refusons","problématique"]),("feared",["craignons","redoutons","risque de"])]
PRACTICAL=[("completed",["a été réalisé","avons réalisé","est terminé","a commencé"]),("committed",["avons décidé","avons engagé","nous allons","décision de"]),("proposed",["proposons","pourrait","on pourrait","envisageons"])]
EPISTEMIC=[("hypothesis",["peut-être","peut etre","probablement","supposons","hypothèse","il semble"]),("reported",["selon","d'après","d apres","on m'a dit","rapporté"])]

def now(): return datetime.now(timezone.utc).isoformat()
def db():
 c=sqlite3.connect(DB); c.row_factory=sqlite3.Row
 c.execute("""CREATE TABLE IF NOT EXISTS propositions(id TEXT PRIMARY KEY,text TEXT NOT NULL,dimensions TEXT NOT NULL,primary_dimension TEXT,temporal TEXT,evaluation TEXT,practical TEXT,epistemic TEXT,confidence REAL,source TEXT,created_at TEXT NOT NULL,aspect TEXT,relations TEXT NOT NULL DEFAULT '[]')""")
 c.execute("""CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,file_path TEXT,caption TEXT,created_at TEXT NOT NULL,embedding TEXT)""")
 c.commit(); return c
def first_match(text,groups,default):
 t=text.lower()
 for label,words in groups:
  if any(w in t for w in words): return label
 return default
def extract(text,source="human"):
 chunks=[x.strip(" \n\t-•") for x in re.split(r"(?<=[.!?])\s+|\n+",text) if x.strip(" \n\t-•")]
 out=[]
 for chunk in chunks:
  t=chunk.lower(); scores={d:sum(1 for w in ws if w in t) for d,ws in KEYWORDS.items()}
  ranked=sorted(scores,key=lambda d:scores[d],reverse=True); dims=[d for d in ranked if scores[d]>0]
  if not dims: dims=["E"]
  out.append({"id":str(uuid.uuid4())[:8],"text":chunk,"dimensions":dims,"primary_dimension":dims[0],
   "temporal":first_match(chunk,TEMPORAL,"unknown"),"evaluation":first_match(chunk,EVALUATIVE,"neutral"),
   "practical":first_match(chunk,PRACTICAL,"unspecified"),"epistemic":first_match(chunk,EPISTEMIC,"asserted"),
   "confidence":0.45 if len(dims)>1 else 0.65,"source":source,"created_at":now(),
   "aspect":re.sub(r"[^a-z0-9 ]","",t)[:80],"relations":[]})
 return out
def embed(text):
 if not OLLAMA_URL: return None
 try:
  raw=json.dumps({"model":EMBED_MODEL,"input":text}).encode()
  req=urllib.request.Request(OLLAMA_URL+"/api/embed",data=raw,headers={"Content-Type":"application/json"})
  with urllib.request.urlopen(req,timeout=20) as res: data=json.loads(res.read().decode())
  vectors=data.get("embeddings") or []; return vectors[0] if vectors else None
 except Exception: return None
def cosine(a,b):
 dot=sum(x*y for x,y in zip(a,b)); na=math.sqrt(sum(x*x for x in a)); nb=math.sqrt(sum(y*y for y in b))
 return dot/(na*nb) if na and nb else 0
def prop(r):
 d=dict(r); d["dimensions"]=json.loads(d["dimensions"]); d["relations"]=json.loads(d["relations"]); return d

class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw): super().__init__(*a,directory=str(STATIC),**kw)
 def log_message(self,fmt,*args): print("[ICARE] "+fmt%args)
 def send_json(self,obj,status=200):
  b=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
 def body(self):
  n=int(self.headers.get("Content-Length","0")); return json.loads(self.rfile.read(n).decode() or "{}")
 def do_GET(self):
  p=urlparse(self.path)
  if p.path=="/api/state":
   c=db(); ps=[prop(r) for r in c.execute("SELECT * FROM propositions ORDER BY created_at DESC")]
   ds=[dict(r) for r in c.execute("SELECT id,title,kind,caption,created_at FROM documents ORDER BY created_at DESC")]
   st={}
   for k,label in ONTOLOGY.items():
    n=sum(1 for x in ps if k in x["dimensions"]); st[k]={"label":label,"count":n,"status":"unexplored" if n==0 else "insufficient"}
   c.close(); return self.send_json({"ontology":ONTOLOGY,"propositions":ps,"documents":ds,"statuses":st,"embedding_enabled":bool(OLLAMA_URL),"embedding_model":EMBED_MODEL if OLLAMA_URL else None})
  if p.path=="/api/search":
   q=parse_qs(p.query).get("q",[""])[0].strip(); c=db(); rows=list(c.execute("SELECT * FROM documents")); qv=embed(q) if q else None
   terms=set(re.findall(r"\w+",q.lower())); hits=[]
   for r in rows:
    content=(r["title"]+" "+r["content"]+" "+(r["caption"] or "")).lower()
    lex=sum(1 for t in terms if t in content)/max(1,len(terms)); sem=0
    if qv and r["embedding"]:
     try: sem=cosine(qv,json.loads(r["embedding"]))
     except Exception: pass
    score=sem if qv and r["embedding"] else lex
    if score>0: hits.append({"id":r["id"],"title":r["title"],"kind":r["kind"],"caption":r["caption"],"excerpt":r["content"][:420],"score":round(score,3)})
   hits.sort(key=lambda x:x["score"],reverse=True); c.close()
   return self.send_json({"query":q,"results":hits[:8],"mode":"ollama-vector" if qv else "lexical-fallback"})
  if p.path.startswith("/files/"):
   name=Path(p.path.removeprefix("/files/")).name; f=DOCS/name
   if f.exists():
    b=f.read_bytes(); self.send_response(200); self.send_header("Content-Type",mimetypes.guess_type(str(f))[0] or "application/octet-stream"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b); return
  return super().do_GET()
 def do_POST(self):
  path=urlparse(self.path).path; data=self.body()
  if path=="/api/analyze":
   text=data.get("text","").strip()
   if not text: return self.send_json({"error":"Saisis un discours à analyser."},400)
   ps=extract(text,data.get("source","human")); c=db()
   for x in ps:
    c.execute("INSERT INTO propositions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(x["id"],x["text"],json.dumps(x["dimensions"]),x["primary_dimension"],x["temporal"],x["evaluation"],x["practical"],x["epistemic"],x["confidence"],x["source"],x["created_at"],x["aspect"],json.dumps(x["relations"])))
   c.commit()
   old=[prop(r) for r in c.execute("SELECT * FROM propositions WHERE id NOT IN ("+",".join("?"*len(ps))+")",[x["id"] for x in ps])]
   for x in ps: x["suggested_relations"]=[{"id":o["id"],"text":o["text"],"relation":"same_dimension_candidate"} for o in old if set(o["dimensions"])&set(x["dimensions"])][:3]
   c.close(); return self.send_json({"proposals":ps,"note":"Extraction heuristique : vérifie les qualifications avant de les interpréter comme acquises."})
  if path=="/api/relation":
   c=db(); sid=data.get("source_id"); tid=data.get("target_id"); row=c.execute("SELECT relations FROM propositions WHERE id=?",(sid,)).fetchone()
   if not row or not c.execute("SELECT id FROM propositions WHERE id=?",(tid,)).fetchone(): c.close(); return self.send_json({"error":"Proposition introuvable."},404)
   rel=json.loads(row["relations"]); rel.append({"target_id":tid,"type":data.get("relation","related")}); c.execute("UPDATE propositions SET relations=? WHERE id=?",(json.dumps(rel),sid)); c.commit(); c.close(); return self.send_json({"ok":True})
  if path=="/api/document":
   title=(data.get("title") or "Document sans titre").strip(); kind=data.get("kind","text"); content=data.get("content",""); caption=data.get("caption",""); fp=None
   if data.get("base64"):
    raw=base64.b64decode(data["base64"]); ext=Path(data.get("filename","document.bin")).suffix or ".bin"; fp=str(uuid.uuid4())+ext; (DOCS/fp).write_bytes(raw)
    if kind=="image" and not content: content=caption
   if not content and not caption: return self.send_json({"error":"Ajoute du texte ou une description/caption pour indexer ce document."},400)
   v=embed(title+"\n"+caption+"\n"+content); ident=str(uuid.uuid4())[:8]; c=db()
   c.execute("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)",(ident,title,kind,content,fp,caption,now(),json.dumps(v) if v else None)); c.commit(); c.close()
   return self.send_json({"ok":True,"id":ident,"embedding":"ollama" if v else "lexical-fallback"})
  if path=="/api/reset":
   c=db(); c.execute("DELETE FROM propositions"); c.execute("DELETE FROM documents"); c.commit(); c.close()
   for f in DOCS.iterdir():
    if f.is_file(): f.unlink()
   return self.send_json({"ok":True})
  return self.send_json({"error":"Route inconnue"},404)
 def do_DELETE(self):
  if self.path.startswith("/api/proposition/"):
   ident=self.path.rsplit("/",1)[-1]; c=db(); c.execute("DELETE FROM propositions WHERE id=?",(ident,)); c.commit(); c.close(); return self.send_json({"ok":True})
  return self.send_json({"error":"Route inconnue"},404)

if __name__=="__main__":
 host=os.environ.get("ICARE_HOST","127.0.0.1"); port=int(os.environ.get("ICARE_PORT","8765"))
 print("ICARE prototype: http://%s:%s"%(host,port))
 print("Embeddings: Ollama local" if OLLAMA_URL else "Embeddings: recherche lexicale (Ollama optionnel)")
 ThreadingHTTPServer((host,port),Handler).serve_forever()
