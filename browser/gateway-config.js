const SERVICES=["llm","audio","scoring"];
const KEY="inference-gateway-config";
const defaults=()=>({version:1,directScoringUrl:"http://127.0.0.1:8787/v1/icare/scoring",gateways:[1,2,3].map(id=>({id,name:"Gateway "+id,url:"",capabilities:[]})),routes:{llm:"direct",audio:"direct",scoring:"direct"}});
const $=id=>document.getElementById(id);
function normalise(value){const d=defaults();if(!value||typeof value!=="object")return d;d.directScoringUrl=String(value.directScoringUrl||d.directScoringUrl);d.scoringModel=String(value.scoringModel||"");for(const service of SERVICES){const route=value.routes?.[service];if(route==="direct"||/^gateway-[123]$/.test(route))d.routes[service]=route;}for(const g of d.gateways){const old=value.gateways?.find?.(x=>Number(x.id)===g.id);if(old){g.name=String(old.name||g.name).slice(0,60);g.url=String(old.url||"");g.capabilities=Array.isArray(old.capabilities)?old.capabilities.filter(x=>SERVICES.includes(x)):[];}}return d;}
export async function initGatewayConfiguration({db,get,set,saveLegacy}) {
 const saved=await get(db,"settings",KEY);
 let config=normalise(saved);
 if(!saved){
  const legacyRouting=await get(db,"settings","inference-routing")||{text:"local",audio:"local"};
  const legacyGateways=await get(db,"settings","inference-gateways")||{};
  const textUrl=legacyGateways.text||"",audioUrl=legacyGateways.audio||"";
  const textOn=legacyRouting.text==="gateway"&&!!textUrl,audioOn=legacyRouting.audio==="gateway"&&!!audioUrl;
  if(textOn){config.gateways[0].url=textUrl;config.gateways[0].capabilities.push("llm");config.routes.llm="gateway-1";}
  if(audioOn){
   const same=textOn&&audioUrl===textUrl,id=same?1:(textOn?2:1),g=config.gateways[id-1];
   g.url=audioUrl;g.capabilities.push("audio");config.routes.audio="gateway-"+id;
  }
  await set(db,"settings",{id:KEY,...config});
 }
 $("direct-scoring-url").value=config.directScoringUrl;
 const routeIds={llm:"route-llm",audio:"route-audio",scoring:"route-scoring"};
 function gateway(id){return config.gateways.find(g=>g.id===id);}
 function eligible(service,id){return gateway(id)?.capabilities.includes(service)||false;}
 function refresh(){
  for(const g of config.gateways){
   const caps=SERVICES.filter(s=>$(`gateway-${g.id}-${s}`).checked);
   const blocked=(g.id===2&&config.gateways[0].capabilities.length===3)||(g.id===3&&config.gateways[0].capabilities.length>=2);
   const card=$(`gateway-card-${g.id}`);card.classList.toggle("is-disabled",blocked);
   for(const service of SERVICES)$(`gateway-${g.id}-${service}`).disabled=blocked;
   $(`gateway-${g.id}-name`).disabled=blocked;$(`gateway-${g.id}-url`).disabled=blocked;
   $(`gateway-${g.id}-reason`).textContent=blocked?(g.id===2?"Gateway 1 prend déjà en charge les trois services.":"Deux services au moins sont déjà affectés à Gateway 1 ; une troisième passerelle n’est pas nécessaire."):"";
  }
  for(const service of SERVICES){
   const select=$(routeIds[service]),previous=config.routes[service]||select.value;select.replaceChildren(new Option("Accès direct","direct"));
   for(let id=1;id<=3;id++){
    const value="gateway-"+id,blocked=(id===2&&gateway(1).capabilities.length===3)||(id===3&&gateway(1).capabilities.length>=2);
    if(eligible(service,id)||previous===value){const option=new Option(gateway(id).name||"Gateway "+id,value);option.disabled=blocked&&previous!==value;select.add(option);}
   }
   select.value=[...select.options].some(o=>o.value===previous)?previous:"direct";
   config.routes[service]=select.value;
  }
 }
 for(const g of config.gateways){
  $(`gateway-${g.id}-name`).value=g.name;$(`gateway-${g.id}-url`).value=g.url;
  for(const service of SERVICES)$(`gateway-${g.id}-${service}`).checked=g.capabilities.includes(service);
  for(const field of ["name","url"])$(`gateway-${g.id}-${field}`).addEventListener("input",()=>{g[field]=$(`gateway-${g.id}-${field}`).value;refresh();});
  for(const service of SERVICES)$(`gateway-${g.id}-${service}`).addEventListener("change",()=>{g.capabilities=SERVICES.filter(s=>$(`gateway-${g.id}-${s}`).checked);refresh();});
 }
 for(const service of SERVICES)$(routeIds[service]).addEventListener("change",e=>{config.routes[service]=e.target.value;});
 refresh();
 for(const service of SERVICES)$(routeIds[service]).value=config.routes[service];
 $("save-gateway-matrix").addEventListener("click",async()=>{
  const status=$("gateway-matrix-status");
  try{
   config=normalise({...config,directScoringUrl:$("direct-scoring-url").value.trim(),gateways:config.gateways.map(g=>({...g,name:$("gateway-"+g.id+"-name").value.trim()||"Gateway "+g.id,url:$("gateway-"+g.id+"-url").value.trim(),capabilities:SERVICES.filter(s=>$("gateway-"+g.id+"-"+s).checked)})),routes:Object.fromEntries(SERVICES.map(s=>[s,$(routeIds[s]).value]))});
   if(config.routes.scoring==="direct"){
    let direct;try{direct=new URL(config.directScoringUrl);}catch{throw Error("Renseignez un endpoint local valide pour le scoring ICARE.");}
    const loopback=["localhost","127.0.0.1","[::1]"].includes(direct.hostname);
    if(!loopback||direct.protocol!=="http:")throw Error("Le scoring ICARE direct doit rester sur la machine locale (HTTP loopback uniquement).");
    if(direct.username||direct.password)throw Error("Ne placez pas d’identifiants dans l’URL du scoring.");
   }
   for(const service of SERVICES){const route=config.routes[service];if(route!=="direct"){const id=Number(route.slice(-1)),g=gateway(id);if(!g?.capabilities.includes(service))throw Error("La passerelle sélectionnée ne déclare pas la capacité "+service+".");if(!/^https:\/\//i.test(g.url))throw Error("L’URL de Gateway "+id+" doit commencer par HTTPS.");let u;try{u=new URL(g.url);}catch{throw Error("URL invalide pour Gateway "+id+".");}if(u.username||u.password)throw Error("Ne placez pas d’identifiants dans l’URL d’une Gateway.");}}
   const scoringRoute=config.routes.scoring;
   if(scoringRoute!=="direct"){
    const selected=gateway(Number(scoringRoute.slice(-1))),base=selected.url.replace(/\\/+$/,""),configUrl=base.endsWith("/v1")?base+"/icare/config":base+"/v1/icare/config";
    const response=await fetch(configUrl,{credentials:"include"});
    if(!response.ok)throw Error("Gateway de scoring inaccessible ("+response.status+").");
    const remote=await response.json();config.scoringModel=remote.defaults?.scoringModel||"";
    if(!config.scoringModel)throw Error("La Gateway sélectionnée ne publie aucun modèle de scoring ICARE.");
   }else config.scoringModel="";
   await set(db,"settings",{id:KEY,...config});
   const llm=config.routes.llm,audio=config.routes.audio;
   $("text-route").value=llm==="direct"?"local":"gateway";$("audio-route").value=audio==="direct"?"local":"gateway";
   const textGateway=llm==="direct"?"":gateway(Number(llm.slice(-1))).url;
   const audioGateway=audio==="direct"?"":gateway(Number(audio.slice(-1))).url;
   $("gateway-text-url").value=textGateway;$("gateway-audio-url").value=audioGateway;
   $("same-gateway").checked=false;
   $("gateway-shared-url").value="";
   status.textContent="Configuration des trois passerelles enregistrée. Vérification et sauvegarde des routes LLM et transcription…";
   await saveLegacy();
   status.textContent="Configuration enregistrée. Le routage du scoring ICARE est mémorisé séparément.";
  }catch(error){status.textContent=error.message;}
 });
 return config;
}
