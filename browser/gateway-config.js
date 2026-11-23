const SERVICES=["llm","audio","scoring"];
const KEY="inference-gateway-config";
const defaults=()=>({version:1,directScoringUrl:"https://router.huggingface.co/hf-inference/models/Horizon-Labs/multilingual-zeroshot-base",gateways:[1,2,3].map(id=>({id,name:"Gateway "+id,url:"",capabilities:[]})),routes:{llm:"direct",audio:"direct",scoring:"direct"}});
const $=id=>document.getElementById(id);
function normalise(value){const d=defaults();if(!value||typeof value!=="object")return d;d.directScoringUrl=String(value.directScoringUrl||d.directScoringUrl);d.scoringModel=String(value.scoringModel||"");for(const service of SERVICES){const route=value.routes?.[service];if(route==="direct"||/^gateway-[123]$/.test(route))d.routes[service]=route;}for(const g of d.gateways){const old=value.gateways?.find?.(x=>Number(x.id)===g.id);if(old){g.name=String(old.name||g.name).slice(0,60);g.url=String(old.url||"");g.capabilities=Array.isArray(old.capabilities)?old.capabilities.filter(x=>SERVICES.includes(x)):[];}}return d;}
export async function initGatewayConfiguration({db,get,set,saveLegacy}) {
 let config=normalise(await get(db,"settings",KEY));$("direct-scoring-url").value=config.directScoringUrl;
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
   for(let id=1;id<=3;id++)if(eligible(service,id)){const g=gateway(id);select.add(new Option(g.name||"Gateway "+id,"gateway-"+id));}
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
