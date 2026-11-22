import { openDatabase, getAll, put, get } from "./storage.js";
import { renderMarkdown } from "./markdown.js";
import { chatCompletion, chatCompletionMessage, listModels, transcribeAudio, audioBlobToWav, resolveInferenceRoute } from "./inference.js";
import { runAgentTurn } from "./agent.js";
import { createIcareToolExecutor } from "./workspace-tools.js";
import { saveCredentialVault, migrateLegacyCredentials } from "./credentials.js";
import { registerAppServiceWorker } from "./pwa.js";
import { createComponentRuntime } from "./component-runtime.js";
const $=id=>document.getElementById(id), db=await openDatabase();
$("app-version").textContent=`— V${window.ICARE_VERSION} Alpha`;
const state={projectId:null,projects:[],turns:[],settings:{},transcriptionSettings:{},routing:{text:"local",audio:"local"},gateways:{text:"",audio:""},gatewayModels:{text:"",audio:""},sameGateway:true,workspace:null,busy:false};
const componentRuntime=createComponentRuntime({
 grants: { "context-summary": ["context-read"], "storage-probe": ["project-storage-read", "project-storage-write"] },
 storageProvider: () => state.workspace?.componentStorage || {},
 storageCommit: async (_componentId, values) => {
  if (!state.workspace) throw new Error("Aucun projet actif pour le stockage du composant.");
  const previous = state.workspace.componentStorage || {};
  state.workspace.componentStorage = values;
  try { await saveWorkspace(); }
  catch (error) { state.workspace.componentStorage = previous; throw error; }
 },
 contextProvider: () => {
  const project=state.projects.find(item=>item.id===state.projectId);
  const workspace=state.workspace;
  return JSON.stringify({
   project: project ? { id: project.id, name: project.name, intention: project.intention || "" } : null,
   exploration: workspace ? {
    dimensions: { ...workspace.dimensions },
    justifications: { ...(workspace.dimensionJustifications || {}) }
   } : null,
   propositionCount: workspace?.proposals?.length || 0,
   relationCount: workspace?.relations?.length || 0
  });
 }
});

const uid=()=>crypto.randomUUID(), now=()=>new Date().toISOString();
let ontology=null;
async function loadOntology(){try{const response=await fetch("./icare.json");if(!response.ok)throw Error("Ontologie indisponible");ontology=await response.json();}catch{ontology={dimensions:{I:"Intention / finalité",C:"Contexte / situation",A:"Action / opération",R:"Régulation / organisation",E:"Évolution / temporalité"}};}}
function bubble(role,text,error=false){const el=document.createElement("article");el.className="message "+role+(error?" error":"");if(role==="assistant"&&!error){const content=document.createElement("div");content.className="message-content";content.append(renderMarkdown(text));el.append(content);}else{const p=document.createElement("p");p.textContent=text;el.append(p);}$("messages").append(el);$("messages").scrollTop=$("messages").scrollHeight;return el;}
function renderProjects(){const s=$("project-select");s.replaceChildren();for(const p of state.projects){const o=document.createElement("option");o.value=p.id;o.textContent=p.name;o.selected=p.id===state.projectId;s.append(o);}const p=state.projects.find(x=>x.id===state.projectId);if(p){$("project-title").textContent=p.name;$("project-description").textContent=p.intention||"Un espace privé pour explorer un système.";}}
function renderConversation(turnCount=state.turns.length){const turns=state.turns.slice(0,Math.max(0,Math.min(state.turns.length,Number(turnCount)||0)));$("messages").replaceChildren();if(!turns.length){bubble("assistant","Bienvenue dans votre espace ICARE. Vos données restent dans ce navigateur. Décrivez le système que vous souhaitez explorer.");return;}for(const t of turns){bubble("user",t.user);bubble("assistant",t.assistant);}}
async function loadTurns(){state.turns=(await getAll(db,"turns")).filter(t=>t.projectId===state.projectId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));renderConversation(state.turns.length);}
async function loadProjects(){state.projects=(await getAll(db,"projects")).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));if(!state.projects.length){const p={id:uid(),name:"Mon premier projet",intention:"",createdAt:now(),updatedAt:now()};await put(db,"projects",p);state.projects=[p];}if(!state.projects.some(p=>p.id===state.projectId))state.projectId=state.projects[0].id;renderProjects();await loadTurns();}
function detectPreset(url=""){return url.includes("api.openai.com")?"openai":url.includes(":11434")?"ollama":url.includes(":13305")?"lemonade":"";}
async function loadSettings(){
 const legacy=await get(db,"settings","inference")||{baseUrl:"",model:""};
 state.settings=await get(db,"settings","inference-text")||{...legacy,id:"inference-text"};
 state.transcriptionSettings=await get(db,"settings","inference-transcription")||{id:"inference-transcription",baseUrl:"http://127.0.0.1:13305/v1",model:""};
 if(!state.transcriptionSettings.baseUrl)state.transcriptionSettings.baseUrl="http://127.0.0.1:13305/v1";
 if(state.transcriptionSettings.baseUrl.includes(":13305")&&state.transcriptionSettings.model==="whisper-1")state.transcriptionSettings.model="";
 const legacyGateway=await get(db,"settings","enterprise-gateway")||{url:""};
 const legacyModels=await get(db,"settings","enterprise-inference-models")||{chatModel:"",transcriptionModel:""};
 const routing=await get(db,"settings","inference-routing");
 const gateways=await get(db,"settings","inference-gateways");
 const gatewayModels=await get(db,"settings","inference-gateway-models");
 if(routing){
  state.routing={text:routing.text==="gateway"?"gateway":"local",audio:routing.audio==="gateway"?"gateway":"local"};
  state.gateways=gateways?{text:gateways.text||"",audio:gateways.audio||""}:{text:legacyGateway.url||"",audio:legacyGateway.url||""};
  state.gatewayModels=gatewayModels?{text:gatewayModels.text||"",audio:gatewayModels.audio||""}:{text:legacyModels.chatModel||"",audio:legacyModels.transcriptionModel||""};
  state.sameGateway=gateways?.sameGateway??(state.gateways.text===state.gateways.audio);
 }else{
  const legacyMode=(await get(db,"settings","active-inference-mode"))?.mode;const legacyEnterprise=legacyMode==="enterprise"||(!legacyMode&&!!legacyGateway.url);
  state.routing={text:legacyEnterprise?"gateway":"local",audio:legacyEnterprise?"gateway":"local"};
  state.gateways={text:legacyGateway.url||"",audio:legacyGateway.url||""};
  state.gatewayModels={text:legacyModels.chatModel||"",audio:legacyModels.transcriptionModel||""};
  state.sameGateway=true;
  await put(db,"settings",{id:"inference-routing",...state.routing});
  await put(db,"settings",{id:"inference-gateways",...state.gateways,sameGateway:true});
  await put(db,"settings",{id:"inference-gateway-models",...state.gatewayModels});
 }
 const credentials=await migrateLegacyCredentials(db,{
  text:state.settings.apiKey||sessionStorage.getItem("icare-api-key")||"",
  audio:state.transcriptionSettings.apiKey||sessionStorage.getItem("icare-transcription-api-key")||"",
  legacy:legacy.apiKey||""
 });
 state.settings.apiKey=credentials.text;state.transcriptionSettings.apiKey=credentials.audio;
 sessionStorage.removeItem("icare-api-key");sessionStorage.removeItem("icare-transcription-api-key");
 const {apiKey:legacyKey,rememberKey:legacyRemember,...safeLegacy}=legacy;
 const {apiKey:textKey,rememberKey:textRemember,...safeText}=state.settings;
 const {apiKey:audioKey,rememberKey:audioRemember,...safeAudio}=state.transcriptionSettings;
 await put(db,"settings",{...safeLegacy,id:"inference"});
 await put(db,"settings",{...safeText,id:"inference-text"});
 await put(db,"settings",{...safeAudio,id:"inference-transcription"});
 $("api-base").value=state.settings.baseUrl||"";$("api-model").value=state.settings.model||"";$("api-key").value=state.settings.apiKey||"";$("local-preset").value=detectPreset(state.settings.baseUrl)===detectPreset(state.transcriptionSettings.baseUrl)?detectPreset(state.settings.baseUrl):"";
 $("transcription-base").value=state.transcriptionSettings.baseUrl||"";$("transcription-model").value=state.transcriptionSettings.model||"";$("transcription-key").value=state.transcriptionSettings.apiKey||"";
 $("text-route").value=state.routing.text;$("audio-route").value=state.routing.audio;
 $("gateway-text-url").value=state.gateways.text;$("gateway-audio-url").value=state.gateways.audio;$("gateway-shared-url").value=state.gateways.text||state.gateways.audio;
 $("same-gateway").checked=state.sameGateway;$("same-gateway-option").dataset.both=String(state.routing.text==="gateway"&&state.routing.audio==="gateway");
 renderRoutingConfig();modelLabel();
}
function modelLabel(){
 const text=state.routing.text==="gateway"?"Gateway · "+(state.gatewayModels.text||"modèle non attribué"):(state.settings.model||"non configuré")+" (direct)";
 const audio=state.routing.audio==="gateway"?"Gateway · "+(state.gatewayModels.audio||"modèle non attribué"):(state.transcriptionSettings.model||"non configuré")+" (direct)";
 $("model-label").textContent="Texte : "+text+" · Transcription : "+audio;
}
function resolveInferenceTarget(kind){
 const route=kind==="audio"?"audio":"text",settings=route==="audio"?state.transcriptionSettings:state.settings;
 return resolveInferenceRoute({kind:route,routing:state.routing,localSettings:settings,gateways:state.gateways,gatewayModels:state.gatewayModels,sameGateway:state.sameGateway});
}
function renderRoutingConfig(){
 const textGateway= $("text-route").value==="gateway",audioGateway=$("audio-route").value==="gateway",both=textGateway&&audioGateway,wasBoth=$("same-gateway-option").dataset.both==="true";
 if(both&&!wasBoth){$("same-gateway").checked=true;$("gateway-shared-url").value=$("gateway-text-url").value||$("gateway-audio-url").value||$("gateway-shared-url").value;}
 $("same-gateway-option").dataset.both=String(both);
 $("local-text-config").hidden=textGateway;$("local-audio-config").hidden=audioGateway;
 $("gateway-text-config").hidden=!textGateway;$("gateway-audio-config").hidden=!audioGateway;
 $("same-gateway-option").hidden=!both;
 const shared=both&&$("same-gateway").checked;
 $("gateway-shared-config").hidden=!shared;
 $("gateway-text-config").hidden= !textGateway||shared;
 $("gateway-audio-config").hidden= !audioGateway||shared;
 $("api-base").required=!textGateway;$("api-model").required=!textGateway;
 $("transcription-base").required=!audioGateway;$("transcription-model").required=!audioGateway;
 if(shared)$("gateway-shared-url").value=$("gateway-text-url").value||$("gateway-audio-url").value||$("gateway-shared-url").value;
}
$("text-route").addEventListener("change",renderRoutingConfig);
$("audio-route").addEventListener("change",renderRoutingConfig);
$("same-gateway").addEventListener("change",()=>{if($("same-gateway").checked){const value=$("gateway-text-url").value||$("gateway-audio-url").value;$("gateway-shared-url").value=value;}renderRoutingConfig();});
$("gateway-shared-url").addEventListener("input",e=>{$("gateway-text-url").value=e.target.value;$("gateway-audio-url").value=e.target.value;});
$("gateway-audio-url").addEventListener("input",e=>{if(!$("same-gateway").checked)$("gateway-audio-url").value=e.target.value;});
$("settings-button").addEventListener("click",()=>{$("settings-dialog").showModal();renderRoutingConfig();});
$("close-settings-dialog").addEventListener("click",()=>$("settings-dialog").close());

$("local-preset").addEventListener("change",e=>{const presets={openai:"https://api.openai.com/v1",ollama:"http://localhost:11434/v1",lemonade:"http://127.0.0.1:13305/v1"};if(presets[e.target.value]){$("api-base").value=presets[e.target.value];$("transcription-base").value=presets[e.target.value];}});
$("load-models").addEventListener("click",async()=>{const status=$("provider-status");status.textContent="Chargement du catalogue…";try{const target={baseUrl:$("api-base").value.trim(),model:$("api-model").value.trim(),apiKey:$("api-key").value.trim(),credentials:"omit"};const models=await listModels(target);const list=$("available-models");list.replaceChildren();for(const model of models){const option=document.createElement("option");option.value=model;list.append(option);}status.textContent=models.length+" modèle(s) trouvé(s). Vous pouvez aussi saisir un identifiant manuellement.";}catch(error){status.textContent=error.message;}});
async function complete(messages){return chatCompletion({...resolveInferenceTarget("text"),messages});}
async function completeAgent(messages,tools){return chatCompletionMessage({...resolveInferenceTarget("text"),messages,tools});}
async function executeIcareTool(name,args){
 const execute=createIcareToolExecutor({
  workspace:state.workspace,
  ontology,
  persist:saveWorkspace,
  snapshot:captureSnapshot,
  render:renderWorkspace,
  listModels:()=>listModels(resolveInferenceTarget("text")),
  componentRuntime,
  uid,
  now
 });
 return execute(name,args);
}
async function systemPrompt(){let prompt="Tu es ICARE, un partenaire méthodologique systémique et maïeutique. Garde en vue I Intention, C Contexte, A Action, R Régulation et E Évolution. Distingue faits, perceptions, hypothèses et incertitudes. Ne décide jamais à la place de la personne. Pose généralement une seule question utile à la fois.";let guide=state.workspace?.referenceDocuments?.find(document=>document.id==="guide-icare")?.content||"";try{const r=await fetch("./system-prompt.md");if(r.ok)prompt=await r.text();}catch{}if(!guide){try{const r=await fetch("./guide-icare.md");if(r.ok)guide=await r.text();}catch{}}return prompt+"\n\nGUIDE MÉTHODOLOGIQUE ICARE (référence)\n"+guide+"\n\nONTOLOGIE STRUCTURÉE ICARE (source de référence)\n"+JSON.stringify(ontology);}
async function send(text){if(state.busy||!text.trim())return;const user=text.trim(),project=state.projects.find(p=>p.id===state.projectId);bubble("user",user);$("message-input").value="";state.busy=true;$("send-button").disabled=true;$("send-button").textContent="Réponse…";const pending=bubble("assistant","ICARE réfléchit…");try{const history=state.turns.slice(-16).flatMap(t=>[{role:"user",content:t.user},{role:"assistant",content:t.assistant}]);const workspaceContext=state.workspace?{dimensions:state.workspace.dimensions,proposals:state.workspace.proposals.slice(-40).map(({id,text,dimensions,status,createdAt,updatedAt})=>({id,text,dimensions,status,createdAt,updatedAt}))}:null;const projectContext="\nPROJET ACTUEL : "+project.name+(project.intention?"\nINTENTION DU PROJET : "+project.intention:"")+"\nÉTAT ACTUEL DU TABLEAU ICARE (contexte de travail, distinct des faits validés) :\n"+JSON.stringify(workspaceContext,null,2);const agentResult=await runAgentTurn({messages:[{role:"system",content:(await systemPrompt())+projectContext+"\n\nOUTILS DISPONIBLES : utilise réellement les outils pour enregistrer les observations substantielles, proposer les relations, consulter ou modifier le référentiel et mettre à jour les statuts lorsque cela est justifié. Une action d’écriture exige un appel d’outil réussi. Les propositions restent candidates à validation humaine. Ne modifie pas un statut sans justification explicite."},...history,{role:"user",content:user}],complete:completeAgent,executeTool:executeIcareTool});const answer=agentResult.content||"Les opérations ont été exécutées, mais le modèle n’a pas fourni de réponse finale.";const renderedAnswer=answer+(agentResult.executed.length?"\\n\\n✓ "+agentResult.executed.length+" opération(s) ICARE exécutée(s).":"");pending.replaceChildren(Object.assign(document.createElement("div"),{className:"message-content"}));pending.querySelector(".message-content").append(renderMarkdown(renderedAnswer));const turn={id:uid(),projectId:state.projectId,user,assistant:answer,createdAt:now()};await put(db,"turns",turn);state.turns.push(turn);captureSnapshot("Échange");project.updatedAt=now();await put(db,"projects",project);state.projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));renderProjects();}catch(e){pending.classList.add("error");pending.replaceChildren(Object.assign(document.createElement("p"),{textContent:"Réponse impossible : "+e.message}));}finally{state.busy=false;$("send-button").disabled=false;$("send-button").textContent="Envoyer";$("message-input").focus();}}
function projectDialog(p){$("project-dialog-title").textContent=p?"Modifier le projet":"Nouveau projet";$("project-name").value=p?.name||"";$("project-intention").value=p?.intention||"";$("project-dialog").dataset.id=p?.id||"";$("project-dialog").showModal();}
async function saveProject(){const name=$("project-name").value.trim();if(!name)return;const id=$("project-dialog").dataset.id,old=state.projects.find(p=>p.id===id);const p={...old,id:id||uid(),name,intention:$("project-intention").value.trim(),createdAt:old?.createdAt||now(),updatedAt:now()};await put(db,"projects",p);state.projectId=p.id;await loadProjects();document.body.classList.remove("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded","false");}
function download(name,data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function exportProject(author=""){const p=state.projects.find(x=>x.id===state.projectId);if(!p)throw Error("Aucun projet actif.");const provenance=author.trim()?{author:author.trim(),exportedAt:now(),sourceProjectId:p.originProjectId||p.id,previous:p.provenance||null}:p.provenance||null;const workspace=await get(db,"settings","workspace:"+p.id);download("icare-"+(p.name.normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9_-]+/gi,"-").slice(0,50)||"projet")+".json",{format:"icare-project-export",version:1,exportedAt:now(),project:{...p,provenance},turns:state.turns.filter(t=>t.projectId===p.id),workspace:workspace?{...workspace,id:"workspace:export"}:null});}
async function importData(file){const x=JSON.parse(await file.text());if(x.format==="icare-project-export"&&x.version===1&&x.project?.id&&x.project?.name&&Array.isArray(x.turns)){const sourceId=x.project.id,id=uid();await put(db,"projects",{...x.project,id,originProjectId:x.project.originProjectId||sourceId,importedAt:now(),createdAt:now(),updatedAt:now()});for(const t of x.turns)if(t?.id)await put(db,"turns",{...t,id:uid(),projectId:id,importedFromTurnId:t.id});if(x.workspace&&typeof x.workspace==="object"){const {id:ignored,...w}=x.workspace;await put(db,"settings",{id:"workspace:"+id,...w});}state.projectId=id;await loadProjects();await loadWorkspace();return;}if(x.format==="icare-browser-export"&&x.version===1&&Array.isArray(x.projects)&&Array.isArray(x.turns)){const ids=new Map();for(const p of x.projects)if(p.id&&p.name){const id=uid();ids.set(p.id,id);await put(db,"projects",{...p,id,originProjectId:p.originProjectId||p.id,importedAt:now(),createdAt:now(),updatedAt:now()});}for(const t of x.turns)if(t.id&&ids.has(t.projectId))await put(db,"turns",{...t,id:uid(),projectId:ids.get(t.projectId),importedFromTurnId:t.id});for(const w of x.workspaces||[]){const oldId=w.id?.slice("workspace:".length);if(w.id?.startsWith("workspace:")&&ids.has(oldId))await put(db,"settings",{...w,id:"workspace:"+ids.get(oldId)});}state.projectId=ids.values().next().value||state.projectId;await loadProjects();await loadWorkspace();return;}throw Error("Sauvegarde de projet ICARE non reconnue.");}
$("composer").addEventListener("submit",e=>{e.preventDefault();send($("message-input").value);});
$("message-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("composer").requestSubmit();}});
let recorder=null,recordingStream=null,recordedChunks=[],recordingTimer=null,recordingTest=false;
async function startAudioCapture(testOnly=false,testRoute="active"){const button=$("mic-button"),testButton=$("test-transcription"),status=$("mic-status"),config=testOnly&&testRoute==="local"?{baseUrl:$("transcription-base").value.trim(),model:$("transcription-model").value.trim(),apiKey:$("transcription-key").value.trim(),credentials:"omit"}:resolveInferenceTarget("audio");if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status.textContent="La dictée nécessite un navigateur compatible, en HTTPS, avec accès au microphone.";return;}if(!config.baseUrl||!config.model){status.textContent="Configurez un moteur de transcription et choisissez son modèle dans Configuration.";return;}try{recordingTest=testOnly;recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});recordedChunks=[];const types=["audio/webm;codecs=opus","audio/webm","audio/mp4"];const mimeType=types.find(type=>MediaRecorder.isTypeSupported(type));recorder=new MediaRecorder(recordingStream,mimeType?{mimeType}:undefined);recorder.addEventListener("dataavailable",event=>{if(event.data?.size)recordedChunks.push(event.data);});recorder.addEventListener("stop",async()=>{if(recordingTimer)clearTimeout(recordingTimer);recordingTimer=null;recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;const sourceBlob=new Blob(recordedChunks,{type:recorder.mimeType||"audio/webm"});try{status.textContent="Conversion en WAV puis transcription…";const wavBlob=await audioBlobToWav(sourceBlob);const target=config;const text=await transcribeAudio({...target,audioBlob:wavBlob,filename:"icare-dictation.wav"});if(recordingTest){$("transcription-status").textContent="✓ Transcription opérationnelle : « "+text+" »";status.textContent="Test réussi. Le modèle audio répond correctement.";}else{const input=$("message-input");input.value=(input.value.trim()?input.value.trim()+" ":"")+text;input.focus();status.textContent="Transcription ajoutée au champ de message. Vous pouvez la relire et la corriger avant l’envoi.";}}catch(error){const message="Échec de la transcription : "+error.message;if(recordingTest)$("transcription-status").textContent=message;status.textContent=message;}finally{button.disabled=false;button.textContent="🎙";button.title="Démarrer la dictée";button.setAttribute("aria-pressed","false");testButton.disabled=false;recorder=null;recordedChunks=[];recordingTest=false;}});recorder.start();if(testOnly){testButton.disabled=true;status.textContent="Test audio : parlez clairement pendant 4 secondes…";recordingTimer=setTimeout(()=>{if(recorder?.state==="recording")recorder.stop();},4000);}else{button.textContent="■";button.title="Arrêter l’enregistrement";button.setAttribute("aria-pressed","true");status.textContent="Enregistrement en cours… appuyez de nouveau sur le micro pour arrêter et transcrire.";}}catch(error){recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;button.disabled=false;testButton.disabled=false;button.textContent="🎙";status.textContent="Accès au microphone impossible : "+error.message;}}
$("mic-button").addEventListener("click",async()=>{const button=$("mic-button"),status=$("mic-status");if(recorder?.state==="recording"){recorder.stop();button.disabled=true;button.textContent="…";status.textContent="Enregistrement terminé, conversion WAV et transcription en cours…";return;}await startAudioCapture(false);});
$("test-transcription").addEventListener("click",async()=>{if(recorder?.state==="recording")return;await startAudioCapture(true,"local");});
$("test-gateway-audio")?.addEventListener("click",async()=>{if(recorder?.state==="recording")return;await startAudioCapture(true,"gateway");});
$("new-project").onclick=()=>projectDialog();$("edit-project").onclick=()=>projectDialog(state.projects.find(p=>p.id===state.projectId));
$("project-form").addEventListener("submit",async e=>{e.preventDefault();try{await saveProject();$("project-dialog").close();}catch(error){alert("Impossible d’enregistrer le projet : "+error.message);}});
$("project-select").onchange=async e=>{state.projectId=e.target.value;renderProjects();await loadTurns();await loadWorkspace();document.body.classList.remove("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded","false");};

async function saveInferenceConfiguration(){
 const status=$("routing-status"),button=$("save-inference-config");
 const routing={text:$("text-route").value,audio:$("audio-route").value};
 const sameGateway=routing.text==="gateway"&&routing.audio==="gateway"&&$("same-gateway").checked;
 const gateways={text:routing.text==="gateway"?(sameGateway?$("gateway-shared-url").value.trim():$("gateway-text-url").value.trim()):"",audio:routing.audio==="gateway"?(sameGateway?$("gateway-shared-url").value.trim():$("gateway-audio-url").value.trim()):"",sameGateway};
 const textSettings={id:"inference-text",baseUrl:$("api-base").value.trim(),model:$("api-model").value.trim(),apiKey:$("api-key").value.trim()};
 const audioSettings={id:"inference-transcription",baseUrl:$("transcription-base").value.trim(),model:$("transcription-model").value.trim(),apiKey:$("transcription-key").value.trim()};
 if(routing.text==="local"&&(!textSettings.baseUrl||!textSettings.model)){status.textContent="Configurez l’adresse et le modèle du moteur local de traitement du texte.";return;}
 if(routing.audio==="local"&&(!audioSettings.baseUrl||!audioSettings.model)){status.textContent="Configurez l’adresse et le modèle du moteur local de transcription.";return;}
 for(const kind of ["text","audio"])if(routing[kind]==="gateway"){try{const parsed=new URL(gateways[kind]);if(parsed.protocol!=="https:"||parsed.username||parsed.password)throw Error();}catch{status.textContent="Renseignez une URL HTTPS valide pour le gateway "+(kind==="text"?"de traitement du texte":"de transcription")+".";
 return;}}
 button.disabled=true;status.textContent="Vérification des gateways et enregistrement des profils…";
 try{
  const models={text:"",audio:""},configs=new Map();
  for(const kind of ["text","audio"])if(routing[kind]==="gateway"){
   const url=gateways[kind];let config=configs.get(url);
   if(!config){const base=url.replace(/\/+$/,""),configUrl=base.endsWith("/v1")?base+"/icare/config":base+"/v1/icare/config",response=await fetch(configUrl,{credentials:"include"});if(!response.ok)throw Error("Gateway inaccessible ("+response.status+"). Vérifiez la connexion et les droits.");config=await response.json();configs.set(url,config);}
   models[kind]=kind==="text"?(config.defaults?.chatModel||""):(config.defaults?.transcriptionModel||"");
   if(!models[kind])throw Error(kind==="text"?"Aucun modèle de conversation n’est attribué par le gateway.":"Aucun modèle de transcription n’est attribué par le gateway.");
  }
  await saveCredentialVault(db,{text:textSettings.apiKey,audio:audioSettings.apiKey});
  state.settings=textSettings;state.transcriptionSettings=audioSettings;state.routing=routing;state.gateways=gateways;state.gatewayModels=models;state.sameGateway=sameGateway;
  const {apiKey:textSecret,...safeText}=textSettings,{apiKey:audioSecret,...safeAudio}=audioSettings;
  await put(db,"settings",safeText);await put(db,"settings",safeAudio);
  await put(db,"settings",{id:"inference-routing",...routing});
  await put(db,"settings",{id:"inference-gateways",...gateways});
  await put(db,"settings",{id:"inference-gateway-models",...models});
  renderRoutingConfig();modelLabel();$("settings-dialog").close();
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}
$("settings-form").addEventListener("submit",async e=>{e.preventDefault();await saveInferenceConfiguration();});

$("test-provider").onclick=async()=>{const status=$("provider-status"),baseUrl=$("api-base").value.trim(),model=$("api-model").value.trim(),apiKey=$("api-key").value.trim();if(!baseUrl||!model){status.textContent="Renseignez l’adresse et le modèle du moteur local.";return;}$("test-provider").disabled=true;status.textContent="Test du modèle texte local…";try{const answer=await chatCompletion({baseUrl,model,apiKey,credentials:"omit",messages:[{role:"user",content:"Réponds uniquement : connexion réussie."}]});status.textContent="✓ Modèle texte local opérationnel — "+answer;}catch(error){status.textContent=error.message;}finally{$("test-provider").disabled=false;}};
$("load-transcription-models").onclick=async()=>{const status=$("transcription-status");status.textContent="Recherche des modèles de transcription…";try{const baseUrl=$("transcription-base").value.trim(),apiKey=$("transcription-key").value.trim(),label=$("local-preset").value==="lemonade"?"transcription":"";const models=await listModels({baseUrl,apiKey,label,credentials:"omit"});const list=$("transcription-models");list.replaceChildren();for(const model of models){const option=document.createElement("option");option.value=model;list.append(option);}status.textContent=models.length?models.length+" modèle(s) "+(label?"portant le label transcription ":"")+"trouvé(s). Choisissez un identifiant dans la liste.":"Aucun modèle de transcription trouvé dans le catalogue. Vérifiez qu’un modèle audio est disponible sur le serveur.";if(!models.length&&label)status.textContent+=" Consultez le catalogue Lemonade ou installez un modèle compatible.";}catch(error){status.textContent=error.message;}};
$("transcription-preset").addEventListener("change",e=>{const presets={openai:"https://api.openai.com/v1",ollama:"http://localhost:11434/v1",lemonade:"http://127.0.0.1:13305/v1"};if(presets[e.target.value])$("transcription-base").value=presets[e.target.value];const help={openai:"API Audio Transcriptions compatible OpenAI. Consultez la documentation du fournisseur pour les modèles et formats audio acceptés.",ollama:"Vérifiez que votre version expose un endpoint de transcription audio compatible OpenAI.",lemonade:"Lemonade expose /v1/audio/transcriptions. Son API attend un fichier WAV et un modèle portant le label « transcription ». ICARE convertit automatiquement l’enregistrement en WAV.", "":"Le serveur doit exposer un endpoint compatible /v1/audio/transcriptions. Vérifiez les formats audio et les modèles pris en charge dans sa documentation."};$("transcription-help").textContent=help[e.target.value]||help[""];});
$("close-project-dialog").onclick=()=>$("project-dialog").close();$("cancel-project").onclick=()=>$("project-dialog").close();$("close-export-dialog").onclick=()=>$("export-dialog").close();$("cancel-export").onclick=()=>$("export-dialog").close();
$("project-menu-toggle").onclick=()=>{const open=document.body.classList.toggle("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded",String(open));};$("project-menu-backdrop").onclick=()=>{document.body.classList.remove("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded","false");};
$("project-export-button").onclick=()=>{$("export-author").value="";$("export-dialog").showModal();};$("export-form").addEventListener("submit",async e=>{e.preventDefault();try{await exportProject($("export-author").value);$("export-dialog").close();}catch(error){alert(error.message);}});
$("project-import-button").onclick=()=>$("project-import-file").click();$("project-import-file").onchange=async e=>{try{if(e.target.files[0]){await importData(e.target.files[0]);alert("Projet importé. Sa provenance éventuelle a été conservée.");}}catch(err){alert(err.message);}e.target.value="";};

const DIMENSION_META={I:"Intention",C:"Contexte",A:"Action",R:"Régulation",E:"Évolution"};
const STATUS_META={unexplored:"Non exploré",insufficient:"Insuffisamment documenté",sufficient:"Suffisamment exploré",not_applicable:"Non applicable"};
const defaultWorkspace=()=>({dimensions:{I:"unexplored",C:"unexplored",A:"unexplored",R:"unexplored",E:"unexplored"},proposals:[],relations:[],referenceDocuments:[],dimensionJustifications:{},snapshots:[]});
function normaliseWorkspace(value){const d=defaultWorkspace();if(!value||typeof value!=="object")return d;for(const code of Object.keys(DIMENSION_META))if(STATUS_META[value.dimensions?.[code]])d.dimensions[code]=value.dimensions[code];d.proposals=Array.isArray(value.proposals)?value.proposals:[];d.relations=Array.isArray(value.relations)?value.relations:[];d.referenceDocuments=Array.isArray(value.referenceDocuments)?value.referenceDocuments:[];d.dimensionJustifications=value.dimensionJustifications||{};d.componentStorage=value.componentStorage&&typeof value.componentStorage==="object"&&!Array.isArray(value.componentStorage)?value.componentStorage:{};d.snapshots=Array.isArray(value.snapshots)?value.snapshots:[];return d;}
async function loadWorkspace(){state.workspace=normaliseWorkspace(await get(db,"settings","workspace:"+state.projectId));if(!state.workspace.referenceDocuments.length){state.workspace.referenceDocuments=[{id:"guide-icare",title:"Guide de la démarche ICARE",content:await (await fetch("./guide-icare.md")).text(),createdAt:now()},{id:"ontology-icare",title:"Ontologie ICARE (JSON)",content:JSON.stringify(ontology,null,2),createdAt:now()}];await saveWorkspace();}if(!state.workspace.snapshots.length)captureSnapshot("Initialisation",false);renderWorkspace();}
async function saveWorkspace(){await put(db,"settings",{id:"workspace:"+state.projectId,...state.workspace});}
function renderRadar(dimensions=state.workspace.dimensions){const order=["I","C","A","R","E"],names={I:"Intention",C:"Contexte",A:"Action",R:"Régulation",E:"Évolution"},cx=160,cy=128,r=94,grid=$("radar-grid"),labels=$("radar-labels");if(!grid||!labels)return;grid.replaceChildren();labels.replaceChildren();const ns="http://www.w3.org/2000/svg";const make=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(text)el.textContent=text;return el;};for(let ring=1;ring<=2;ring++){const points=order.map((_,i)=>{const angle=-Math.PI/2+i*2*Math.PI/5;return (cx+Math.cos(angle)*r*ring/2)+","+(cy+Math.sin(angle)*r*ring/2)}).join(" ");grid.append(make("polygon",{points,fill:"none",stroke:"#d9e0e9"}));}const values=[];for(let i=0;i<order.length;i++){const code=order[i],angle=-Math.PI/2+i*2*Math.PI/5,status=dimensions[code]||"unexplored",level=status==="sufficient"?2:status==="insufficient"?1:0,x=cx+Math.cos(angle)*r*level/2,y=cy+Math.sin(angle)*r*level/2;values.push(x+","+y);grid.append(make("line",{x1:cx,y1:cy,x2:cx+Math.cos(angle)*r,y2:cy+Math.sin(angle)*r,stroke:"#d9e0e9"}));labels.append(make("text",{x:cx+Math.cos(angle)*(r+18),y:cy+Math.sin(angle)*(r+18)+4,"text-anchor":"middle","font-size":11,"font-weight":600,fill:"#35445a"},names[code]));if(status==="not_applicable")labels.append(make("text",{x:cx+Math.cos(angle)*r*.76,y:cy+Math.sin(angle)*r*.76+4,"text-anchor":"middle","font-size":10,fill:"#9b6a28"},"N/A"));} $("radar-area").setAttribute("points",values.join(" "));}
function renderDimensionStatuses(){const host=$("dimension-statuses");if(!host)return;host.replaceChildren();for(const code of Object.keys(DIMENSION_META)){const row=document.createElement("label");row.className="dimension-status-row";const badge=document.createElement("b");badge.textContent=code;const title=document.createElement("span");title.textContent=DIMENSION_META[code];const select=document.createElement("select");select.setAttribute("aria-label","Statut "+DIMENSION_META[code]);for(const [value,label] of Object.entries(STATUS_META)){const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);}select.value=state.workspace.dimensions[code];select.addEventListener("change",async()=>{state.workspace.dimensions[code]=select.value;captureSnapshot("Statut "+code);await saveWorkspace();renderRadar();});row.append(badge,title,select);host.append(row);}}
function renderProposals(){const host=$("proposal-list");if(!host)return;host.replaceChildren();$("proposal-count").textContent=String(state.workspace.proposals.length);for(const item of [...state.workspace.proposals].reverse()){const article=document.createElement("article");article.className="proposal-item";const p=document.createElement("p");p.textContent=item.text;const meta=document.createElement("div");meta.className="proposal-meta";meta.textContent=(item.dimensions?.length?item.dimensions.join(" · "):"Dimension à préciser")+" · "+(item.status==="accepted"?"Validée":item.status==="rejected"?"Rejetée":"À valider");article.append(p,meta);if(item.status==="candidate"){const actions=document.createElement("div");actions.className="proposal-actions";for(const [status,label,cls] of [["accepted","Valider","accept"],["rejected","Rejeter","reject"]]){const button=document.createElement("button");button.type="button";button.className=cls;button.textContent=label;button.addEventListener("click",async()=>{item.status=status;item.updatedAt=now();await saveWorkspace();renderProposals();captureSnapshot("Proposition "+label.toLowerCase());});actions.append(button);}article.append(actions);}host.append(article);}for(const relation of [...(state.workspace.relations||[])].reverse()){const article=document.createElement("article");article.className="proposal-item relation-item";const from=state.workspace.proposals.find(p=>p.id===relation.fromId),to=state.workspace.proposals.find(p=>p.id===relation.toId);const title=document.createElement("p");title.textContent=(from?.text||relation.fromId)+" → "+relation.relation+" → "+(to?.text||relation.toId);const meta=document.createElement("div");meta.className="proposal-meta";meta.textContent="Relation · "+(relation.status==="accepted"?"Validée":relation.status==="rejected"?"Rejetée":"À valider")+(relation.note?" · "+relation.note:"");article.append(title,meta);host.append(article);}}
function captureSnapshot(reason="Échange",persist=true){if(!state.workspace)return;const snapshot={at:now(),reason,turns:state.turns?.length||0,dimensions:{...state.workspace.dimensions},proposals:state.workspace.proposals.length};const last=state.workspace.snapshots.at(-1);if(!last||last.turns!==snapshot.turns||JSON.stringify(last.dimensions)!==JSON.stringify(snapshot.dimensions)||last.proposals!==snapshot.proposals){state.workspace.snapshots.push(snapshot);if(persist)saveWorkspace();}renderTimeline();}
function renderTimeline(index=null){const slider=$("timeline-slider"),snaps=state.workspace?.snapshots||[];if(!slider)return;slider.disabled=snaps.length<2;slider.min="0";slider.max=String(Math.max(0,snaps.length-1));if(index===null)index=Math.max(0,snaps.length-1);index=Math.max(0,Math.min(snaps.length-1,Number(index)||0));slider.value=String(index);if(!snaps.length){$("timeline-summary").textContent="La progression apparaîtra au fil des échanges.";renderConversation(0);return;}const snap=snaps[index];renderRadar(snap.dimensions);renderConversation(snap.turns);$("timeline-start").textContent=new Date(snaps[0].at).toLocaleDateString("fr-FR");$("timeline-position").textContent=index===snaps.length-1?"État actuel":(index+1)+" / "+snaps.length;$("timeline-summary").textContent=new Date(snap.at).toLocaleString("fr-FR")+" · "+snap.reason+" · "+snap.turns+" échange(s) · "+snap.proposals+" proposition(s).";}
function renderWorkspace(){renderDimensionStatuses();renderProposals();renderTimeline();}
$("proposal-form")?.addEventListener("submit",async event=>{event.preventDefault();const text=$("proposal-text").value.trim();if(!text)return;const dimensions=[...document.querySelectorAll('input[name="proposal-dimension"]:checked')].map(x=>x.value);state.workspace.proposals.push({id:uid(),text,dimensions,status:"candidate",createdAt:now()});$("proposal-text").value="";document.querySelectorAll('input[name="proposal-dimension"]').forEach(x=>x.checked=false);$("proposal-feedback").textContent="Proposition enregistrée dans ce projet, à valider.";captureSnapshot("Nouvelle proposition");await saveWorkspace();renderProposals();});
$("timeline-slider")?.addEventListener("input",event=>renderTimeline(Number(event.target.value)));
$("api-preset")?.addEventListener("change",event=>{const preset=event.target.value,presets={openai:"https://api.openai.com/v1",ollama:"http://localhost:11434/v1",lemonade:"http://127.0.0.1:13305/v1"};if(presets[preset])$("api-base").value=presets[preset];const help={openai:"OpenAI : endpoint public HTTPS. Saisissez une clé API et chargez les modèles disponibles.",ollama:"Ollama local : http://localhost:11434/v1. Pour un site HTTPS distant, Ollama doit autoriser l’origine GitHub Pages via OLLAMA_ORIGINS. localhost désigne votre propre ordinateur.",lemonade:"Lemonade local : http://127.0.0.1:13305/v1. Pour un site HTTPS distant, le serveur doit autoriser l’origine GitHub Pages (CORS).", "":"API compatible OpenAI Chat Completions. Saisissez l’URL de base terminée par /v1."};$("provider-help").textContent=help[preset]||help[""];});

await loadOntology();await loadProjects();await loadWorkspace();await loadSettings();registerAppServiceWorker({canReload:()=>!state.busy&&!$("message-input").value.trim()}).catch(error=>console.warn("Service worker ICARE indisponible :",error));
