const SERVICES=["llm","audio","scoring"];
const KEY="inference-gateway-config";
const defaults=()=>({version:3,directScoringUrl:"",directScoringProvider:"lemonade",directScoringBaseUrl:"http://127.0.0.1:13305",directScoringModel:"",gateways:[1,2,3].map(id=>({id,name:"Gateway "+id,url:"",capabilities:id===1?[...SERVICES]:[]})),routes:{llm:"direct",audio:"direct",scoring:"direct"}});
const $=id=>document.getElementById(id);
function normalise(value){
 const d=defaults();if(!value||typeof value!=="object")return d;
 d.directScoringUrl=String(value.directScoringUrl||"");
 d.directScoringProvider=["lemonade","custom"].includes(value.directScoringProvider)?value.directScoringProvider:(d.directScoringUrl?"custom":"lemonade");
 d.directScoringBaseUrl=String(value.directScoringBaseUrl||d.directScoringBaseUrl);
 d.directScoringModel=String(value.directScoringModel||"");
 for(const service of SERVICES){const route=value.routes?.[service];if(route==="direct"||/^gateway-[123]$/.test(route))d.routes[service]=route;}
 for(const g of d.gateways){const old=value.gateways?.find?.(x=>Number(x.id)===g.id);if(old){g.name=String(old.name||g.name).slice(0,60);g.url=String(old.url||"");g.capabilities=Array.isArray(old.capabilities)?old.capabilities.filter(x=>SERVICES.includes(x)):[];}}
 // Chaque service ne peut appartenir qu’à une seule Gateway. En cas d’ancienne
 // configuration ambiguë, la première Gateway configurée conserve la capacité.
 for(const service of SERVICES){
  const route=d.routes[service],preferredId=/^gateway-[123]$/.test(route)?Number(route.slice(-1)):0;
  const owner=d.gateways.find(g=>g.id===preferredId&&g.capabilities.includes(service))
   ||d.gateways.find(g=>g.capabilities.includes(service));
  for(const g of d.gateways)if(g.capabilities.includes(service)&&g!==owner)g.capabilities=g.capabilities.filter(item=>item!==service);
  if(d.routes[service]!=="direct"&&(!owner||d.routes[service]!=="gateway-"+owner.id))d.routes[service]="direct";
 }
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
  config=normalise(config);
  await set(db,"settings",{id:KEY,...config});
 }
 $("direct-scoring-url").value=config.directScoringUrl;
 $("direct-scoring-provider").value=config.directScoringProvider;
 $("direct-scoring-base").value=config.directScoringBaseUrl;
 if(config.directScoringModel)$("direct-scoring-model").add(new Option(config.directScoringModel,config.directScoringModel));
 $("direct-scoring-model").value=config.directScoringModel;
 $("custom-scoring-config").hidden=config.directScoringProvider!=="custom";
 $("lemonade-scoring-config").hidden=config.directScoringProvider!=="lemonade";
 $("direct-scoring-provider").addEventListener("change",()=>{const lemonade=$("direct-scoring-provider").value==="lemonade";$("lemonade-scoring-config").hidden=!lemonade;$("custom-scoring-config").hidden=lemonade;});
 $("direct-scoring-key").value=await loadScoringKey();
 const routeIds={llm:"route-llm",audio:"route-audio",scoring:"route-scoring"};
 const gateway=id=>config.gateways.find(g=>g.id===id);
 const eligible=(service,id)=>gateway(id)?.capabilities.includes(service)||false;
 function refresh(){
  for(const g of config.gateways){
   const card=$("gateway-card-"+g.id);card.hidden=false;
   $("gateway-"+g.id+"-name").disabled=false;$("gateway-"+g.id+"-url").disabled=false;
   $("gateway-"+g.id+"-reason").textContent="";
   for(const service of SERVICES){
    const input=$("gateway-"+g.id+"-"+service),owner=config.gateways.find(candidate=>candidate.capabilities.includes(service));
    const label=input.closest("label");
    const unavailable=!!owner&&owner.id!==g.id;
    label.hidden=unavailable;label.style.display=unavailable?"none":"";input.disabled=unavailable;
    input.checked=g.capabilities.includes(service);
   }
  }
  for(const service of SERVICES){
   const select=$(routeIds[service]),previous=config.routes[service]||"direct";
   select.replaceChildren(new Option("Accès direct","direct"));
   for(let id=1;id<=3;id++)if(eligible(service,id)){const option=new Option(gateway(id).name||"Gateway "+id,"gateway-"+id);select.add(option);}
   select.value=[...select.options].some(o=>o.value===previous)?previous:"direct";config.routes[service]=select.value;
  }
 }
 for(const g of config.gateways){
  $("gateway-"+g.id+"-name").value=g.name;$("gateway-"+g.id+"-url").value=g.url;
  for(const service of SERVICES)$("gateway-"+g.id+"-"+service).checked=g.capabilities.includes(service);
  for(const field of ["name","url"])$("gateway-"+g.id+"-"+field).addEventListener("input",()=>{g[field]=$("gateway-"+g.id+"-"+field).value;refresh();});
  for(const service of SERVICES)$("gateway-"+g.id+"-"+service).addEventListener("change",event=>{
   if(event.target.checked){
    for(const other of config.gateways)other.capabilities=other.capabilities.filter(item=>item!==service);
    if(!g.capabilities.includes(service))g.capabilities.push(service);
    config.routes[service]="gateway-"+g.id;
   }else{
    g.capabilities=g.capabilities.filter(item=>item!==service);
    if(config.routes[service]==="gateway-"+g.id)config.routes[service]="direct";
   }
   refresh();
  });
 }
 for(const service of SERVICES)$(routeIds[service]).addEventListener("change",e=>{config.routes[service]=e.target.value;});
 refresh();
 for(const service of SERVICES)$(routeIds[service]).value=config.routes[service];
 $("save-gateway-matrix").addEventListener("click",async()=>{
  const status=$("gateway-matrix-status");
  try{
   Object.assign(config,normalise({...config,directScoringUrl:$("direct-scoring-url").value.trim(),directScoringProvider:$("direct-scoring-provider").value,directScoringBaseUrl:$("direct-scoring-base").value.trim(),directScoringModel:$("direct-scoring-model").value,gateways:config.gateways.map(g=>({...g,name:$("gateway-"+g.id+"-name").value.trim()||"Gateway "+g.id,url:$("gateway-"+g.id+"-url").value.trim(),capabilities:SERVICES.filter(s=>$("gateway-"+g.id+"-"+s).checked)})),routes:Object.fromEntries(SERVICES.map(s=>[s,$(routeIds[s]).value]))}));
   if(config.directScoringProvider==="lemonade"){let endpoint;try{endpoint=new URL(config.directScoringBaseUrl);}catch{throw Error("Adresse Lemonade invalide.");}if(endpoint.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error("Le scoring Lemonade doit rester sur HTTP loopback (localhost ou 127.0.0.1).");}else if(config.directScoringUrl){let endpoint;try{endpoint=new URL(config.directScoringUrl);}catch{throw Error("URL du moteur de scoring ICARE invalide.");}const loopback=["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname);if((endpoint.protocol!=="https:"&&!(endpoint.protocol==="http:"&&loopback))||endpoint.username||endpoint.password)throw Error("Utilisez HTTPS pour le scoring distant, ou HTTP uniquement sur loopback local.");}
   for(const service of SERVICES){const route=config.routes[service];if(route!=="direct"){const id=Number(route.slice(-1)),g=gateway(id);if(!g?.capabilities.includes(service))throw Error("La passerelle sélectionnée ne déclare pas la capacité "+service+".");if(!/^https:\/\//i.test(g.url))throw Error("L’URL de Gateway "+id+" doit commencer par HTTPS.");const u=new URL(g.url);if(u.username||u.password)throw Error("Ne placez pas d’identifiants dans l’URL d’une Gateway.");}}
   await saveLegacy({config,scoringApiKey:$("direct-scoring-key").value.trim()});
   await set(db,"settings",{id:KEY,...config});
   status.textContent="Routage Gateway enregistré.";$("settings-dialog").close();
  }catch(error){status.textContent=error.message;}
 });
 return config;
}
