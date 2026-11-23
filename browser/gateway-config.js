const SERVICES=["llm","audio","scoring"];
const KEY="inference-gateway-config";
const defaults=()=>({version:2,directScoringUrl:"",gateways:[1,2,3].map(id=>({id,name:"Gateway "+id,url:"",capabilities:id===1?[...SERVICES]:[]})),routes:{llm:"direct",audio:"direct",scoring:"direct"}});
const $=id=>document.getElementById(id);
function normalise(value){
 const d=defaults();if(!value||typeof value!=="object")return d;
 d.directScoringUrl=String(value.directScoringUrl||"");
 for(const service of SERVICES){const route=value.routes?.[service];if(route==="direct"||/^gateway-[123]$/.test(route))d.routes[service]=route;}
 for(const g of d.gateways){const old=value.gateways?.find?.(x=>Number(x.id)===g.id);if(old){g.name=String(old.name||g.name).slice(0,60);g.url=String(old.url||"");g.capabilities=Array.isArray(old.capabilities)?old.capabilities.filter(x=>SERVICES.includes(x)):[];}}
 if(!d.gateways.some(g=>g.capabilities.length))d.gateways[0].capabilities=[...SERVICES];
 return d;
}
export async function initGatewayConfiguration({db,get,set,saveLegacy,loadScoringKey=async()=>""}) {
 const saved=await get(db,"settings",KEY);let config=normalise(saved);
 if(!saved){
  config.gateways[0].capabilities=[];
  const legacyRouting=await get(db,"settings","inference-routing")||{text:"local",audio:"local"};
  const legacyGateways=await get(db,"settings","inference-gateways")||{};
  const textUrl=legacyGateways.text||"",audioUrl=legacyGateways.audio||"";
  const textOn=legacyRouting.text==="gateway"&&!!textUrl,audioOn=legacyRouting.audio==="gateway"&&!!audioUrl;
  if(textOn){config.gateways[0].url=textUrl;config.gateways[0].capabilities=["llm","audio","scoring"];config.routes.llm="gateway-1";}
  if(audioOn){const same=textOn&&audioUrl===textUrl,id=same?1:(textOn?2:1),g=config.gateways[id-1];g.url=audioUrl;if(!g.capabilities.includes("audio"))g.capabilities.push("audio");config.routes.audio="gateway-"+id;}
  if(!textOn&&!audioOn)config.gateways[0].capabilities=[...SERVICES];
  await set(db,"settings",{id:KEY,...config});
 }
 $("direct-scoring-url").value=config.directScoringUrl;
 $("direct-scoring-key").value=await loadScoringKey();
 const routeIds={llm:"route-llm",audio:"route-audio",scoring:"route-scoring"};
 const gateway=id=>config.gateways.find(g=>g.id===id);
 const eligible=(service,id)=>gateway(id)?.capabilities.includes(service)||false;
 function refresh(){
  const firstCount=gateway(1).capabilities.length;
  for(const g of config.gateways){
   const visible=g.id===1||(g.id===2&&firstCount<3)||(g.id===3&&firstCount<2);
   const card=$("gateway-card-"+g.id);card.hidden=!visible;
   for(const service of SERVICES){const input=$("gateway-"+g.id+"-"+service);input.disabled=!visible;}
   $("gateway-"+g.id+"-name").disabled=!visible;$("gateway-"+g.id+"-url").disabled=!visible;
   $("gateway-"+g.id+"-reason").textContent="";
  }
  for(const service of SERVICES){
   const select=$(routeIds[service]),previous=config.routes[service]||"direct";
   select.replaceChildren(new Option("Accès direct","direct"));
   for(let id=1;id<=3;id++)if(eligible(service,id)||previous==="gateway-"+id){const option=new Option(gateway(id).name||"Gateway "+id,"gateway-"+id);select.add(option);}
   select.value=[...select.options].some(o=>o.value===previous)?previous:"direct";config.routes[service]=select.value;
  }
 }
 for(const g of config.gateways){
  $("gateway-"+g.id+"-name").value=g.name;$("gateway-"+g.id+"-url").value=g.url;
  for(const service of SERVICES)$("gateway-"+g.id+"-"+service).checked=g.capabilities.includes(service);
  for(const field of ["name","url"])$("gateway-"+g.id+"-"+field).addEventListener("input",()=>{g[field]=$("gateway-"+g.id+"-"+field).value;refresh();});
  for(const service of SERVICES)$("gateway-"+g.id+"-"+service).addEventListener("change",()=>{g.capabilities=SERVICES.filter(s=>$("gateway-"+g.id+"-"+s).checked);refresh();});
 }
 for(const service of SERVICES)$(routeIds[service]).addEventListener("change",e=>{config.routes[service]=e.target.value;});
 refresh();
 for(const service of SERVICES)$(routeIds[service]).value=config.routes[service];
 $("save-gateway-matrix").addEventListener("click",async()=>{
  const status=$("gateway-matrix-status");
  try{
   Object.assign(config,normalise({...config,directScoringUrl:$("direct-scoring-url").value.trim(),gateways:config.gateways.map(g=>({...g,name:$("gateway-"+g.id+"-name").value.trim()||"Gateway "+g.id,url:$("gateway-"+g.id+"-url").value.trim(),capabilities:SERVICES.filter(s=>$("gateway-"+g.id+"-"+s).checked)})),routes:Object.fromEntries(SERVICES.map(s=>[s,$(routeIds[s]).value]))}));
   if(config.routes.scoring==="direct"&&config.directScoringUrl){let endpoint;try{endpoint=new URL(config.directScoringUrl);}catch{throw Error("URL du moteur de scoring ICARE invalide.");}const loopback=["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname);if((endpoint.protocol!=="https:"&&!(endpoint.protocol==="http:"&&loopback))||endpoint.username||endpoint.password||endpoint.hash)throw Error("Utilisez HTTPS pour un service distant, ou HTTP uniquement sur localhost, sans identifiants intégrés.");}
   for(const service of SERVICES){const route=config.routes[service];if(route!=="direct"){const id=Number(route.slice(-1)),g=gateway(id);if(!g?.capabilities.includes(service))throw Error("La passerelle sélectionnée ne déclare pas la capacité "+service+".");if(!/^https:\/\//i.test(g.url))throw Error("L’URL de Gateway "+id+" doit commencer par HTTPS.");const u=new URL(g.url);if(u.username||u.password)throw Error("Ne placez pas d’identifiants dans l’URL d’une Gateway.");}}
   await set(db,"settings",{id:KEY,...config});
   const llm=config.routes.llm,audio=config.routes.audio,scoring=config.routes.scoring;
   const textGateway=llm==="direct"?"":gateway(Number(llm.slice(-1))).url;
   const audioGateway=audio==="direct"?"":gateway(Number(audio.slice(-1))).url;
   const scoringGateway=scoring==="direct"?"":gateway(Number(scoring.slice(-1))).url;
   $("text-route").value=llm==="direct"?"local":"gateway";$("audio-route").value=audio==="direct"?"local":"gateway";
   $("gateway-text-url").value=textGateway;$("gateway-audio-url").value=audioGateway;
   $("same-gateway").checked=false;$("gateway-shared-url").value="";
   status.textContent="Configuration des trois services d’inférence enregistrée.";
   await saveLegacy({llm,audio,textGateway,audioGateway,scoringRoute:scoring,scoringGateway,scoringApiKey:$("direct-scoring-key").value.trim()});
  }catch(error){status.textContent=error.message;}
 });
 return config;
}
