import { openDatabase, getAll, put, get, deleteProjectData } from "./storage.js";
import { extractPdfText } from "./pdf-processing.js";
import { renderMarkdown } from "./markdown.js";
import { chatCompletion, chatCompletionMessage, listModels, transcribeAudio, audioBlobToWav, resolveInferenceRoute, listLemonadeTranscriptionModels } from "./inference.js";
import { runAgentTurn } from "./agent.js";
import { createIcareToolExecutor } from "./workspace-tools.js";
import { loadCredentialVault, saveCredentialVault, migrateLegacyCredentials } from "./credentials.js";
import { registerAppServiceWorker } from "./pwa.js";
import { createComponentRuntime } from "./component-runtime.js";
import { initGatewayConfiguration } from "./gateway-config.js";
import { scoreIcareMultilabel, listLemonadeScoringModels } from "./scoring.js";
import { createLaboratory } from "./laboratory.js";
import { createExperimentState, createConfigurationSnapshot, createConversationBranch, recordExperimentRun, compareExperimentRuns, experimentStorageKey, remapExperimentState } from "./experiments.js";
import { executeWorkflow, DEFAULT_WORKFLOW } from "./workflow-engine.js";
import { buildBranchReplayTimeline, shouldReturnToParentBranch } from "./branch-navigation.js";
import { calculateScoreRadar, calculateExecutionRadar, SCORE_DIMENSIONS, backfillConversationScores } from "./scoring-radar.js";
const $=id=>document.getElementById(id), db=await openDatabase();
$("app-version").textContent=`— V${window.ICARE_VERSION} Alpha`;
let replaySnapshotIndex=null;
let replayMainTurnCount=null;
let replayBranchTurnCount=null;
const state={projectId:null,projects:[],turns:[],settings:{},transcriptionSettings:{},routing:{text:"local",audio:"local"},gateways:{text:"",audio:""},gatewayModels:{text:"",audio:""},sameGateway:true,scoringSettings:{apiKey:""},workspace:null,busy:false,activeBranchId:"main",replayPreferredBranchId:null,experimentState:null,selectedExperimentConfigurationId:null};
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
function snapshotWorkspaceForReplay(workspace){if(!workspace)return null;return {dimensions:{...(workspace.dimensions||{})},dimensionJustifications:{...(workspace.dimensionJustifications||{})},proposals:JSON.parse(JSON.stringify(workspace.proposals||[])),relations:JSON.parse(JSON.stringify(workspace.relations||[])),referenceDocuments:(workspace.referenceDocuments||[]).map(({id,kind,title,content,fileName,mimeType,createdAt,updatedAt})=>({id,kind,title,content,fileName,mimeType,createdAt,updatedAt}))};}
let ontology=null,gatewayRoutingConfig=null;
async function loadOntology(){try{const response=await fetch("./icare.json");if(!response.ok)throw Error("Ontologie indisponible");ontology=await response.json();}catch{ontology={dimensions:{I:"Intention / finalité",C:"Contexte / situation",A:"Action / opération",R:"Régulation / organisation",E:"Évolution / temporalité"}};}}
function attachTraceButton(article,trace,turnId=null){trace=trace||{steps:[{type:"unavailable",message:"Ce tour a été enregistré avant l’activation de la traçabilité. Les payloads historiques ne peuvent pas être reconstitués."}]};const button=document.createElement("button");button.type="button";button.className="trace-button";button.setAttribute("aria-label","Examiner la séquence de communication de cette réponse");button.title="Examiner la séquence de communication";button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h5a3 3 0 0 1 3 3v5a3 3 0 0 0 3 3h-1"/></svg><span>Séquence</span>';button.addEventListener("click",()=>showTraceDialog(trace,null,turnId));article.append(button);}
function bubble(role,text,error=false,trace=null){const el=document.createElement("article");el.className="message "+role+(error?" error":"");if(role==="assistant"&&!error){const content=document.createElement("div");content.className="message-content";content.append(renderMarkdown(text));el.append(content);if(trace!==false)attachTraceButton(el,trace);}else{const p=document.createElement("p");p.textContent=text;el.append(p);}$("messages").append(el);$("messages").scrollTop=$("messages").scrollHeight;return el;}
function appendScoreLines(article,userScores,assistantScores,userError="",assistantError=""){const content=article?.querySelector(".message-content");if(!content)return;const format=scores=>scores?SCORE_DIMENSIONS.map(code=>code+" "+Math.round(Math.max(0,Math.min(1,Number(scores[code])||0))*100)+" %").join(" · "):"indisponible";for(const [side,label,scores,error] of [["user","Votre message",userScores,userError],["assistant","Réponse ICARE",assistantScores,assistantError]]){const line=document.createElement("p");line.className="icare-score-line icare-score-"+side+(scores?"":" muted");line.textContent=label+" · "+format(scores)+(scores?"":error?" : "+error:"");line.setAttribute("aria-label",label+" : "+format(scores));content.append(line);}}
function traceEndpoint(value){try{const endpoint=new URL(String(value||""));return endpoint.origin+endpoint.pathname;}catch{return value?"[endpoint configuré]":"";}}
function traceText(value){const text=typeof value==="string"?value:JSON.stringify(value,null,2);const limit=12000;return text.length>limit?text.slice(0,limit)+"\n\n[Affichage tronqué — "+text.length+" caractères au total]":text;}
function setupTraceZoom(diagram,panel,toolbar){
 const viewport=document.createElement("div");viewport.className="trace-zoom-viewport";viewport.setAttribute("role","region");viewport.setAttribute("aria-label","Schéma de séquence zoomable");
 const canvas=document.createElement("div");canvas.className="trace-zoom-canvas";
 const zoomOut=document.createElement("button"),zoomIn=document.createElement("button"),fitBtn=document.createElement("button"),reset=document.createElement("button"),expand=document.createElement("button"),percent=document.createElement("span");
 for(const [button,label,title] of [[zoomOut,"−","Réduire le zoom"],[zoomIn,"+","Augmenter le zoom"],[fitBtn,"Ajuster","Adapter tout le schéma à la zone"],[reset,"100 %","Revenir à l’échelle réelle"],[expand,"Agrandir","Agrandir ou réduire la zone du schéma"]]){
  button.type="button";button.className="button secondary trace-zoom-control";button.textContent=label;button.title=title;button.setAttribute("aria-label",title);toolbar.append(button);
 }
 percent.className="trace-zoom-percent";percent.setAttribute("aria-live","polite");toolbar.append(percent);
 const expandButton=toolbar.querySelector('button[aria-label="Agrandir ou réduire la zone du schéma"]');
 viewport.append(canvas);diagram.append(viewport);
 let svg=null,baseWidth=0,baseHeight=0,scale=1,x=0,y=0,fitScale=1,drag=null,ready=false,suppressClick=false;
 const clamp=value=>Math.max(.15,Math.min(4,value));
 function dimensions(){const rect=viewport.getBoundingClientRect();return {width:rect.width,height:rect.height};}
 function draw(){canvas.style.transform="translate("+x+"px,"+y+"px) scale("+scale+")";percent.textContent=Math.round(scale*100)+" %";percent.title="Zoom actuel";zoomOut.disabled=scale<=.151;zoomIn.disabled=scale>=3.99;}
 function center(){const size=dimensions();x=(size.width-baseWidth*scale)/2;y=(size.height-baseHeight*scale)/2;draw();}
 function setZoom(next,cx,cy){next=clamp(next);const size=dimensions();cx=cx??size.width/2;cy=cy??size.height/2;const ratio=next/scale;x=cx-(cx-x)*ratio;y=cy-(cy-y)*ratio;scale=next;draw();}
 function fitAll(){if(!svg||!baseWidth||!baseHeight)return;const size=dimensions();fitScale=Math.min(size.width/baseWidth,size.height/baseHeight,1);scale=fitScale;center();}
 function fitWidth(){if(!svg||!baseWidth)return;const size=dimensions();scale=Math.max(.88,Math.min(size.width/baseWidth,1));x=12;y=12;draw();}
 function reset100(){scale=1;center();}
 function toggleExpand(){panel.classList.toggle("trace-diagram-expanded");expandButton.textContent=panel.classList.contains("trace-diagram-expanded")?"Réduire":"Agrandir";requestAnimationFrame(()=>{if(ready)fitWidth();});}
 zoomIn.addEventListener("click",()=>setZoom(scale*1.25));zoomOut.addEventListener("click",()=>setZoom(scale/1.25));fitBtn.addEventListener("click",fitAll);reset.addEventListener("click",reset100);expandButton.addEventListener("click",toggleExpand);
 viewport.addEventListener("wheel",event=>{event.preventDefault();const rect=viewport.getBoundingClientRect();setZoom(scale*(event.deltaY<0?1.12:1/1.12),event.clientX-rect.left,event.clientY-rect.top);},{passive:false});
 viewport.addEventListener("pointerdown",event=>{if(event.button!==0)return;if(event.target.closest?.("text.trace-payload-link"))return;drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x,y};viewport.setPointerCapture(event.pointerId);viewport.classList.add("is-panning");});
 viewport.addEventListener("pointermove",event=>{if(!drag||drag.pointerId!==event.pointerId)return;const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;x=drag.x+dx;y=drag.y+dy;draw();});
 const endDrag=event=>{if(drag?.pointerId===event.pointerId){if(drag.moved){suppressClick=true;setTimeout(()=>{suppressClick=false;},0);}drag=null;viewport.classList.remove("is-panning");}};
 viewport.addEventListener("pointerup",endDrag);viewport.addEventListener("pointercancel",endDrag);
 viewport.addEventListener("click",event=>{if(event.detail===0||suppressClick)return;if(event.target.closest(".trace-payload-link"))return;const target=event.target.closest("g");if(!target||!svg.contains(target)){return;}const box=target.getBBox(),size=dimensions();const targetScale=Math.max(scale,Math.min(1.5,Math.max(size.width/(baseWidth||1),size.height/(baseHeight||1))));setZoom(targetScale);const centerX=box.x+box.width/2,centerY=box.y+box.height/2;x=size.width/2-centerX*scale;y=size.height/2-centerY*scale;draw();});
 const observer=new MutationObserver(()=>{if(ready)return;const found=diagram.querySelector("svg");if(!found)return;svg=found;svg.removeAttribute("width");svg.removeAttribute("height");svg.style.width="";svg.style.maxWidth="none";svg.style.height="";canvas.append(svg);const box=svg.getBBox();baseWidth=Math.max(1,box.width+30);baseHeight=Math.max(1,box.height+30);svg.style.width=baseWidth+"px";svg.style.height=baseHeight+"px";canvas.style.width=baseWidth+"px";canvas.style.height=baseHeight+"px";ready=true;fitWidth();observer.disconnect();});
 observer.observe(diagram,{childList:true,subtree:true});
 let selectionHalo=null;
 function focusElement(element){if(!element||!svg?.contains(element))return;let box;try{box=element.getBBox();}catch{return;}if(!box||!Number.isFinite(box.width)||!Number.isFinite(box.height))return;
  if(!selectionHalo){selectionHalo=document.createElementNS("http://www.w3.org/2000/svg","rect");selectionHalo.classList.add("trace-selection-halo");selectionHalo.setAttribute("aria-hidden","true");selectionHalo.setAttribute("pointer-events","none");}
  const parent=element.parentNode;if(selectionHalo.parentNode!==parent)parent.insertBefore(selectionHalo,element);else parent.insertBefore(selectionHalo,element);
  const padX=Math.max(5,box.height*.32),padY=Math.max(3,box.height*.22);
  selectionHalo.setAttribute("x",String(box.x-padX));selectionHalo.setAttribute("y",String(box.y-padY));selectionHalo.setAttribute("width",String(Math.max(1,box.width+padX*2)));selectionHalo.setAttribute("height",String(Math.max(1,box.height+padY*2)));selectionHalo.setAttribute("rx",String(Math.max(3,box.height*.18)));
  let focusRect=element.getBoundingClientRect(),focusArrow=null,focusActors=[];
  try{
   const elementRect=element.getBoundingClientRect(),elementCenterY=elementRect.top+elementRect.height/2;
   const arrows=[...svg.querySelectorAll('line[class*="messageLine"], path[class*="messageLine"]')];
   focusArrow=arrows.reduce((best,node)=>{const r=node.getBoundingClientRect(),distance=Math.abs(r.top+r.height/2-elementCenterY);return !best||distance<best.distance?{node,distance}:best;},null)?.node||null;
   if(focusArrow){
    const arrowRect=focusArrow.getBoundingClientRect(),left=Math.min(elementRect.left,arrowRect.left),top=Math.min(elementRect.top,arrowRect.top),right=Math.max(elementRect.right,arrowRect.right),bottom=Math.max(elementRect.bottom,arrowRect.bottom);
    focusRect={left,top,right,bottom,width:right-left,height:bottom-top};
    const actors=[...svg.querySelectorAll("rect.actor, rect.actor-bottom")].map(node=>({node,rect:node.getBoundingClientRect(),center:node.getBoundingClientRect().left+node.getBoundingClientRect().width/2})).filter(item=>Number.isFinite(item.center));
    if(actors.length){
     const nearest=edge=>actors.reduce((best,item)=>Math.abs(item.center-edge)<Math.abs(best.center-edge)?item:best,actors[0]);
     focusActors=[...new Set([nearest(arrowRect.left).node,nearest(arrowRect.right).node])];
     for(const actor of focusActors){const r=actor.getBoundingClientRect(),l=Math.min(focusRect.left,r.left),t=Math.min(focusRect.top,r.top),rr=Math.max(focusRect.right,r.right),b=Math.max(focusRect.bottom,r.bottom);focusRect={left:l,top:t,right:rr,bottom:b,width:rr-l,height:b-t};}
    }
   }
  }catch{}
  const size=dimensions(),viewportRect=viewport.getBoundingClientRect(),safeWidth=Math.max(1,size.width*.9),safeHeight=Math.max(1,size.height*.82);
  const factor=Math.min(safeWidth/Math.max(1,focusRect.width+24),safeHeight/Math.max(1,focusRect.height+18),1.65/scale);
  let targetScale=clamp(scale*Math.max(.15,factor)),appliedFactor=targetScale/scale;
  let centerX=focusRect.left+focusRect.width/2-viewportRect.left,centerY=focusRect.top+focusRect.height/2-viewportRect.top;
  x=size.width/2-(centerX-x)*appliedFactor;y=size.height/2-(centerY-y)*appliedFactor;scale=targetScale;draw();
  if(focusArrow&&focusActors.length){
   const rects=[element,focusArrow,...focusActors].map(node=>node.getBoundingClientRect()),left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom)),width=right-left,height=bottom-top;
   const shrink=Math.min(1,safeWidth/Math.max(1,width+24),safeHeight/Math.max(1,height+18));
   if(shrink<.999){centerX=(left+right)/2-viewportRect.left;centerY=(top+bottom)/2-viewportRect.top;x=size.width/2-(centerX-x)*shrink;y=size.height/2-(centerY-y)*shrink;scale=clamp(scale*shrink);draw();}
  }
  viewport.classList.add("trace-step-focused");viewport.classList.remove("trace-focus-pulse");void viewport.offsetWidth;viewport.classList.add("trace-focus-pulse");setTimeout(()=>viewport.classList.remove("trace-focus-pulse"),850);
 }
 return {fit:fitAll,reset100,focus:focusElement};
}
async function runHistoricalExperiment(sourceTurnId,traceIndex,traceRecord){
 const sourceLine=visibleConversationTurns(),sourceIndex=sourceLine.findIndex(turn=>turn.id===sourceTurnId),sourceTurn=sourceLine[sourceIndex];
 if(!sourceTurn)throw Error("Le message historique n’est plus disponible.");
 const name=prompt("Nom de cette expérience :","Expérience "+(new Date().toLocaleString()));
 if(name===null)return;
 const laboratoryDocuments=icareLaboratory?.getSnapshot?await icareLaboratory.getSnapshot():{};
 const selectedConfigurationBranch=state.experimentState?.branches?.find(branch=>branch.configurationSnapshot?.id===state.selectedExperimentConfigurationId)||null,selectedConfiguration=selectedConfigurationBranch?.configurationSnapshot||null;
 const traceContext=laboratoryDocuments.tracePayloadContext,matchingTracePayload=traceContext?.projectId===state.projectId&&traceContext?.sourceTurnId===sourceTurnId&&traceContext?.traceIndex===traceIndex;
 const documents=selectedConfiguration?{...JSON.parse(JSON.stringify(selectedConfiguration.documents||{})),profileId:selectedConfiguration.profileId||null,"trace-payload":matchingTracePayload?laboratoryDocuments["trace-payload"]:JSON.stringify(traceRecord||{})}:{...laboratoryDocuments};
 if(!matchingTracePayload)documents["trace-payload"]=JSON.stringify(traceRecord||{});delete documents.tracePayloadContext;
 let payload=traceRecord||{};try{if(matchingTracePayload&&documents["trace-payload"])payload=JSON.parse(documents["trace-payload"]);}catch(error){throw new Error("Le payload expérimental doit être un JSON valide : "+error.message);}
 const replayMessage=payload.type==="user"&&typeof payload.content==="string"&&payload.content.trim()?payload.content:sourceTurn.user;
 if(payload.type==="prompt"&&typeof payload.content==="string")documents["system-prompt"]=payload.content;
 else if(payload.type==="model"&&typeof payload.request?.messages?.[0]?.content==="string")documents["system-prompt"]=payload.request.messages[0].content;
 const textTarget=resolveInferenceTarget("text"),scoringRoute=gatewayRoutingConfig?.routes?.scoring||"direct",scoringGatewayId=scoringRoute.startsWith("gateway-")?Number(scoringRoute.slice(-1)):0,scoringGatewayUrl=gatewayRoutingConfig?.gateways?.find(g=>g.id===scoringGatewayId)?.url||"",scoringProvider=scoringRoute==="direct"?(gatewayRoutingConfig?.directScoringProvider||"custom"):"gateway";
 const baseParameters=selectedConfiguration?.parameters||{},baseScoring=baseParameters.scoring||{},baseInference=baseParameters.inference||{};
 const snapshot=createConfigurationSnapshot({name:name.trim()||"Expérience",parentId:selectedConfiguration?.id||sourceTurn.experiment?.configurationSnapshot?.id||documents.profileId||"production",profileId:selectedConfiguration?.profileId||documents.profileId||null,documents,workflow:selectedConfiguration?.workflow||documents.workflow||null,model:selectedConfiguration?.model||textTarget.model,parameters:{...baseParameters,tracePayload:payload,inference:Object.keys(baseInference).length?baseInference:{baseUrl:textTarget.baseUrl,model:textTarget.model},scoring:Object.keys(baseScoring).length?baseScoring:{route:scoringRoute,provider:scoringProvider,gatewayUrl:scoringGatewayUrl,directUrl:gatewayRoutingConfig?.directScoringUrl||"",lemonadeBaseUrl:gatewayRoutingConfig?.directScoringBaseUrl||"http://127.0.0.1:13305",model:gatewayRoutingConfig?.directScoringModel||"",endpoint:scoringRoute==="direct"?(scoringProvider==="lemonade"?(gatewayRoutingConfig?.directScoringBaseUrl||"http://127.0.0.1:13305")+"/v1/systemone":gatewayRoutingConfig?.directScoringUrl||""):scoringGatewayUrl}}});
 const previous=createExperimentState(await get(db,"settings",experimentStoreKey())||{});
 const created=createConversationBranch(previous,{name:snapshot.name,parentBranchId:sourceTurn.experiment?.branchId||"main",sourceTurnId,sourceIndex,configurationSnapshot:snapshot,contextTurns:sourceLine.slice(0,sourceIndex),workspaceSnapshot:sourceTurn.workspaceSnapshotBefore||sourceTurn.workspaceSnapshot||snapshotWorkspaceForReplay(state.workspace),projectSnapshot:sourceTurn.projectSnapshot||(()=>{const project=state.projects.find(p=>p.id===state.projectId);return {name:project?.name||"",intention:project?.intention||""};})(),initialMessage:replayMessage});
 await put(db,"settings",{id:experimentStoreKey(),...created.state});
 $("trace-panel").hidden=true;
 await send(replayMessage,{branch:created.branch,configurationSnapshot:snapshot,sourceTurnId,sourceTraceIndex:traceIndex,contextTurns:sourceLine.slice(0,sourceIndex),workspaceSnapshot:sourceTurn.workspaceSnapshotBefore||sourceTurn.workspaceSnapshot||snapshotWorkspaceForReplay(state.workspace),projectSnapshot:sourceTurn.projectSnapshot||(()=>{const project=state.projects.find(p=>p.id===state.projectId);return {name:project?.name||"",intention:project?.intention||""};})()});
}
function showTraceDialog(trace,focusIndex=null,sourceTurnId=null){
 const panel=$("trace-panel"),diagram=$("trace-diagram"),steps=$("trace-steps");
 diagram.replaceChildren();steps.replaceChildren();
 const zoomToolbar=document.createElement("div");zoomToolbar.className="trace-zoom-toolbar";
 const zoomPanel=document.createElement("div");zoomPanel.className="trace-zoom-panel";
 diagram.append(zoomToolbar,zoomPanel);
 const zoomNavigation=setupTraceZoom(zoomPanel,diagram.closest(".trace-diagram-panel"),zoomToolbar);
 const records=[...(trace.userMessage!==undefined?[{type:"user",content:trace.userMessage}]:[]),...(Array.isArray(trace.steps)?trace.steps:[])];
 const esc=value=>String(value??"").replace(/[^\p{L}\p{N} _.-]/gu," ").replace(/\s+/g," ").trim();
 const short=(value,max=110)=>{const text=typeof value==="string"?value:JSON.stringify(value);return esc(text.length>max?text.slice(0,max)+"…":text)||"—";};
 const lines=["sequenceDiagram","autonumber","actor User as Utilisateur","participant Browser as Navigateur ICARE","participant Agent as Orchestrateur","participant LLM as Service d’inférence","participant Tools as Outils ICARE","participant Score as Service de scoring ICARE","participant DB as IndexedDB local"];
 const payloadLinks=[];
 const addPayload=(recordIndex,label,description)=>{const token="P"+(payloadLinks.length+1);payloadLinks.push({token,recordIndex});return token+" · "+description;};
 lines.push("User->>Browser: Message utilisateur · "+addPayload(0,"message","texte utilisateur"),"Note over Browser,Agent: role=system est transmis dans le payload, pas comme un acteur autonome.");
 const promptIndex=records.findIndex(item=>item.type==="prompt");
 if(promptIndex>=0)lines.push("rect rgb(232, 243, 255)","Browser->>Agent: Contexte système · "+addPayload(promptIndex,"prompt","prompt + contexte projet"),"end");
 lines.push("Browser->>Agent: Démarrer le tour");
 let modelNo=0;
 for(const [index,item] of records.entries()){
  if(item.type==="model"){
   modelNo++;const request=item.request||{};
   lines.push("rect rgb(232, 243, 255)","Agent->>LLM: Requête modèle "+modelNo+" · "+addPayload(index,"request","messages + configuration"),"end");
   lines.push("LLM-->>Agent: Réponse modèle "+modelNo+" · "+addPayload(index,"response",item.response?.tool_calls?.length?"tool_calls":"contenu"));
  }else if(item.type==="tool"){
   const name=item.call?.name||"outil";
   lines.push("rect rgb(255, 244, 220)","Agent->>Tools: "+short(name,55)+" · "+addPayload(index,"arguments","arguments JSON"),"Tools-->>Agent: Résultat · "+addPayload(index,"result","résultat JSON"),"end");
  }else if(item.type==="scoring"){
   lines.push("rect rgb(232, 243, 255)","Browser->>Score: POST scoring · "+(item.side==="assistant"?"réponse ICARE":"message utilisateur")+" · "+addPayload(index,"scoringRequest","texte + dimensions + multi_label"),"Score-->>Browser: Résultat · "+addPayload(index,"scoringResult","scores ou erreur"),"end");
  }else if(item.type==="final"){
   lines.push("rect rgb(232, 243, 255)","Agent-->>Browser: Réponse finale · "+addPayload(index,"final","texte de réponse"),"end");
  }
 }
 lines.push("Browser->>DB: put(turns) · message, réponse, trace et scores","DB-->>Browser: Transaction terminée","Browser-)DB: Snapshot temporel asynchrone","Browser->>DB: put(projects) · updatedAt","DB-->>Browser: Projet mis à jour","Note over DB: Base locale icare-browser · stores projects, turns, settings.");
 const source=lines.join("\n");
 zoomPanel.append(renderMarkdown("```mermaid\n"+source+"\n```"));
 let activeRecordIndex=null;
 const playback=document.createElement("div");playback.className="trace-playback-controls";playback.setAttribute("aria-label","Navigation pas à pas dans la trace");
 const previous=document.createElement("button");previous.type="button";previous.className="button secondary";previous.textContent="Précédent";
 const play=document.createElement("button");play.type="button";play.className="button secondary";play.textContent="Lire";
 const next=document.createElement("button");next.type="button";next.className="button secondary";next.textContent="Suivant";
 const position=document.createElement("input");position.type="range";position.min="0";position.max=String(Math.max(0,records.length-1));position.value="0";position.disabled=!records.length;position.setAttribute("aria-label","Choisir une étape de la trace");
 const counter=document.createElement("output");counter.className="trace-playback-position";counter.setAttribute("aria-live","polite");counter.textContent=records.length?"0 / "+records.length:"0 / 0";
 playback.append(previous,play,position,next,counter);diagram.append(playback);
 let playbackTimer=null;
 const stopPlayback=()=>{if(playbackTimer!==null)clearInterval(playbackTimer);playbackTimer=null;play.textContent="Lire";play.setAttribute("aria-pressed","false");};
 const selectRecord=index=>{if(!records.length)return;const target=Math.max(0,Math.min(records.length-1,Number(index)||0));const detail=steps.querySelector('.trace-step[data-trace-index="'+target+'"]');if(!detail)return;steps.querySelectorAll(".trace-step").forEach(node=>{if(node!==detail&&node.tagName==="DETAILS")node.open=false;});detail.open=true;highlightRecord(target);detail.scrollIntoView({behavior:"smooth",block:"center"});};
 previous.addEventListener("click",()=>{stopPlayback();selectRecord((activeRecordIndex??0)-1);});
 next.addEventListener("click",()=>{stopPlayback();selectRecord(activeRecordIndex===null?0:activeRecordIndex+1);});
 position.addEventListener("input",()=>{stopPlayback();selectRecord(position.value);});
 play.addEventListener("click",()=>{if(playbackTimer!==null){stopPlayback();return;}if(!records.length)return;if(activeRecordIndex===null||activeRecordIndex>=records.length-1)selectRecord(0);play.textContent="Pause";play.setAttribute("aria-pressed","true");playbackTimer=setInterval(()=>{if(activeRecordIndex>=records.length-1){stopPlayback();return;}selectRecord((activeRecordIndex??-1)+1);},1500);});
 const highlightRecord=index=>{activeRecordIndex=index;zoomPanel.querySelectorAll(".trace-payload-link").forEach(node=>{const current=Number(node.dataset.traceIndex)===index;node.classList.toggle("is-current",current);if(current)node.setAttribute("aria-current","step");else node.removeAttribute("aria-current");});steps.querySelectorAll(".trace-step").forEach(node=>{const current=Number(node.dataset.traceIndex)===index;node.classList.toggle("is-current",current);node.classList.toggle("trace-payload-highlight",current);if(current)node.setAttribute("aria-current","step");else node.removeAttribute("aria-current");});const selected=steps.querySelector('.trace-step[data-trace-index="'+index+'"]');const diagramTarget=zoomPanel.querySelector('.trace-payload-link[data-trace-index="'+index+'"]');if(diagramTarget)zoomNavigation.focus(diagramTarget);position.value=String(index);counter.textContent="Étape "+(index+1)+" / "+records.length+" · "+(selected?.querySelector("summary")?.textContent||"");previous.disabled=index<=0;next.disabled=index>=records.length-1;};
 const activatePayload=token=>{stopPlayback();const link=payloadLinks.find(item=>item.token===token);if(!link)return;const detail=steps.querySelector('[data-trace-index="'+link.recordIndex+'"]');if(detail){steps.querySelectorAll(".trace-step").forEach(node=>{if(node!==detail&&node.tagName==="DETAILS")node.open=false;});detail.open=true;highlightRecord(link.recordIndex);detail.scrollIntoView({behavior:"smooth",block:"center"});}};
 const diagramObserver=new MutationObserver(()=>{const svg=zoomPanel.querySelector("svg");if(!svg)return;diagramObserver.disconnect();for(const textNode of svg.querySelectorAll("text")){const match=textNode.textContent.match(/\bP[0-9]+\b/);if(!match)continue;const link=payloadLinks.find(item=>item.token===match[0]);if(!link)continue;textNode.classList.add("trace-payload-link");textNode.dataset.traceIndex=String(link.recordIndex);textNode.setAttribute("role","button");textNode.setAttribute("tabindex","0");textNode.setAttribute("aria-label","Ouvrir le payload "+match[0]);textNode.addEventListener("click",event=>{event.stopPropagation();activatePayload(match[0]);});textNode.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();event.stopPropagation();activatePayload(match[0]);}});}});

 diagramObserver.observe(zoomPanel,{childList:true,subtree:true});
 const note=document.createElement("p");note.className="trace-sequence-caption";note.textContent="Séquence reconstruite à partir des échanges réellement enregistrés pour ce tour : les appels d’outils n’apparaissent que s’ils ont eu lieu. Les repères P1, P2… sont cliquables et ouvrent le payload correspondant ci-dessous.";diagram.append(note);
 let documentViewer=null;
 for(const [index,item] of records.entries()){
  const details=document.createElement("details");details.className="trace-step";details.dataset.traceIndex=String(index);
  const summary=document.createElement("summary");
  summary.textContent=(index+1)+". "+(item.type==="user"?"Message utilisateur":item.type==="tool"?"Outil · "+(item.call?.name||""):item.type==="scoring"?"Scoring ICARE · "+(item.side==="assistant"?"réponse ICARE":"message utilisateur"):item.type==="final"?"Réponse finale":item.type==="prompt"?"Prompt système et contexte":"Appel modèle · étape "+(item.step||""));
  details.append(summary);
  const payload=document.createElement("pre");payload.textContent=traceText(item);details.append(payload);details.addEventListener("click",event=>{if(event.target.closest("summary")){stopPlayback();highlightRecord(index);}});details.addEventListener("toggle",()=>{if(details.open)highlightRecord(index);});
  const documents=item.result?.results;
  if(Array.isArray(documents)){for(const docRef of documents){if(!docRef?.id)continue;const open=document.createElement("button");open.type="button";open.className="button secondary trace-document-open";open.textContent="Consulter le document : "+(docRef.title||docRef.id);open.setAttribute("aria-expanded","false");open.addEventListener("click",()=>{if(documentViewer?.dataset.documentId===docRef.id){documentViewer.remove();documentViewer=null;for(const button of steps.querySelectorAll(".trace-document-open"))button.setAttribute("aria-expanded","false");return;}if(documentViewer)documentViewer.remove();for(const button of steps.querySelectorAll(".trace-document-open"))button.setAttribute("aria-expanded","false");const local=state.workspace?.referenceDocuments?.find(entry=>entry.id===docRef.id);documentViewer=document.createElement("details");documentViewer.className="trace-step trace-document-viewer";documentViewer.dataset.documentId=docRef.id;const heading=document.createElement("summary");heading.textContent=local?.title||docRef.title||docRef.id;const content=document.createElement("pre");content.textContent=local?.content||"Ce document n’est plus présent dans le corpus local de ce projet.";documentViewer.append(heading,content);details.after(documentViewer);documentViewer.open=true;open.setAttribute("aria-expanded","true");});details.append(open);}}
  if(sourceTurnId){const experimentButton=document.createElement("button");experimentButton.type="button";experimentButton.className="button primary trace-experiment-link";experimentButton.textContent="Créer une branche expérimentale depuis ce payload";experimentButton.addEventListener("click",async()=>{experimentButton.disabled=true;experimentButton.textContent="Rejeu expérimental…";try{await runHistoricalExperiment(sourceTurnId,index,item);}catch(error){experimentButton.disabled=false;experimentButton.textContent="Créer une branche expérimentale depuis ce payload";alert("Expérience impossible : "+error.message);}});details.append(experimentButton);}const labButton=document.createElement("button");labButton.type="button";labButton.className="button secondary trace-laboratory-link";labButton.textContent="Examiner dans le laboratoire";labButton.textContent="Modifier ce payload dans le laboratoire";labButton.addEventListener("click",()=>window.openIcareLaboratory?.({docId:"trace-payload",tracePayload:item,trace,traceIndex:index,sourceTurnId,projectId:state.projectId}));details.append(labButton);
  steps.append(details);
 }
 if(!records.length){const p=document.createElement("p");p.textContent="Aucune trace détaillée n’a été enregistrée pour ce tour.";steps.append(p);}
 panel.classList.remove("trace-panel-fullscreen");panel.hidden=false;panel.scrollIntoView({behavior:"smooth",block:"nearest"});if(Number.isInteger(focusIndex))selectRecord(focusIndex);
}
window.openIcareTrace=showTraceDialog;
function renderProjects(){const s=$("project-select"),list=$("project-list");s.replaceChildren();list.replaceChildren();for(const p of state.projects){const o=document.createElement("option");o.value=p.id;o.textContent=p.name;o.selected=p.id===state.projectId;s.append(o);const row=document.createElement("div");row.className="project-row"+(p.id===state.projectId?" is-active":"");row.dataset.projectId=p.id;row.setAttribute("role","listitem");const select=document.createElement("button");select.type="button";select.className="project-row-name";select.textContent=p.name;select.title=p.name;select.setAttribute("aria-current",p.id===state.projectId?"page":"false");select.addEventListener("click",async()=>{state.projectId=p.id;replaySnapshotIndex=null;renderProjects();await loadTurns();await loadWorkspace();});const actions=document.createElement("div");actions.className="project-row-actions";const rename=document.createElement("button");rename.type="button";rename.className="project-row-action";rename.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.1 2.1 0 0 0-3-3L4 16.5Z"/><path d="m14.8 6.7 3 3"/></svg>';rename.title="Renommer "+p.name;rename.setAttribute("aria-label","Renommer "+p.name);rename.addEventListener("click",()=>projectDialog(p));const saveButton=document.createElement("button");saveButton.type="button";saveButton.className="project-row-action";saveButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg>';saveButton.title="Sauvegarder le projet "+p.name;saveButton.setAttribute("aria-label","Sauvegarder "+p.name);saveButton.addEventListener("click",async()=>{try{await exportProject(p.id);}catch(error){alert(error.message);}});const remove=document.createElement("button");remove.type="button";remove.className="project-row-action is-destructive";remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>';remove.title="Supprimer le projet "+p.name;remove.setAttribute("aria-label","Supprimer "+p.name);remove.addEventListener("click",async()=>{try{await deleteProject(p.id);}catch(error){alert("Impossible de supprimer le projet : "+error.message);}});actions.append(rename,saveButton,remove);row.append(select,actions);list.append(row);}const active=state.projects.find(x=>x.id===state.projectId);if(active){$("project-title").textContent=active.name;$("project-description").textContent=active.intention||"Un espace privé pour explorer un système.";}}
function appendConversationVariants(host,sourceTurn){const branches=(state.experimentState?.branches||[]).filter(branch=>branch.sourceTurnId===sourceTurn.id);if(!branches.length)return;const runs=state.experimentState?.runs||[],panel=document.createElement("section");panel.className="conversation-variants";panel.setAttribute("aria-label","Comparaison des réponses variantes");const heading=document.createElement("h4");heading.textContent="Comparer les réponses";panel.append(heading);const grid=document.createElement("div");grid.className="conversation-variant-grid";for(const branch of branches){const run=runs.filter(item=>item.branchId===branch.id).at(-1),card=document.createElement("article");card.className="conversation-variant-card";const title=document.createElement("strong");title.textContent=branch.name+" · "+(branch.configurationSnapshot?.name||"Configuration");const body=document.createElement("div");body.className="conversation-variant-content";body.textContent=run?.assistantMessage||"Réponse en cours…";const label=document.createElement("label"),choice=document.createElement("input");choice.type="radio";choice.name="preferred-variant-"+sourceTurn.id;choice.checked=Boolean(branch.preferred);choice.disabled=!run;choice.addEventListener("change",async()=>{for(const sibling of branches)sibling.preferred=sibling.id===branch.id;await put(db,"settings",{id:experimentStoreKey(),...state.experimentState});renderConversation();});label.append(choice,document.createTextNode(" Retenir cette réponse"));card.append(title,body,label);grid.append(card);}panel.append(grid);host.append(panel);}
async function createConversationVariant(sourceTurn,button){if(state.busy)throw Error("Attendez la fin de la réponse en cours avant de créer une variante.");const sourceLine=visibleConversationTurns(),sourceIndex=sourceLine.findIndex(turn=>turn.id===sourceTurn.id);if(sourceIndex<0)throw Error("Le message source n’est plus disponible dans cette conversation.");const name=prompt("Nom de cette variante :","Variante "+(new Date().toLocaleString("fr-FR")));if(name===null)return;button.disabled=true;button.textContent="Préparation…";try{const selectedBranch=state.experimentState?.branches?.find(branch=>branch.configurationSnapshot?.id===state.selectedExperimentConfigurationId),selected=selectedBranch?.configurationSnapshot||null,documents=selected?JSON.parse(JSON.stringify(selected.documents||{})):await icareLaboratory.getSnapshot(),target=resolveInferenceTarget("text"),route=gatewayRoutingConfig?.routes?.scoring||"direct",gatewayId=route.startsWith("gateway-")?Number(route.slice(-1)):0,gatewayUrl=gatewayRoutingConfig?.gateways?.find(g=>g.id===gatewayId)?.url||"",profileId=selected?.profileId||documents.profileId||null;let workflow=selected?.workflow||null;try{if(!workflow&&documents.workflow)workflow=JSON.parse(documents.workflow);}catch(error){throw new Error("Configuration du workflow invalide : "+error.message);}const configuration=createConfigurationSnapshot({name:name.trim()||"Variante",parentId:selected?.id||sourceTurn.experiment?.configurationSnapshot?.id||profileId||"production",profileId,documents,workflow,model:selected?.model||target.model,parameters:{...(selected?.parameters||{}),inference:selected?.parameters?.inference||{baseUrl:target.baseUrl,model:target.model},scoring:selected?.parameters?.scoring||{route,provider:route==="direct"?(gatewayRoutingConfig?.directScoringProvider||"custom"):"gateway",gatewayUrl,directUrl:gatewayRoutingConfig?.directScoringUrl||"",lemonadeBaseUrl:gatewayRoutingConfig?.directScoringBaseUrl||"http://127.0.0.1:13305",model:gatewayRoutingConfig?.directScoringModel||""}}});const contextTurns=sourceLine.slice(0,sourceIndex),project=state.projects.find(item=>item.id===state.projectId),workspaceSnapshot=sourceTurn.workspaceSnapshotBefore||sourceTurn.workspaceSnapshot||snapshotWorkspaceForReplay(state.workspace),projectSnapshot=sourceTurn.projectSnapshot||{name:project?.name||"",intention:project?.intention||""},created=createConversationBranch(state.experimentState,{name:configuration.name,parentBranchId:sourceTurn.experiment?.branchId||"main",sourceTurnId:sourceTurn.id,sourceIndex,configurationSnapshot:configuration,contextTurns,workspaceSnapshot,projectSnapshot,initialMessage:sourceTurn.user});state.experimentState=created.state;state.activeBranchId=created.branch.id;state.selectedExperimentConfigurationId=configuration.id;await put(db,"settings",{id:experimentStoreKey(),...state.experimentState});renderExperimentBranches();renderConversation();renderActiveConfigurationStatus();await send(sourceTurn.user,{branch:created.branch,configurationSnapshot:configuration,sourceTurnId:sourceTurn.id,sourceTraceIndex:null,contextTurns,workspaceSnapshot,projectSnapshot});}finally{button.disabled=false;button.textContent="Créer une variante";}}
function renderConversation(turnCount=state.turns.length){const all=visibleConversationTurns(),requested=Number(turnCount),count=Number.isFinite(requested)?Math.max(0,Math.min(all.length,requested)):all.length,turns=all.slice(0,count);$("messages").replaceChildren();if(!turns.length){bubble("assistant","Bienvenue dans votre espace ICARE. Vos données restent dans ce navigateur. Décrivez le système que vous souhaitez explorer.",false,false);return;}for(const t of turns){const user=bubble("user",t.user);const variantButton=document.createElement("button");variantButton.type="button";variantButton.className="button secondary conversation-variant-create";variantButton.textContent="Créer une variante";variantButton.addEventListener("click",async()=>{try{await createConversationVariant(t,variantButton);}catch(error){alert("Création de la variante impossible : "+error.message);variantButton.disabled=false;variantButton.textContent="Créer une variante";}});user.append(variantButton);const answer=bubble("assistant",t.assistant,false,false);if(t.trace)attachTraceButton(answer,t.trace,t.id);if(t.userScores||t.scores||t.assistantScores||t.scoringError)appendScoreLines(answer,t.userScores??t.scores,t.assistantScores,t.userScoringError??t.scoringError,t.assistantScoringError??t.scoringError);if(!state.activeBranchId||state.activeBranchId==="main")appendConversationVariants(answer,t);}}
const experimentStoreKey=()=>experimentStorageKey(state.projectId);
async function loadTurns(){state.turns=(await getAll(db,"turns")).filter(t=>t.projectId===state.projectId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));state.experimentState=createExperimentState(await get(db,"settings",experimentStoreKey())||{});state.activeBranchId="main";state.replayPreferredBranchId=null;state.selectedExperimentConfigurationId=null;replaySnapshotIndex=null;replayMainTurnCount=null;replayBranchTurnCount=null;renderExperimentBranches();renderConversation(state.turns.length);renderScoringRadar();renderProjectTimeline();renderActiveConfigurationStatus();}
function renderExperimentBranches(){
 const select=$("conversation-branch-select");if(select){const previous=state.activeBranchId||"main";select.replaceChildren(new Option("Conversation originale","main"));for(const branch of state.experimentState?.branches||[])select.add(new Option(branch.name+" · "+branch.configurationSnapshot?.name,branch.id));select.value=previous;}
 const configurations=$("experiment-configuration-select");if(configurations){const previous=state.selectedExperimentConfigurationId;configurations.replaceChildren(new Option("Configuration de production",""));const seen=new Set();for(const branch of state.experimentState?.branches||[]){const snapshot=branch.configurationSnapshot;if(!snapshot?.id||seen.has(snapshot.id))continue;seen.add(snapshot.id);configurations.add(new Option(snapshot.name+" · "+new Date(snapshot.createdAt).toLocaleString("fr-FR"),snapshot.id));}configurations.value=seen.has(previous)?previous:"";}
 renderBranchExplorer();
}
function activateBranchExplorerNode(branchId,{focus=true,turnCount=null}={}){
 state.activeBranchId=branchId||"main";if(state.activeBranchId!=="main")state.replayPreferredBranchId=state.activeBranchId;else state.replayPreferredBranchId=null;
 const branch=state.experimentState?.branches?.find(item=>item.id===state.activeBranchId);
 state.selectedExperimentConfigurationId=branch?.configurationSnapshot?.id||null;
 replaySnapshotIndex=null;
 replayBranchTurnCount=turnCount;
 if(state.activeBranchId==="main"&&turnCount!==null){const snapshots=state.workspace?.snapshots||[];const targetTurns=Math.max(0,Number(turnCount));replayMainTurnCount=targetTurns;const eligible=snapshots.map((snapshot,index)=>({snapshot,index})).filter(item=>Number(item.snapshot.turns||0)<=targetTurns);replaySnapshotIndex=eligible.length?eligible.at(-1).index:null;replayBranchTurnCount=null;}
 renderExperimentBranches();renderConversation();renderScoringRadar();renderProjectTimeline();renderActiveConfigurationStatus();
 if(focus)$("conversation-branch-tree")?.focus({preventScroll:true});
}
function renderBranchExplorer(){
 const tree=$("conversation-branch-tree");if(!tree)return;tree.tabIndex=0;
 const branches=state.experimentState?.branches||[],active=state.activeBranchId||"main";
 const countLabel=$("branch-explorer-count");if(countLabel)countLabel.textContent=branches.length+" branche(s)";
 tree.replaceChildren();tree.setAttribute("aria-label","Arbre temporel des conversations. Les échanges hérités sont représentés une seule fois sur leur branche d'origine.");
 const canonical=state.turns.filter(turn=>!turn.experiment?.branchId);
 const maxColumns=Math.max(1,canonical.length,...branches.map(branch=>Number(branch.sourceIndex??branch.contextTurnIds?.length??0)+1+state.turns.filter(turn=>turn.experiment?.branchId===branch.id).length));
 const makeDot=(parent,{label,kind="turn",branchId="main",position=1,selectPosition=position,activeDot=false})=>{
  const dot=document.createElement("button");dot.type="button";dot.className="branch-time-dot"+(kind==="fork"?" is-fork":"")+(activeDot?" is-current":"");dot.style.gridColumn=String(position);dot.title=label;dot.setAttribute("aria-label",label);dot.dataset.branchId=branchId;
  dot.addEventListener("click",()=>{
   if(branchId==="main"){state.replayPreferredBranchId=null;activateBranchExplorerNode("main",{focus:false});const snapshots=state.workspace?.snapshots||[];const targetTurns=Math.min(canonical.length,position);let index=-1;snapshots.forEach((snapshot,i)=>{if(Number(snapshot.turns||0)<=targetTurns)index=i;});if(index>=0)showProjectHistory(index);else{replaySnapshotIndex=null;replayMainTurnCount=targetTurns;renderConversation(targetTurns);renderScoringRadar(targetTurns);renderProjectTimeline();renderBranchExplorer();}tree.focus({preventScroll:true});}
   else{activateBranchExplorerNode(branchId,{focus:false});showBranchHistory(selectPosition);tree.focus({preventScroll:true});}
  });parent.append(dot);return dot;
 };
 const makeLane=(branch,parent,{root=false,depth=1}={})=>{
  const id=root?"main":branch.id,own=root?canonical:state.turns.filter(turn=>turn.experiment?.branchId===id),lineage=root?null:buildBranchReplayTimeline(state.turns,branch);
  const sourceIndex=root?0:lineage.sourceIndex,forkColumn=root?1:lineage.sourcePosition;
  const lane=document.createElement("section");lane.className="branch-lane"+(root?" branch-lane-root":"")+(id===active?" is-active":"");lane.dataset.branchId=id;lane.setAttribute("role","treeitem");lane.setAttribute("aria-selected",String(id===active));lane.setAttribute("aria-level",String(depth));
  const heading=document.createElement("div");heading.className="branch-lane-heading";
  const choice=document.createElement("button");choice.type="button";choice.className="branch-lane-choice"+(id===active?" is-active":"");choice.dataset.branchId=id;choice.textContent=root?"Conversation originale":branch.name;choice.setAttribute("aria-current",String(id===active));choice.title=root?"Conversation de référence":(branch.configurationSnapshot?.name||"Configuration de la variante");choice.addEventListener("click",()=>activateBranchExplorerNode(id));heading.append(choice);
  const info=document.createElement("div");info.className="branch-lane-info";
  if(!root){const source=branch.initialMessage||state.turns.find(turn=>turn.id===branch.sourceTurnId)?.user||"";const contextText=String(source).replace(/\s+/g," ").trim();const snippet=document.createElement("span");snippet.className="branch-lane-prompt";snippet.textContent=contextText||"Message de départ non renseigné";snippet.title=contextText;info.append(snippet);const config=document.createElement("a");config.className="branch-lane-config";config.href="#experiment-configuration-select";config.textContent=branch.configurationSnapshot?.name||"Configuration non précisée";config.addEventListener("click",event=>{event.preventDefault();state.selectedExperimentConfigurationId=branch.configurationSnapshot?.id||null;renderActiveConfigurationStatus();$("experiment-configuration-select")?.focus();});info.append(config);}
  else{const ref=document.createElement("span");ref.className="branch-lane-prompt";ref.textContent="Conversation de référence";info.append(ref);}
  heading.append(info);lane.append(heading);
  const track=document.createElement("div");track.className="branch-lane-track"+(root?"":" is-branch-track");track.style.setProperty("--timeline-columns",String(maxColumns));track.style.setProperty("--fork-column",String(forkColumn));
  const line=document.createElement("span");line.className="branch-time-line";line.setAttribute("aria-hidden","true");track.append(line);
  if(root){const mainVisibleCount=replaySnapshotIndex===null?(replayMainTurnCount??canonical.length):Math.min(canonical.length,Number(state.workspace?.snapshots?.[replaySnapshotIndex]?.turns)||0);own.forEach((turn,index)=>makeDot(track,{label:"Échange "+(index+1)+(turn.createdAt?" · "+new Date(turn.createdAt).toLocaleString("fr-FR"):""),branchId:"main",position:index+1,activeDot:active==="main"&&index===mainVisibleCount-1}));}
  else{
   makeDot(track,{label:"Message source · échange "+forkColumn,kind:"fork",branchId:id,position:forkColumn,selectPosition:lineage.sourceSelectionCount,activeDot:active===id&&(replayBranchTurnCount===lineage.sourceSelectionCount||(replayBranchTurnCount===null&&!own.length))});
   lineage.variantNodes.forEach(({turn,position,selectionCount},index)=>makeDot(track,{label:"Échange de la variante "+(index+1)+(turn.createdAt?" · "+new Date(turn.createdAt).toLocaleString("fr-FR"):""),branchId:id,position,selectPosition:selectionCount,activeDot:active===id&&(replayBranchTurnCount===selectionCount||(replayBranchTurnCount===null&&index===lineage.variantNodes.length-1))}));
   if(lineage.emptyMarker){const empty=document.createElement("span");empty.className="branch-time-dot is-empty";empty.style.gridColumn=String(lineage.emptyMarker.position);empty.textContent="×";empty.setAttribute("role","img");empty.setAttribute("aria-label",lineage.emptyMarker.label);empty.title=lineage.emptyMarker.label;track.append(empty);}
  }
  lane.append(track);parent.append(lane);
  const children=branches.filter(item=>(item.parentBranchId||"main")===id);
  if(children.length){const groups=new Map();for(const child of children){const fork=Number(child.sourceIndex??child.contextTurnIds?.length??0);if(!groups.has(fork))groups.set(fork,[]);groups.get(fork).push(child);}
   for(const [fork,siblings] of groups){const childGroup=document.createElement("div");childGroup.className="branch-lane-children";childGroup.style.setProperty("--fork-column",String(fork+1));childGroup.setAttribute("aria-label",siblings.length+" variante(s) issues du même échange");lane.append(childGroup);siblings.forEach(child=>makeLane(child,childGroup,{depth:depth+1}));}
  }
 };
 makeLane(null,tree,{root:true,depth:1});
}
function visibleConversationTurns(){if(!state.activeBranchId||state.activeBranchId==="main")return state.turns.filter(turn=>!turn.experiment?.branchId);const branch=state.experimentState?.branches?.find(item=>item.id===state.activeBranchId);if(!branch)return state.turns.filter(turn=>!turn.experiment?.branchId);return buildBranchReplayTimeline(state.turns,branch).turns;}
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
 const gatewayModels=await get(db,"settings","inference-gateway-models")||{};
 const config=gatewayRoutingConfig||{routes:{llm:"direct",audio:"direct",scoring:"direct"},gateways:[],directScoringUrl:""};
 const gatewayUrl=route=>route==="direct"?"":(config.gateways||[]).find(g=>g.id===Number(String(route).slice(-1)))?.url||"";
 state.routing={text:config.routes.llm==="direct"?"local":"gateway",audio:config.routes.audio==="direct"?"local":"gateway"};
 state.gateways={text:gatewayUrl(config.routes.llm)||legacyGateway.url||"",audio:gatewayUrl(config.routes.audio)||legacyGateway.url||""};
 state.gatewayModels={text:gatewayModels.text||legacyModels.chatModel||"",audio:gatewayModels.audio||legacyModels.transcriptionModel||""};
 state.sameGateway=!!state.gateways.text&&state.gateways.text===state.gateways.audio;
 $("direct-scoring-url").value=config.directScoringUrl||"";
 const credentials=await migrateLegacyCredentials(db,{text:state.settings.apiKey||sessionStorage.getItem("icare-api-key")||"",audio:state.transcriptionSettings.apiKey||sessionStorage.getItem("icare-transcription-api-key")||"",scoring:"",legacy:legacy.apiKey||""});
 state.settings.apiKey=credentials.text;state.transcriptionSettings.apiKey=credentials.audio;state.scoringSettings.apiKey=credentials.scoring;
 sessionStorage.removeItem("icare-api-key");sessionStorage.removeItem("icare-transcription-api-key");
 const {apiKey:legacyKey,rememberKey:legacyRemember,...safeLegacy}=legacy;
 const {apiKey:textKey,rememberKey:textRemember,...safeText}=state.settings;
 const {apiKey:audioKey,rememberKey:audioRemember,...safeAudio}=state.transcriptionSettings;
 await put(db,"settings",{...safeLegacy,id:"inference"});await put(db,"settings",{...safeText,id:"inference-text"});await put(db,"settings",{...safeAudio,id:"inference-transcription"});
 $("api-base").value=state.settings.baseUrl||"";$("api-model").value=state.settings.model||"";$("api-key").value=state.settings.apiKey||"";$("api-preset").value=detectPreset(state.settings.baseUrl);$("api-preset").dispatchEvent(new Event("change"));
 $("transcription-base").value=state.transcriptionSettings.baseUrl||"";$("transcription-model").value=state.transcriptionSettings.model||"";$("transcription-key").value=state.transcriptionSettings.apiKey||"";$("transcription-preset").value=detectPreset(state.transcriptionSettings.baseUrl);$("transcription-preset").dispatchEvent(new Event("change"));
 modelLabel();
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
function setSettingsTab(mode){
 const gateway=mode==="gateway";
 $("settings-tab-direct").setAttribute("aria-selected",String(!gateway));$("settings-tab-gateway").setAttribute("aria-selected",String(gateway));
 $("settings-panel-direct").hidden=gateway;$("settings-panel-gateway").hidden=!gateway;
 localStorage.setItem("icare-settings-tab",gateway?"gateway":"direct");
}
$("settings-tab-direct").addEventListener("click",()=>setSettingsTab("direct"));
$("settings-tab-gateway").addEventListener("click",()=>setSettingsTab("gateway"));
$("settings-button").addEventListener("click",()=>{$("settings-dialog").showModal();setSettingsTab(localStorage.getItem("icare-settings-tab")==="gateway"?"gateway":"direct");rememberDialogForm($("settings-dialog"));});
function dialogFormSnapshot(dialog){const form=dialog.querySelector("form");const controls=form?[...form.elements]:[...dialog.querySelectorAll("input,textarea,select")];return controls.map(control=>({name:control.name||control.id||"",type:control.type||"",value:control.type==="checkbox"||control.type==="radio"?control.checked:control.value}));}
function rememberDialogForm(dialog){dialog.dataset.initialForm=JSON.stringify(dialogFormSnapshot(dialog));dialog.dataset.dirty="false";}
function closeDialogFromBackdrop(dialog){if(dialog.id==="settings-dialog"||dialog.id==="project-dialog"||dialog.id==="export-dialog"){const changed=dialog.dataset.dirty==="true"||(dialog.dataset.initialForm!==undefined&&dialog.dataset.initialForm!==JSON.stringify(dialogFormSnapshot(dialog)));if(changed&&!window.confirm("Des modifications ne sont pas enregistrées. Voulez-vous vraiment fermer cette fenêtre et les abandonner ?"))return;}dialog.close();}
document.addEventListener("input",event=>{const dialog=event.target.closest?.("dialog");if(dialog?.dataset.initialForm!==undefined)dialog.dataset.dirty="true";},true);
document.addEventListener("change",event=>{const dialog=event.target.closest?.("dialog");if(dialog?.dataset.initialForm!==undefined)dialog.dataset.dirty="true";},true);
for(const dialog of document.querySelectorAll("dialog")){dialog.addEventListener("click",event=>{if(event.target===dialog)closeDialogFromBackdrop(dialog);});dialog.addEventListener("cancel",event=>{event.preventDefault();closeDialogFromBackdrop(dialog);});}

$("close-settings-dialog").addEventListener("click",()=>closeDialogFromBackdrop($("settings-dialog")));
$("load-models").addEventListener("click",async()=>{const status=$("provider-status");status.textContent="Chargement du catalogue…";try{const target={baseUrl:$("api-base").value.trim(),model:$("api-model").value.trim(),apiKey:$("api-key").value.trim(),credentials:"omit"};const models=await listModels(target);const list=$("available-models");list.replaceChildren();for(const model of models){const option=document.createElement("option");option.value=model;list.append(option);}status.textContent=models.length+" modèle(s) trouvé(s). Vous pouvez aussi saisir un identifiant manuellement.";}catch(error){status.textContent=error.message;}});
async function complete(messages){return chatCompletion({...resolveInferenceTarget("text"),messages});}
async function completeAgent(messages,tools){return chatCompletionMessage({...resolveInferenceTarget("text"),messages,tools});}
async function executeIcareTool(name,args,executionContext=null){
 const execute=createIcareToolExecutor({
  workspace:executionContext?.workspace||state.workspace,
  ontology:executionContext?.ontology||ontology,
  persist:executionContext?.persist||saveWorkspace,
  snapshot:executionContext?.snapshot||captureSnapshot,
  render:executionContext?.render||renderWorkspace,
  listModels:()=>listModels(resolveInferenceTarget("text")),
  componentRuntime,
  uid,
  now
 });
 return execute(name,args);
}
let icareLaboratory=null;
function renderActiveConfigurationStatus(){const status=$("active-configuration-status");if(!status)return;const branch=state.experimentState?.branches?.find(item=>item.id===state.activeBranchId),mode=branch?"experiment":(icareLaboratory?.getMode?.()||"production"),profile=icareLaboratory?.getProfileName?.(),prompt=icareLaboratory?.getActivePromptName?.();const branchPrompt=branch?.configurationSnapshot?.documents?.activePromptName;status.textContent=branch?"Variante active · "+branch.name+" · configuration figée · Prompt : "+(branchPrompt||"version commune") :mode==="laboratory"?"Personnalisations locales actives · "+(profile||"profil personnel")+" · Prompt : "+(prompt||"version commune"):"Version commune · configuration de production · Prompt : version commune";status.dataset.mode=mode;}
async function activeScoringQuestionPayload(){if(!icareLaboratory)return null;try{return JSON.parse(await icareLaboratory.getContent("scoring-payload"));}catch(error){console.warn("Payload de scoring personnalisé indisponible :",error);return null;}}
async function systemPrompt(configurationSnapshot=null){let activeOntology=ontology;let prompt="Tu es ICARE, un partenaire méthodologique systémique et maïeutique. Garde en vue I Intention, C Contexte, A Action, R Régulation et E Évolution. Distingue faits, perceptions, hypothèses et incertitudes. Ne décide jamais à la place de la personne. Pose généralement une seule question utile à la fois.";let guide=state.workspace?.referenceDocuments?.find(document=>document.id==="guide-icare")?.content||"";try{const r=await fetch("./system-prompt.md");if(r.ok)prompt=await r.text();}catch{}let referenceContent=state.workspace?.referenceDocuments?.find(document=>document.id==="icare-reference")?.content||"";if(configurationSnapshot?.documents){prompt=configurationSnapshot.documents["system-prompt"]||prompt;guide=configurationSnapshot.documents["guide-icare"]||guide;referenceContent=configurationSnapshot.documents["referentiel"]||referenceContent;try{if(configurationSnapshot.documents.ontology)activeOntology=JSON.parse(configurationSnapshot.documents.ontology);}catch{}}else if(icareLaboratory){prompt=await icareLaboratory.getContent("system-prompt")||prompt;guide=await icareLaboratory.getContent("guide-icare")||guide;referenceContent=await icareLaboratory.getContent("referentiel")||referenceContent;try{ontology=JSON.parse(await icareLaboratory.getContent("ontology"));activeOntology=ontology;}catch{}}if(!guide){try{const r=await fetch("./guide-icare.md");if(r.ok)guide=await r.text();}catch{}}const referenceDocument=state.workspace?.referenceDocuments?.find(document=>document.id==="icare-reference");if(!configurationSnapshot&&referenceDocument&&referenceContent&&referenceDocument.content!==referenceContent){referenceDocument.content=referenceContent;referenceDocument.updatedAt=now();await saveWorkspace();}return prompt+"\n\nGUIDE MÉTHODOLOGIQUE ICARE (référence)\n"+guide+"\n\nONTOLOGIE STRUCTURÉE ICARE (source de référence)\n"+JSON.stringify(activeOntology)+"\n\nRÉFÉRENTIEL ICARE COMPLET : document disponible dans le corpus documentaire du projet via search_reference_documents. Ne le récite pas intégralement et ne le consulte pas mécaniquement à chaque message. Consulte-le dès que la réponse dépend d’une définition, d’une dimension, d’une relation systémique, d’une posture ou d’une recommandation méthodologique propre à ICARE. Recherche les notions pertinentes avec une requête ciblée, puis appuie explicitement ton analyse sur les passages retrouvés. Si la demande est purement conversationnelle ou sans enjeu méthodologique, une recherche n’est pas nécessaire. Ne prétends jamais avoir consulté le référentiel si l’outil n’a pas été appelé avec succès.";}
async function send(text,experimentOptions=null){
 if(state.busy||!text.trim())return;
 if(!experimentOptions&&state.activeBranchId&&state.activeBranchId!=="main"){const branch=state.experimentState?.branches?.find(item=>item.id===state.activeBranchId);if(branch){const lastRun=state.turns.filter(turn=>turn.experiment?.branchId===branch.id).at(-1),sourceTurn=state.turns.find(turn=>turn.id===branch.sourceTurnId);experimentOptions={branch,configurationSnapshot:branch.configurationSnapshot,sourceTurnId:branch.sourceTurnId,sourceTraceIndex:branch.sourceIndex,contextTurns:visibleConversationTurns(),workspaceSnapshot:lastRun?.workspaceSnapshotAfter||branch.workspaceSnapshot||sourceTurn?.workspaceSnapshotBefore||sourceTurn?.workspaceSnapshot||state.workspace,projectSnapshot:branch.projectSnapshot||sourceTurn?.projectSnapshot||state.projects.find(p=>p.id===state.projectId)};}}
 const user=text.trim(),project=state.projects.find(p=>p.id===state.projectId),replayProject=experimentOptions?.projectSnapshot||project;replaySnapshotIndex=null;replayBranchTurnCount=null;renderConversation(state.turns.length);renderScoringRadar(state.turns.length);renderProjectTimeline();const userBubble=bubble("user",user);$("message-input").value="";state.busy=true;$("send-button").disabled=true;$("send-button").textContent="Réponse…";const pending=bubble("assistant","ICARE réfléchit…");
 try{
  const conversationTurns=experimentOptions?.contextTurns||visibleConversationTurns(),history=conversationTurns.slice(-16).flatMap(t=>[{role:"user",content:t.user},{role:"assistant",content:t.assistant}]);
  const replayWorkspace=experimentOptions?.workspaceSnapshot||state.workspace,initialWorkspaceSnapshot=snapshotWorkspaceForReplay(replayWorkspace);const workspaceContext=replayWorkspace?{dimensions:replayWorkspace.dimensions,proposals:(replayWorkspace.proposals||[]).slice(-40).map(({id,text,dimensions,status,createdAt,updatedAt})=>({id,text,dimensions,status,createdAt,updatedAt}))}:null;
  const projectContext="\\nPROJET ACTUEL : "+replayProject.name+(replayProject.intention?"\\nINTENTION DU PROJET : "+replayProject.intention:"")+"\\nÉTAT ACTUEL DU TABLEAU ICARE (contexte de travail, distinct des faits validés) :\\n"+JSON.stringify(workspaceContext,null,2);
  const systemContent=(await systemPrompt(experimentOptions?.configurationSnapshot||null))+projectContext+"\\n\\nÉVALUATION AUTOMATIQUE ICARE : le workflow évalue le message utilisateur avant la génération, transmet ces scores au modèle dans le contexte du tour, puis évalue séparément ta réponse finale sur les cinq dimensions I, C, A, R et E. Les deux résultats alimentent le radar et l’historique du projet. Le scoring est une étape applicative du workflow, pas un outil à appeler. Tu n’as pas à contacter toi-même un endpoint, à demander à l’utilisateur de lancer le scoring, ni à prétendre que tu ne peux pas y accéder. Ne fournis pas de scores supposés et ne prétends pas connaître les résultats avant qu’ils soient calculés.\\n\\nOUTILS DISPONIBLES : utilise réellement les outils pour enregistrer les observations substantielles, proposer les relations, consulter ou modifier le référentiel et mettre à jour les statuts lorsque cela est justifié. Une action d’écriture exige un appel d’outil réussi. Les propositions restent candidates à validation humaine. Ne modifie pas un statut sans justification explicite.";
  const trace={version:1,createdAt:now(),userMessage:user,steps:[{type:"prompt",content:systemContent,history:history.length,currentUserMessage:user}]};
  const scoringSnapshot=experimentOptions?.configurationSnapshot?.parameters?.scoring||{},scoringRoute=scoringSnapshot.route||gatewayRoutingConfig?.routes?.scoring||"direct",gatewayId=scoringRoute.startsWith("gateway-")?Number(scoringRoute.slice(-1)):0,gatewayUrl=scoringSnapshot.gatewayUrl||gatewayRoutingConfig?.gateways?.find(g=>g.id===gatewayId)?.url||"",scoringGateway=gatewayRoutingConfig?.gateways?.find(g=>g.id===gatewayId)||null,scoringProvider=scoringSnapshot.provider||(scoringRoute==="direct"?(gatewayRoutingConfig?.directScoringProvider||"custom"):"gateway"),scoringEndpoint=scoringSnapshot.endpoint||(scoringRoute==="direct"?(scoringProvider==="lemonade"?(gatewayRoutingConfig?.directScoringBaseUrl||"http://127.0.0.1:13305")+"/v1/systemone":gatewayRoutingConfig?.directScoringUrl||""):gatewayUrl);
  const scoreText=async(side,content)=>{try{const tracePayload=experimentOptions?.configurationSnapshot?.parameters?.tracePayload;if(tracePayload?.type==="scoring"&&tracePayload.side===side&&typeof tracePayload.request?.text==="string")content=tracePayload.request.text;const scoringQuestions=experimentOptions?.configurationSnapshot?.documents?.["scoring-payload"]?JSON.parse(experimentOptions.configurationSnapshot.documents["scoring-payload"]):(icareLaboratory?JSON.parse(await icareLaboratory.getContent("scoring-payload")):null);const result=await scoreIcareMultilabel({text:content,questionPayload:scoringQuestions,route:scoringRoute,gatewayUrl,directUrl:scoringSnapshot.directUrl||gatewayRoutingConfig?.directScoringUrl||"",provider:scoringProvider,lemonadeBaseUrl:scoringSnapshot.lemonadeBaseUrl||gatewayRoutingConfig?.directScoringBaseUrl||"http://127.0.0.1:13305",model:scoringSnapshot.model||gatewayRoutingConfig?.directScoringModel||"",apiKey:scoringRoute==="direct"?state.scoringSettings.apiKey:""});const scores=Object.fromEntries(SCORE_DIMENSIONS.map(code=>[code,Number.isFinite(Number(result.scores?.[code]))?Math.max(0,Math.min(1,Number(result.scores[code]))):0]));trace.steps.push({type:"scoring",side,route:scoringRoute,provider:scoringProvider,model:scoringProvider==="lemonade"?gatewayRoutingConfig?.directScoringModel||"":null,gatewayName:scoringGateway?.name||null,endpoint:traceEndpoint(scoringEndpoint),request:{text:content,dimensions:SCORE_DIMENSIONS,multi_label:true,independentQuestions:scoringProvider==="lemonade"},result:scores,error:null});return {scores,error:""};}catch(error){trace.steps.push({type:"scoring",side,route:scoringRoute,provider:scoringProvider,model:scoringProvider==="lemonade"?gatewayRoutingConfig?.directScoringModel||"":null,gatewayName:scoringGateway?.name||null,endpoint:traceEndpoint(scoringEndpoint),request:{text:content,dimensions:SCORE_DIMENSIONS,multi_label:true,independentQuestions:scoringProvider==="lemonade"},result:null,error:error.message});console.warn("Scoring ICARE indisponible ("+side+") :",error);return {scores:null,error:error.message};}};
  let workflow=DEFAULT_WORKFLOW;
  try{const source=experimentOptions?.configurationSnapshot?.documents?.workflow||(icareLaboratory?await icareLaboratory.getContent("workflow"):null);if(source)workflow=JSON.parse(source);}catch(error){throw new Error("Configuration du workflow invalide : "+error.message);}
  const currentTarget=resolveInferenceTarget("text"),inferenceSnapshot=experimentOptions?.configurationSnapshot?.parameters?.inference||{},target={...currentTarget,baseUrl:inferenceSnapshot.baseUrl||currentTarget.baseUrl,model:inferenceSnapshot.model||experimentOptions?.configurationSnapshot?.model||currentTarget.model};let agentResult=null;const executionWorkspace=experimentOptions?JSON.parse(JSON.stringify(replayWorkspace||{})):null;const experimentOntology=experimentOptions?.configurationSnapshot?.documents?.ontology?JSON.parse(experimentOptions.configurationSnapshot.documents.ontology):ontology;if(executionWorkspace&&experimentOptions?.configurationSnapshot?.documents?.referentiel){const reference=executionWorkspace.referenceDocuments?.find(item=>item.id==="icare-reference");if(reference)reference.content=experimentOptions.configurationSnapshot.documents.referentiel;}
  const workflowResult=await executeWorkflow(workflow,{context:{userMessage:user,history,systemContent},executors:{
   score:async({step,input})=>({...await scoreText(step.side||"user",String(input??"")),side:step.side||"user"}),
   model:async({step,context})=>{const workflowContext=(step.include||[]).map(key=>({key,value:context[key]}));const prompt=systemContent+(workflowContext.length?"\\n\\nCONTEXTE PRODUIT PAR LE WORKFLOW :\\n"+JSON.stringify(workflowContext,null,2):"");const rawRequest=experimentOptions?.configurationSnapshot?.parameters?.tracePayload?.type==="model"?experimentOptions.configurationSnapshot.parameters.tracePayload.request||{}:{},allowedRequestKeys=["temperature","top_p","max_tokens","frequency_penalty","presence_penalty","seed","stop"],requestOverrides=Object.fromEntries(allowedRequestKeys.filter(key=>rawRequest[key]!==undefined).map(key=>[key,rawRequest[key]])),completeForExperiment=experimentOptions?((messages,tools)=>chatCompletionMessage({...target,messages,tools,...requestOverrides})):completeAgent;agentResult=await runAgentTurn({messages:[{role:"system",content:prompt},...history,{role:"user",content:user}],complete:completeForExperiment,executeTool:(name,args)=>{if(experimentOptions&&name==="invoke_wasi_component")throw new Error("Les composants WASI à effets persistants sont désactivés dans une branche expérimentale.");const selected=experimentOptions?.configurationSnapshot?.parameters?.tracePayload,override=selected?.type==="tool"&&selected.call?.name===name?selected.call.arguments:null;return executeIcareTool(name,override||args,executionWorkspace?{workspace:executionWorkspace,ontology:experimentOntology,persist:async()=>{},snapshot:()=>{},render:()=>{}}:null);},traceContext:{capability:"llm",route:state.routing.text,endpoint:traceEndpoint(target.baseUrl),model:target.model}});trace.steps.push(...(agentResult.trace||[]));return agentResult.content||"Les opérations ont été exécutées, mais le modèle n’a pas fourni de réponse finale.";},
   tool:async({step,input})=>{if(experimentOptions&&step.name==="invoke_wasi_component")throw new Error("Les composants WASI à effets persistants sont désactivés dans une branche expérimentale.");const selected=experimentOptions?.configurationSnapshot?.parameters?.tracePayload,override=selected?.type==="tool"&&selected.call?.name===step.name?selected.call.arguments:null;const hasConfiguredArgs=step.args&&typeof step.args==="object"&&Object.keys(step.args).length>0,toolInput=override||(hasConfiguredArgs?step.args:input||{}),toolArguments=step.name==="search_reference_documents"&&typeof toolInput==="string"?{query:toolInput}:toolInput;return executeIcareTool(step.name,toolArguments,executionWorkspace?{workspace:executionWorkspace,ontology:experimentOntology,persist:async()=>{},snapshot:()=>{},render:()=>{}}:null);},
   transform:async({step,context})=>{if(step.operation==="pick")return context[step.path];if(step.operation==="literal")return step.value;throw new Error("Transformation non autorisée : "+step.operation);},
   output:async({input})=>input
  }});
  trace.steps.push({type:"workflow",trace:workflowResult.trace,configuration:workflow});
  const modelStepId=workflow.steps.filter(step=>step.type==="model").at(-1)?.id,outputStepId=workflow.steps.find(step=>step.type==="output")?.id,answer=String(workflowResult.values[outputStepId]??workflowResult.values[modelStepId]??"Le workflow s’est terminé sans étape de génération de réponse."),renderedAnswer=answer+(agentResult?.executed?.length?"\\n\\n✓ "+agentResult.executed.length+" opération(s) ICARE exécutée(s).":"");
  pending.replaceChildren(Object.assign(document.createElement("div"),{className:"message-content"}));pending.querySelector(".message-content").append(renderMarkdown(renderedAnswer));
  const scoreResults=Object.values(workflowResult.values).filter(value=>value&&typeof value==="object"&&("scores" in value)&&("side" in value)),userScore=scoreResults.find(value=>value.side==="user")||{scores:null,error:"Aucune étape de scoring utilisateur dans le workflow."},assistantScore=scoreResults.find(value=>value.side==="assistant")||{scores:null,error:"Aucune étape de scoring de la réponse dans le workflow."};trace.steps.push({type:"final",content:answer});
  appendScoreLines(pending,userScore.scores,assistantScore.scores,userScore.error,assistantScore.error);
  const turn={id:uid(),projectId:state.projectId,user,assistant:answer,trace,workspaceSnapshotBefore:initialWorkspaceSnapshot,workspaceSnapshotAfter:snapshotWorkspaceForReplay(executionWorkspace||state.workspace),projectSnapshot:{name:replayProject.name,intention:replayProject.intention||""},...(experimentOptions?{experiment:{branchId:experimentOptions.branch.id,configurationSnapshot:experimentOptions.configurationSnapshot,sourceTurnId:experimentOptions.sourceTurnId,sourceTraceIndex:experimentOptions.sourceTraceIndex}}:{}),scores:userScore.scores,userScores:userScore.scores,assistantScores:assistantScore.scores,userScoringError:userScore.error,assistantScoringError:assistantScore.error,scoringError:userScore.error||assistantScore.error,scoreBackfillVersion:userScore.scores&&assistantScore.scores?1:0,createdAt:now()};
  const variantButton=document.createElement("button");variantButton.type="button";variantButton.className="button secondary conversation-variant-create";variantButton.textContent="Créer une variante";variantButton.addEventListener("click",async()=>{try{await createConversationVariant(turn,variantButton);}catch(error){alert("Création de la variante impossible : "+error.message);variantButton.disabled=false;variantButton.textContent="Créer une variante";}});userBubble.append(variantButton);
  attachTraceButton(pending,trace,turn.id);
  await put(db,"turns",turn);state.turns.push(turn);if(experimentOptions){const current=createExperimentState(await get(db,"settings",experimentStoreKey())||{});const recorded=recordExperimentRun(current,{branchId:experimentOptions.branch.id,configurationId:experimentOptions.configurationSnapshot?.id,sourceTurnId:experimentOptions.sourceTurnId,userMessage:user,assistantMessage:answer,trace,model:experimentOptions.configurationSnapshot?.model||resolveInferenceTarget("text").model,parameters:experimentOptions.configurationSnapshot?.parameters||{},scores:{user:userScore.scores,assistant:assistantScore.scores},workspaceSnapshotAfter:turn.workspaceSnapshotAfter});await put(db,"settings",{id:experimentStoreKey(),...recorded.state});state.experimentState=recorded.state;state.activeBranchId=experimentOptions.branch.id;renderExperimentBranches();renderConversation();renderProjectTimeline();renderActiveConfigurationStatus();}renderScoringRadar();if(!experimentOptions)captureSnapshot("Échange");project.updatedAt=now();await put(db,"projects",project);state.projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));renderProjects();
 }catch(error){pending.classList.add("error");pending.replaceChildren(Object.assign(document.createElement("p"),{textContent:"Réponse impossible : "+error.message}));}
 finally{state.busy=false;$("send-button").disabled=false;$("send-button").textContent="Envoyer";$("message-input").focus();}
}
function hideTracePanel(){$("trace-panel").hidden=true;$("trace-panel").classList.remove("trace-panel-fullscreen");}
document.addEventListener("pointerdown",event=>{const panel=$("trace-panel");if(!panel.hidden&&!panel.contains(event.target))hideTracePanel();},true);
$("close-trace-dialog").addEventListener("click",hideTracePanel);
function projectDialog(p){$("project-dialog-title").textContent=p?"Modifier le projet":"Nouveau projet";$("project-name").value=p?.name||"";$("project-intention").value=p?.intention||"";$("project-dialog").dataset.id=p?.id||"";$("project-dialog").showModal();rememberDialogForm($("project-dialog"));}
async function deleteProject(projectId){const project=state.projects.find(item=>item.id===projectId);if(!project)throw Error("Projet introuvable.");if(!window.confirm("Supprimer définitivement le projet « "+project.name+" » ?\n\nSon historique, ses données ICARE et ses documents locaux seront également supprimés. Cette action est irréversible."))return false;const wasActive=state.projectId===projectId;await deleteProjectData(db,projectId);state.projects=state.projects.filter(item=>item.id!==projectId);if(wasActive)state.projectId=state.projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.id||null;await loadProjects();if(wasActive)await loadWorkspace();return true;}
async function saveProject(){const name=$("project-name").value.trim();if(!name)return;const id=$("project-dialog").dataset.id,old=state.projects.find(p=>p.id===id);const p={...old,id:id||uid(),name,intention:$("project-intention").value.trim(),createdAt:old?.createdAt||now(),updatedAt:now()};await put(db,"projects",p);state.projectId=p.id;await loadProjects();await loadWorkspace();document.body.classList.remove("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded","false");}
function download(name,data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function exportProject(projectId=state.projectId,author=""){const p=state.projects.find(x=>x.id===projectId);if(!p)throw Error("Projet introuvable.");const provenance=p.provenance||null;const workspace=await get(db,"settings","workspace:"+p.id),experiments=await get(db,"settings",experimentStorageKey(p.id)),turns=(await getAll(db,"turns")).filter(t=>t.projectId===p.id);download("icare-"+(p.name.normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9_-]+/gi,"-").slice(0,50)||"projet")+".json",{format:"icare-project-export",version:1,exportedAt:now(),project:{...p,provenance},turns,workspace:workspace?{...workspace,id:"workspace:export"}:null,experiments:experiments||null});}
async function importData(file){const x=JSON.parse(await file.text());if(x.format==="icare-project-export"&&x.version===1&&x.project?.id&&x.project?.name&&Array.isArray(x.turns)){const sourceId=x.project.id,id=uid(),turnIdMap=new Map(x.turns.filter(turn=>turn?.id).map(turn=>[turn.id,uid()]));await put(db,"projects",{...x.project,id,originProjectId:x.project.originProjectId||sourceId,importedAt:now(),createdAt:now(),updatedAt:now()});for(const t of x.turns)if(t?.id){const imported={...t,id:turnIdMap.get(t.id),projectId:id,importedFromTurnId:t.id};if(imported.experiment?.sourceTurnId)imported.experiment={...imported.experiment,sourceTurnId:turnIdMap.get(imported.experiment.sourceTurnId)||null};await put(db,"turns",imported);}if(x.workspace&&typeof x.workspace==="object"){const {id:ignored,...w}=x.workspace;await put(db,"settings",{id:"workspace:"+id,...w});}if(x.experiments&&typeof x.experiments==="object"){const experiments=remapExperimentState(x.experiments,turnIdMap);await put(db,"settings",{id:experimentStorageKey(id),...experiments});}state.projectId=id;await loadProjects();await loadWorkspace();return;}if(x.format==="icare-browser-export"&&x.version===1&&Array.isArray(x.projects)&&Array.isArray(x.turns)){const ids=new Map();for(const p of x.projects)if(p.id&&p.name){const id=uid();ids.set(p.id,id);await put(db,"projects",{...p,id,originProjectId:p.originProjectId||p.id,importedAt:now(),createdAt:now(),updatedAt:now()});}for(const t of x.turns)if(t.id&&ids.has(t.projectId))await put(db,"turns",{...t,id:uid(),projectId:ids.get(t.projectId),importedFromTurnId:t.id});for(const w of x.workspaces||[]){const oldId=w.id?.slice("workspace:".length);if(w.id?.startsWith("workspace:")&&ids.has(oldId))await put(db,"settings",{...w,id:"workspace:"+ids.get(oldId)});}state.projectId=ids.values().next().value||state.projectId;await loadProjects();await loadWorkspace();return;}throw Error("Sauvegarde de projet ICARE non reconnue.");}
$("conversation-branch-select")?.addEventListener("change",event=>{state.activeBranchId=event.target.value||"main";const branch=state.experimentState?.branches?.find(item=>item.id===state.activeBranchId);state.selectedExperimentConfigurationId=branch?.configurationSnapshot?.id||null;replaySnapshotIndex=null;replayBranchTurnCount=null;renderExperimentBranches();renderConversation();renderScoringRadar();renderProjectTimeline();renderActiveConfigurationStatus();});
$("experiment-configuration-select")?.addEventListener("change",event=>{state.selectedExperimentConfigurationId=event.target.value||null;});
function renderExperimentComparisonChoices(){
 const left=$("experiment-compare-left"),right=$("experiment-compare-right"),runs=state.experimentState?.runs||[];
 const label=run=>{const branch=state.experimentState?.branches?.find(item=>item.id===run.branchId);return (branch?.name||"Branche")+" · "+new Date(run.createdAt).toLocaleString("fr-FR")+" · "+String(run.userMessage||"").slice(0,70);};
 for(const select of [left,right]){const previous=select.value;select.replaceChildren();for(const run of runs){const option=new Option(label(run),run.id);option.dataset.branchId=run.branchId;select.add(option);}if(runs.some(run=>run.id===previous))select.value=previous;}
 if(runs.length>1){left.selectedIndex=0;right.selectedIndex=runs.length-1;}
}
$("compare-experiments-open")?.addEventListener("click",()=>{renderExperimentComparisonChoices();$("experiment-comparison-result").replaceChildren();$("experiment-comparison-dialog").showModal();});
$("experiment-comparison-close")?.addEventListener("click",()=>$("experiment-comparison-dialog").close());
function comparisonContextTurns(branch){
 if(!branch)return [];
 if(Array.isArray(branch.contextTurnIds))return branch.contextTurnIds.map(id=>state.turns.find(turn=>turn.id===id)).filter(Boolean);
 return Array.isArray(branch.contextTurns)?branch.contextTurns:[];
}
function renderComparisonRadar(run){
 const branch=state.experimentState?.branches?.find(item=>item.id===run.branchId),context=comparisonContextTurns(branch);
 const branchRuns=(state.experimentState?.runs||[]).filter(item=>item.branchId===run.branchId).sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
 const scores=calculateExecutionRadar(context,branchRuns,run.id),svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
 svg.setAttribute("viewBox","0 0 250 220");svg.setAttribute("role","img");svg.setAttribute("aria-label","Radar cumulatif de cette exécution : moyenne utilisateur et moyenne ICARE");
 const ns="http://www.w3.org/2000/svg",cx=125,cy=106,r=70,angles=SCORE_DIMENSIONS.map((_,i)=>-Math.PI/2+i*2*Math.PI/5);
 const make=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));if(text)el.textContent=text;return el;};
 for(const ring of [.25,.5,.75,1])svg.append(make("polygon",{points:angles.map(angle=>(cx+Math.cos(angle)*r*ring)+","+(cy+Math.sin(angle)*r*ring)).join(" "),fill:"none",stroke:"currentColor","stroke-opacity":".25","stroke-width":1}));
 for(let i=0;i<angles.length;i++){const angle=angles[i];svg.append(make("line",{x1:cx,y1:cy,x2:cx+Math.cos(angle)*r,y2:cy+Math.sin(angle)*r,stroke:"currentColor","stroke-opacity":".3","stroke-width":1}));svg.append(make("text",{x:cx+Math.cos(angle)*(r+14),y:cy+Math.sin(angle)*(r+14)+3,"text-anchor":"middle","font-size":10,"font-weight":700,fill:"currentColor"},SCORE_DIMENSIONS[i]));}
 for(const [kind,vector,color] of [["user",scores.userAverage,"#258da5"],["assistant",scores.assistantAverage,"#d66b4d"]]){const points=SCORE_DIMENSIONS.map((code,i)=>(cx+Math.cos(angles[i])*r*vector[code])+","+(cy+Math.sin(angles[i])*r*vector[code])).join(" ");svg.append(make("polygon",{points,fill:color,"fill-opacity":".16",stroke:color,"stroke-width":2,"data-radar-series":kind}));}
 const caption=document.createElement("p");caption.className="comparison-radar-caption";caption.textContent=scores.observations+" échange(s) cumulés · moyenne par dimension";
 const wrap=document.createElement("div");wrap.className="experiment-comparison-radar";wrap.append(svg,caption);return wrap;
}
function renderComparisonExecutionCard(title,run){
 const branch=state.experimentState?.branches?.find(item=>item.id===run.branchId),card=document.createElement("article");
 card.className="experiment-comparison-run-card";
 const heading=document.createElement("h4");heading.textContent=title+" · "+(branch?.name||"Branche");
 const configuration=document.createElement("p");configuration.className="muted comparison-run-configuration";configuration.textContent=branch?.configurationSnapshot?.name||run.configurationId||"Configuration";
 const dialogue=document.createElement("div");dialogue.className="experiment-comparison-dialogue";
 for(const [label,text] of [["Utilisateur",run.userMessage],["Réponse ICARE",run.assistantMessage]]){const section=document.createElement("section"),strong=document.createElement("strong"),content=document.createElement("pre");strong.textContent=label;content.textContent=text||"Aucun contenu enregistré.";section.append(strong,content);dialogue.append(section);}
 card.append(heading,configuration,dialogue,renderComparisonRadar(run));return card;
}
$("experiment-compare-run")?.addEventListener("click",()=>{
 const runs=state.experimentState?.runs||[],left=runs.find(run=>run.id===$("experiment-compare-left").value),right=runs.find(run=>run.id===$("experiment-compare-right").value),box=$("experiment-comparison-result");box.replaceChildren();
 if(!left||!right){box.textContent="Sélectionnez deux exécutions enregistrées.";return;}
 const result=compareExperimentRuns(left,right),summary=document.createElement("p");summary.textContent="Même message source : "+(result.sameSource?"oui":"non")+" · Message utilisateur identique : "+(result.sameMessage?"oui":"non")+" · Réponse différente : "+(result.assistantChanged?"oui":"non")+" · Configurations : "+result.configurationIds.join(" → ");box.append(summary);
 const scores=document.createElement("table"),head=document.createElement("tr");for(const title of ["Dimension","Utilisateur A","Utilisateur B","Écart utilisateur","Écart réponse"]){const th=document.createElement("th");th.textContent=title;head.append(th);}scores.append(head);
 for(const code of ["I","C","A","R","E"]){const row=document.createElement("tr");for(const value of [code,Math.round((Number(left.scores?.user?.[code]??left.scores?.[code])||0)*100)+" %",Math.round((Number(right.scores?.user?.[code]??right.scores?.[code])||0)*100)+" %",(result.scoreDelta[code]*100).toFixed(1)+" pts",(result.assistantScoreDelta[code]*100).toFixed(1)+" pts"]){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}scores.append(row);}box.append(scores);
 const runGrid=document.createElement("div");runGrid.className="experiment-comparison-run-grid";runGrid.append(renderComparisonExecutionCard("Exécution A",left),renderComparisonExecutionCard("Exécution B",right));box.append(runGrid);
});

$("composer").addEventListener("submit",e=>{e.preventDefault();send($("message-input").value);});
$("message-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("composer").requestSubmit();}});
let recorder=null,recordingStream=null,recordedChunks=[],recordingTimer=null,recordingTest=false;
async function startAudioCapture(testOnly=false,testRoute="active"){const button=$("mic-button"),testButton=$("test-transcription"),status=$("mic-status"),config=testOnly&&testRoute==="local"?{baseUrl:$("transcription-base").value.trim(),model:$("transcription-model").value.trim(),apiKey:$("transcription-key").value.trim(),credentials:"omit"}:resolveInferenceTarget("audio");if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status.textContent="La dictée nécessite un navigateur compatible, en HTTPS, avec accès au microphone.";return;}if(!config.baseUrl||!config.model){status.textContent="Configurez un moteur de transcription et choisissez son modèle dans Configuration.";return;}try{recordingTest=testOnly;recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});recordedChunks=[];const types=["audio/webm;codecs=opus","audio/webm","audio/mp4"];const mimeType=types.find(type=>MediaRecorder.isTypeSupported(type));recorder=new MediaRecorder(recordingStream,mimeType?{mimeType}:undefined);recorder.addEventListener("dataavailable",event=>{if(event.data?.size)recordedChunks.push(event.data);});recorder.addEventListener("stop",async()=>{if(recordingTimer)clearTimeout(recordingTimer);recordingTimer=null;recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;const sourceBlob=new Blob(recordedChunks,{type:recorder.mimeType||"audio/webm"});try{status.textContent="Conversion en WAV puis transcription…";const wavBlob=await audioBlobToWav(sourceBlob);const target=config;const text=await transcribeAudio({...target,audioBlob:wavBlob,filename:"icare-dictation.wav"});if(recordingTest){$("transcription-status").textContent="✓ Transcription opérationnelle : « "+text+" »";status.textContent="Test réussi. Le modèle audio répond correctement.";}else{const input=$("message-input");input.value=(input.value.trim()?input.value.trim()+" ":"")+text;input.focus();status.textContent="Transcription ajoutée au champ de message. Vous pouvez la relire et la corriger avant l’envoi.";}}catch(error){const message="Échec de la transcription : "+error.message;if(recordingTest)$("transcription-status").textContent=message;status.textContent=message;}finally{button.disabled=false;button.textContent="🎙";button.title="Démarrer la dictée";button.setAttribute("aria-pressed","false");testButton.disabled=false;recorder=null;recordedChunks=[];recordingTest=false;}});recorder.start();if(testOnly){testButton.disabled=true;status.textContent="Test audio : parlez clairement pendant 4 secondes…";recordingTimer=setTimeout(()=>{if(recorder?.state==="recording")recorder.stop();},4000);}else{button.textContent="■";button.title="Arrêter l’enregistrement";button.setAttribute("aria-pressed","true");status.textContent="Enregistrement en cours… appuyez de nouveau sur le micro pour arrêter et transcrire.";}}catch(error){recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;button.disabled=false;testButton.disabled=false;button.textContent="🎙";status.textContent="Accès au microphone impossible : "+error.message;}}
$("mic-button").addEventListener("click",async()=>{const button=$("mic-button"),status=$("mic-status");if(recorder?.state==="recording"){recorder.stop();button.disabled=true;button.textContent="…";status.textContent="Enregistrement terminé, conversion WAV et transcription en cours…";return;}await startAudioCapture(false);});
$("test-transcription").addEventListener("click",async()=>{if(recorder?.state==="recording")return;await startAudioCapture(true,"local");});
$("test-gateway-audio")?.addEventListener("click",async()=>{if(recorder?.state==="recording")return;if(!gatewayRoutingConfig?.routes?.audio||gatewayRoutingConfig.routes.audio==="direct"){$("transcription-status").textContent="Sélectionnez d’abord une Gateway pour la transcription dans l’onglet Gateway.";return;}await startAudioCapture(true,"gateway");});
$("new-project").onclick=()=>projectDialog();
$("project-form").addEventListener("submit",async e=>{e.preventDefault();try{await saveProject();$("project-dialog").close();}catch(error){alert("Impossible d’enregistrer le projet : "+error.message);}});
$("project-select").onchange=async e=>{state.projectId=e.target.value;renderProjects();await loadTurns();await loadWorkspace();document.body.classList.remove("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded","false");};

async function saveInferenceConfiguration(){
 const status=$("routing-status"),button=$("save-inference-config");
 const textSettings={id:"inference-text",baseUrl:$("api-base").value.trim(),model:$("api-model").value.trim(),apiKey:$("api-key").value.trim()};
 const audioSettings={id:"inference-transcription",baseUrl:$("transcription-base").value.trim(),model:$("transcription-model").value.trim(),apiKey:$("transcription-key").value.trim()};
 const config=gatewayRoutingConfig||{routes:{llm:"direct",audio:"direct",scoring:"direct"},gateways:[],directScoringUrl:""};
 if(config.routes.llm==="direct"&&(!textSettings.baseUrl||!textSettings.model)){status.textContent="Configurez l’adresse et le modèle du moteur direct de traitement du texte.";return;}
 if(config.routes.audio==="direct"&&(!audioSettings.baseUrl||!audioSettings.model)){status.textContent="Configurez l’adresse et le modèle du moteur direct de transcription.";return;}
 if(config.routes.audio==="direct"&&$("transcription-preset").value==="lemonade"&&!/-FLM$/i.test(audioSettings.model)){status.textContent="Pour partager le NPU avec le scoring, choisissez un modèle ASR FastFlowLM du catalogue Lemonade (identifiant se terminant par -FLM), pas un modèle whisper.cpp.";return;}
 const scoringProvider=$("direct-scoring-provider").value;
 const scoringBaseUrl=$("direct-scoring-base").value.trim();
 const scoringModel=$("direct-scoring-model").value.trim();
 const scoringUrl=$("direct-scoring-url").value.trim();
 const scoringApiKey=$("direct-scoring-key").value.trim();
 if(config.routes.scoring==="direct"&&scoringProvider==="lemonade"){
  try{const endpoint=new URL(scoringBaseUrl);if(endpoint.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname)||endpoint.username||endpoint.password||!scoringModel)throw Error();}
  catch{status.textContent="Pour le scoring Lemonade, utilisez son adresse locale et sélectionnez un modèle FastFlowLM compatible.";return;}
 }else if(config.routes.scoring==="direct"&&scoringProvider==="custom"&&scoringUrl){try{const endpoint=new URL(scoringUrl),loopback=["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname);if((endpoint.protocol!=="https:"&&!(endpoint.protocol==="http:"&&loopback))||endpoint.username||endpoint.password)throw Error();}catch{status.textContent="Utilisez HTTPS pour le scoring distant, ou HTTP uniquement sur loopback local.";return;}}
 button.disabled=true;status.textContent="Enregistrement des moteurs en accès direct…";
 try{
  await saveCredentialVault(db,{text:textSettings.apiKey,audio:audioSettings.apiKey,scoring:scoringApiKey});state.scoringSettings={apiKey:scoringApiKey};state.settings=textSettings;state.transcriptionSettings=audioSettings;
  const {apiKey:textSecret,...safeText}=textSettings,{apiKey:audioSecret,...safeAudio}=audioSettings;
  await put(db,"settings",safeText);await put(db,"settings",safeAudio);
  config.directScoringProvider=scoringProvider;config.directScoringBaseUrl=scoringBaseUrl||"http://127.0.0.1:13305";config.directScoringModel=scoringModel;config.directScoringUrl=scoringProvider==="custom"?scoringUrl:"";gatewayRoutingConfig=config;await put(db,"settings",{id:"inference-gateway-config",...config});
  state.routing={text:config.routes.llm==="direct"?"local":"gateway",audio:config.routes.audio==="direct"?"local":"gateway"};
  state.gateways={text:(config.gateways||[]).find(g=>g.id===Number(String(config.routes.llm).slice(-1)))?.url||"",audio:(config.gateways||[]).find(g=>g.id===Number(String(config.routes.audio).slice(-1)))?.url||""};
  modelLabel();status.textContent="Configuration d’accès direct enregistrée."; $("settings-dialog").close();
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}
$("settings-form").addEventListener("submit",async e=>{e.preventDefault();await saveInferenceConfiguration();});
$("test-provider").onclick=async()=>{const status=$("provider-status"),baseUrl=$("api-base").value.trim(),model=$("api-model").value.trim(),apiKey=$("api-key").value.trim();if(!baseUrl||!model){status.textContent="Renseignez l’adresse et le modèle du moteur local.";return;}$("test-provider").disabled=true;status.textContent="Test du modèle texte local…";try{const answer=await chatCompletion({baseUrl,model,apiKey,credentials:"omit",messages:[{role:"user",content:"Réponds uniquement : connexion réussie."}]});status.textContent="✓ Modèle texte local opérationnel — "+answer;}catch(error){status.textContent=error.message;}finally{$("test-provider").disabled=false;}};
$("load-scoring-models").onclick=async()=>{const status=$("scoring-model-status"),button=$("load-scoring-models"),select=$("direct-scoring-model");button.disabled=true;status.textContent="Interrogation du catalogue Lemonade…";try{const models=await listLemonadeScoringModels({baseUrl:$("direct-scoring-base").value.trim(),apiKey:$("direct-scoring-key").value.trim()});const previous=select.value||gatewayRoutingConfig?.directScoringModel||"";select.replaceChildren(new Option(models.length?"Sélectionnez un moteur de scoring":"Aucun moteur compatible détecté",""));for(const model of models){const label=model.id+(model.downloaded?" · installé":" · à installer")+(model.size?" · "+model.size+" Go":"");select.add(new Option(label,model.id));}const preferred=models.find(model=>/d3[-:]ultra/i.test(model.id))||models.find(model=>/d3[-:]turbo/i.test(model.id));select.value=models.some(model=>model.id===previous)?previous:preferred?.id||"";status.textContent=models.length?models.length+" moteur(s) FastFlowLM compatible(s) trouvé(s)."+(preferred?" D3 Ultra est proposé par défaut.":""):"Aucun modèle FastFlowLM avec les capacités classification + systemone n’est publié dans le catalogue de ce serveur. Vérifiez la version de Lemonade et FastFlowLM.";}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
$("direct-scoring-model").addEventListener("change",()=>{if(gatewayRoutingConfig)gatewayRoutingConfig.directScoringModel=$("direct-scoring-model").value;});
$("test-scoring").addEventListener("click",async()=>{const button=$("test-scoring"),status=$("scoring-test-status"),text=$("scoring-test-text").value.trim(),config=gatewayRoutingConfig||{},route=config.routes?.scoring||"direct",gatewayId=route.startsWith("gateway-")?Number(route.slice(-1)):0,gatewayUrl=config.gateways?.find(g=>g.id===gatewayId)?.url||"";if(!text){status.textContent="Saisissez un texte à analyser.";return;}button.disabled=true;status.textContent="Test réel du moteur de scoring en cours…";try{const result=await scoreIcareMultilabel({text,route,gatewayUrl,directUrl:$("direct-scoring-url").value.trim(),provider:$("direct-scoring-provider").value,lemonadeBaseUrl:$("direct-scoring-base").value.trim(),model:$("direct-scoring-model").value.trim(),apiKey:$("direct-scoring-key").value.trim(),questionPayload:await activeScoringQuestionPayload()});status.textContent="✓ Scoring opérationnel — "+["I","C","A","R","E"].map(code=>code+" "+Math.round(result.scores[code]*100)+" %").join(" · ");}catch(error){status.textContent="Échec du test : "+error.message;}finally{button.disabled=false;}});
$("load-transcription-models").onclick=async()=>{const status=$("transcription-status"),button=$("load-transcription-models"),isLemonade=$("transcription-preset").value==="lemonade";button.disabled=true;status.textContent=isLemonade?"Recherche des modèles ASR FastFlowLM dans Lemonade…":"Recherche des modèles de transcription…";try{const baseUrl=$("transcription-base").value.trim(),apiKey=$("transcription-key").value.trim(),models=isLemonade?await listLemonadeTranscriptionModels({baseUrl,apiKey}):await listModels({baseUrl,apiKey,credentials:"omit"}),list=$("transcription-models"),previous=$("transcription-model").value;list.replaceChildren();for(const item of models){const model=typeof item==="string"?item:item.id,option=document.createElement("option");option.value=model;if(typeof item==="object")option.label=model+(item.downloaded?" · installé":" · à installer")+(item.size?" · "+item.size+" Go":"");list.append(option);}if(isLemonade){const preferred=models.find(item=>/whisper-v3-turbo-flm/i.test(item.id))||models.find(item=>/whisper.*flm/i.test(item.id));$("transcription-model").value=models.some(item=>item.id===previous)?previous:preferred?.id||"";const installed=models.filter(item=>item.downloaded).length;status.textContent=models.length?models.length+" modèle(s) ASR FastFlowLM trouvé(s), dont "+installed+" installé(s). "+(preferred?"Whisper v3 Turbo FastFlowLM est présélectionné. ":"")+"Les modèles whisper.cpp sont exclus.":"Aucun modèle ASR FastFlowLM trouvé. Vérifiez la version de Lemonade/FastFlowLM et installez whisper-v3-turbo-FLM.";if(models.length)status.textContent+=" Lemonade documente la coexistence d’un ASR et d’un LLM FastFlowLM sur le NPU ; vérifiez le couple ASR + D3 sur votre installation.";}else status.textContent=models.length?models.length+" modèle(s) de transcription trouvé(s). Choisissez un identifiant dans la liste.":"Aucun modèle de transcription trouvé dans le catalogue. Vérifiez qu’un modèle audio est disponible sur le serveur.";}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
$("transcription-preset").addEventListener("change",e=>{$("load-transcription-models").textContent=e.target.value==="lemonade"?"Rechercher les modèles ASR FastFlowLM":"Rechercher les modèles audio";const presets={openai:"https://api.openai.com/v1",ollama:"http://localhost:11434/v1",lemonade:"http://127.0.0.1:13305/v1"};if(presets[e.target.value])$("transcription-base").value=presets[e.target.value];const help={openai:"API Audio Transcriptions compatible OpenAI. Consultez la documentation du fournisseur pour les modèles et formats audio acceptés.",ollama:"Vérifiez que votre version expose un endpoint de transcription audio compatible OpenAI.",lemonade:"Lemonade expose /v1/audio/transcriptions. ICARE ne propose ici que les modèles recipe=flm portant le label « transcription » : choisissez whisper-v3-turbo-FLM (FastFlowLM), et non Whisper.cpp. Les modèles ASR FastFlowLM sont conçus pour cohabiter avec un LLM FastFlowLM sur le NPU ; la coexistence précise avec D3 doit être vérifiée sur votre version. ICARE convertit automatiquement l’enregistrement en WAV.", "":"Le serveur doit exposer un endpoint compatible /v1/audio/transcriptions. Vérifiez les formats audio et les modèles pris en charge dans sa documentation."};$("transcription-help").textContent=help[e.target.value]||help[""];});
$("close-project-dialog").onclick=()=>closeDialogFromBackdrop($("project-dialog"));$("cancel-project").onclick=()=>closeDialogFromBackdrop($("project-dialog"));$("close-export-dialog").onclick=()=>closeDialogFromBackdrop($("export-dialog"));$("cancel-export").onclick=()=>closeDialogFromBackdrop($("export-dialog"));
$("project-menu-toggle").onclick=()=>{const open=document.body.classList.toggle("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded",String(open));};$("project-menu-backdrop").onclick=()=>{document.body.classList.remove("project-menu-open");$("project-menu-toggle").setAttribute("aria-expanded","false");};
$("project-import-button").onclick=()=>$("project-import-file").click();$("project-import-file").onchange=async e=>{try{if(e.target.files[0]){await importData(e.target.files[0]);alert("Projet importé. Sa provenance éventuelle a été conservée.");}}catch(err){alert(err.message);}e.target.value="";};

const defaultWorkspace=()=>({dimensions:{I:"unexplored",C:"unexplored",A:"unexplored",R:"unexplored",E:"unexplored"},proposals:[],relations:[],referenceDocuments:[],dimensionJustifications:{},snapshots:[]});
function normaliseWorkspace(value){const d=defaultWorkspace();if(!value||typeof value!=="object")return d;for(const code of ["I","C","A","R","E"])if(["unexplored","insufficient","sufficient","not_applicable"].includes(value.dimensions?.[code]))d.dimensions[code]=value.dimensions[code];d.proposals=Array.isArray(value.proposals)?value.proposals:[];d.relations=Array.isArray(value.relations)?value.relations:[];d.referenceDocuments=Array.isArray(value.referenceDocuments)?value.referenceDocuments:[];d.dimensionJustifications=value.dimensionJustifications||{};d.componentStorage=value.componentStorage&&typeof value.componentStorage==="object"&&!Array.isArray(value.componentStorage)?value.componentStorage:{};d.snapshots=Array.isArray(value.snapshots)?value.snapshots:[];return d;}
async function scoreHistoricalTurnText(side,text){
 const route=gatewayRoutingConfig?.routes?.scoring||"direct",gatewayId=route.startsWith("gateway-")?Number(route.slice(-1)):0,gatewayUrl=gatewayRoutingConfig?.gateways?.find(g=>g.id===gatewayId)?.url||"";
 const result=await scoreIcareMultilabel({text,route,gatewayUrl,directUrl:gatewayRoutingConfig?.directScoringUrl||"",provider:gatewayRoutingConfig?.directScoringProvider||"custom",lemonadeBaseUrl:gatewayRoutingConfig?.directScoringBaseUrl||"http://127.0.0.1:13305",model:gatewayRoutingConfig?.directScoringModel||"",apiKey:route==="direct"?state.scoringSettings.apiKey:"",questionPayload:await activeScoringQuestionPayload()});
 return Object.fromEntries(SCORE_DIMENSIONS.map(code=>[code,Number.isFinite(Number(result.scores?.[code]))?Math.max(0,Math.min(1,Number(result.scores[code]))):0]));
}
async function backfillHistoricalScores(){
 const updated=await backfillConversationScores(state.turns,scoreHistoricalTurnText,turn=>put(db,"turns",turn),1);
 if(updated.length)console.info("Scoring ICARE historique complété :",updated.length,"tour(s).");
}
async function loadWorkspace(){state.workspace=normaliseWorkspace(await get(db,"settings","workspace:"+state.projectId));if(!state.workspace.referenceDocuments.length){state.workspace.referenceDocuments=[{id:"guide-icare",title:"Guide de la démarche ICARE",content:await (await fetch("./guide-icare.md")).text(),createdAt:now()},{id:"ontology-icare",title:"Ontologie ICARE (JSON)",content:JSON.stringify(ontology,null,2),createdAt:now()}];await saveWorkspace();}if(!state.workspace.referenceDocuments.some(document=>document.id==="icare-reference")){state.workspace.referenceDocuments.push({id:"icare-reference",title:"ICARE — Référentiel complet",content:await (await fetch("./icare-referentiel.md")).text(),createdAt:now()});await saveWorkspace();}if(!state.workspace.snapshots.length)captureSnapshot("Initialisation",false);await backfillHistoricalScores();renderWorkspace();}
async function saveWorkspace(){await put(db,"settings",{id:"workspace:"+state.projectId,...state.workspace});}
const MAX_PROJECT_DOCUMENT_BYTES=25*1024*1024;
const TEXT_DOCUMENT_EXTENSIONS=new Set(["txt","md","markdown","csv","tsv","json","html","htm","xml","yaml","yml","log","rtf"]);
function documentExtension(name){return String(name||"").split(".").pop().toLowerCase();}
function encodeBase64(buffer){const bytes=new Uint8Array(buffer);let binary="";for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length)));return btoa(binary);}
function documentBlob(document){const binary=atob(document.dataBase64||"");const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:document.mimeType||"application/octet-stream"});}
function renderProjectDocuments(){
 const list=$("project-document-list"),status=$("project-document-status");if(!list||!state.workspace)return;
 list.dataset.ready="true";$("project-document-add").disabled=!$("project-document-files").files?.length;
 list.replaceChildren();const documents=(state.workspace.referenceDocuments||[]).filter(document=>document.kind==="attachment");
 status.textContent=documents.length?documents.length+" document(s) joint(s) à ce projet. Les fichiers originaux sont conservés intégralement dans le stockage local du navigateur.":"Aucun document joint. Taille maximale : 25 Mo par fichier.";
 for(const entry of documents){
  const item=document.createElement("li");item.className="project-document-item";item.dataset.documentId=entry.id;
  const details=document.createElement("div");details.className="project-document-info";
  const title=document.createElement("strong");title.textContent=entry.fileName||entry.title;const meta=document.createElement("small");
  const size=entry.size<1048576?Math.max(1,Math.round(entry.size/1024))+" Ko":(entry.size/1048576).toFixed(1)+" Mo";
  meta.textContent=size+" · "+(entry.content?(entry.contentSource==="ocr"||entry.contentSource==="native+ocr"?"texte extrait · OCR "+(entry.contentOcrPages||0)+" page(s)": "texte intégral indexable"):"fichier original conservé");details.append(title,meta);
  const actions=document.createElement("div");actions.className="project-document-actions";
  if(entry.mimeType==="application/pdf"||documentExtension(entry.fileName)==="pdf"){
   const extract=document.createElement("button");extract.type="button";extract.className="button secondary";extract.textContent=entry.content?"Réextraire / OCR":"Extraire le texte / OCR";
   extract.addEventListener("click",async()=>{extract.disabled=true;status.textContent="Lecture du PDF « "+(entry.fileName||entry.title)+" »…";try{const result=await extractPdfText(await documentBlob(entry).arrayBuffer(),{onProgress:progress=>{status.textContent="PDF "+progress.page+"/"+progress.total+" · "+(progress.stage==="ocr"?"OCR en cours":"Extraction du texte")+"…";}});entry.content=result.content;entry.contentSource=result.source;entry.contentPages=result.pageCount;entry.contentOcrPages=result.ocrPages;entry.extractedAt=now();await saveWorkspace();renderProjectDocuments();status.textContent="Texte extrait de « "+(entry.fileName||entry.title)+" » : "+result.pageCount+" page(s), dont "+result.ocrPages+" par OCR."; }catch(error){status.textContent="Extraction PDF impossible : "+error.message;}finally{extract.disabled=false;}});
   actions.append(extract);
  }
  if(entry.content){const read=document.createElement("button");read.type="button";read.className="button secondary";read.textContent="Lire";read.addEventListener("click",()=>showProjectDocument(entry));actions.append(read);}
  else if(entry.mimeType==="application/pdf"){const open=document.createElement("button");open.type="button";open.className="button secondary";open.textContent="Ouvrir";open.addEventListener("click",()=>{const url=URL.createObjectURL(documentBlob(entry));const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});actions.append(open);}
  const dl=document.createElement("button");dl.type="button";dl.className="button secondary";dl.textContent="Télécharger";dl.addEventListener("click",()=>{const url=URL.createObjectURL(documentBlob(entry));const link=document.createElement("a");link.href=url;link.download=entry.fileName||entry.title;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const remove=document.createElement("button");remove.type="button";remove.className="button secondary project-document-remove";remove.textContent="Retirer";remove.setAttribute("aria-label","Retirer "+(entry.fileName||entry.title));remove.addEventListener("click",async()=>{state.workspace.referenceDocuments=state.workspace.referenceDocuments.filter(candidate=>candidate.id!==entry.id);await saveWorkspace();renderProjectDocuments();});
  actions.append(dl,remove);item.append(details,actions);list.append(item);
 }
}
function showProjectDocument(document){$("project-document-title").textContent=document.fileName||document.title;$("project-document-content").textContent=document.content||"";$("project-document-dialog").showModal();}
async function addProjectDocuments(files){
 if(!state.workspace)throw new Error("Aucun projet actif.");const selected=[...files];if(!selected.length)return;
 for(const file of selected)if(file.size>MAX_PROJECT_DOCUMENT_BYTES)throw new Error("Le fichier « "+file.name+" » dépasse la limite de 25 Mo.");
 const additions=[];
 for(const file of selected){const extension=documentExtension(file.name),buffer=await file.arrayBuffer(),isPdf=extension==="pdf"||file.type==="application/pdf",content=TEXT_DOCUMENT_EXTENSIONS.has(extension)?new TextDecoder("utf-8",{fatal:false}).decode(buffer):"";additions.push({id:uid(),kind:"attachment",title:file.name,fileName:file.name,mimeType:file.type||(isPdf?"application/pdf":"application/octet-stream"),size:file.size,dataBase64:encodeBase64(buffer),content,createdAt:now()});}
 state.workspace.referenceDocuments.push(...additions);await saveWorkspace();renderProjectDocuments();
 const pdfs=additions.filter(entry=>entry.mimeType==="application/pdf"||documentExtension(entry.fileName)==="pdf");
 if(!pdfs.length){$("project-document-status").textContent=additions.length+" document(s) ajouté(s) au projet.";return;}
 for(const entry of pdfs){$("project-document-status").textContent="Extraction du PDF « "+entry.fileName+" »…";try{const result=await extractPdfText(await documentBlob(entry).arrayBuffer(),{onProgress:progress=>{$("project-document-status").textContent="PDF "+progress.page+"/"+progress.total+" · "+(progress.stage==="ocr"?"OCR en cours":"Extraction du texte")+" : "+entry.fileName;}});entry.content=result.content;entry.contentSource=result.source;entry.contentPages=result.pageCount;entry.contentOcrPages=result.ocrPages;entry.extractedAt=now();await saveWorkspace();renderProjectDocuments();$("project-document-status").textContent="PDF lu : "+entry.fileName+" · "+result.pageCount+" page(s), OCR "+result.ocrPages+" page(s).";}catch(error){$("project-document-status").textContent="PDF ajouté, mais extraction impossible pour « "+entry.fileName+" » : "+error.message+" Vous pouvez réessayer avec le bouton d’extraction.";} }
}
function renderScoringRadar(turnCount=state.turns.length){
 const source=visibleConversationTurns(),turns=source.slice(0,Math.max(0,Math.min(source.length,Number(turnCount)||0)));
 const scores=calculateScoreRadar(turns),order=SCORE_DIMENSIONS,names={I:"Intention",C:"Contexte",A:"Action",R:"Régulation",E:"Évolution"};
 const visibility=loadRadarVisibility(),ns="http://www.w3.org/2000/svg";
 const draw=(svgId,kind)=>{
  const svg=$(svgId);if(!svg)return;
  const grid=svg.querySelector(".radar-grid"),labels=svg.querySelector(".radar-labels");
  // Un rendu remplace les séries précédentes : ne jamais empiler les polygones ni dupliquer leurs IDs.
  svg.querySelectorAll("[data-radar-series],[data-overlap-hatch],#radar-accumulation-overlap-defs").forEach(element=>element.remove());
  grid.replaceChildren();labels.replaceChildren();
  const cx=160,cy=128,r=91,angles=order.map((_,i)=>-Math.PI/2+i*2*Math.PI/5);
  const make=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(text)el.textContent=text;return el;};
  for(const ring of [.25,.5,.75,1]){
   const points=order.map((_,i)=>(cx+Math.cos(angles[i])*r*ring)+","+(cy+Math.sin(angles[i])*r*ring)).join(" ");
   grid.append(make("polygon",{points,fill:"none",stroke:"#718096","stroke-opacity":".62","stroke-width":1.15}));
  }
  for(let i=0;i<order.length;i++){
   const angle=angles[i];grid.append(make("line",{x1:cx,y1:cy,x2:cx+Math.cos(angle)*r,y2:cy+Math.sin(angle)*r,stroke:"#718096","stroke-opacity":".68","stroke-width":1.15}));
   labels.append(make("text",{x:cx+Math.cos(angle)*(r+23),y:cy+Math.sin(angle)*(r+23)+4,"text-anchor":"middle","font-size":12,"font-weight":750,fill:"currentColor"},names[order[i]]));
  }
  const series=kind==="latest"?[
   ["radar-user-latest",scores.userLatest,"#4caec0",false],
   ["radar-assistant-latest",scores.assistantLatest,"#e58a6b",false]
  ]:[
   ["radar-user-average",scores.userAverage,"#258da5",true],
   ["radar-assistant-average",scores.assistantAverage,"#d66b4d",true]
  ];
  const seriesPoints={};
  for(const [id,values,color,filled] of series){
   const points=order.map((code,i)=>{const value=Math.max(0,Math.min(1,Number(values?.[code])||0));return (cx+Math.cos(angles[i])*r*value)+","+(cy+Math.sin(angles[i])*r*value);}).join(" ");
   seriesPoints[id]=points;
   const polygon=make("polygon",{points,fill:filled?color:"none","fill-opacity":filled?".58":"0",stroke:color,"stroke-width":filled?2.8:3,"stroke-linejoin":"round","stroke-linecap":"round"});
   polygon.id=svgId+"-"+id;polygon.dataset.radarSeries=id;polygon.style.display=visibility[id]?"":"none";svg.append(polygon);
  }
  // Hachures limitées à l’intersection géométrique des deux moyennes cumulées.
  if(kind==="average"){
   const defs=make("defs",{id:"radar-accumulation-overlap-defs"});
   const pattern=make("pattern",{id:"radar-accumulation-overlap-hatch",patternUnits:"userSpaceOnUse",width:8,height:8,patternTransform:"rotate(0)"});
   pattern.append(make("path",{d:"M-2 2L2 -2M0 8L8 0M6 10L10 6",fill:"none",stroke:"#26384f","stroke-width":1.5}));
   defs.append(pattern);
   const clip=make("clipPath",{id:"radar-accumulation-overlap-clip",clipPathUnits:"userSpaceOnUse"});
   clip.append(make("polygon",{points:seriesPoints["radar-assistant-average"]||""}));
   defs.append(clip);svg.append(defs);
   const hatch=make("polygon",{points:seriesPoints["radar-user-average"]||"",fill:"url(#radar-accumulation-overlap-hatch)","clip-path":"url(#radar-accumulation-overlap-clip)","pointer-events":"none"});
   hatch.dataset.overlapHatch="true";
   hatch.style.display=visibility["radar-user-average"]&&visibility["radar-assistant-average"]?"":"none";
   svg.append(hatch);
  }
 };
 draw("radar-latest","latest");draw("radar-accumulation","average");
 const latestCount=$("radar-latest-count"),averageCount=$("radar-accumulation-count");
 if(latestCount)latestCount.textContent=turns.length?"Dernier échange affiché":"Aucun échange à cette étape";
 if(averageCount)averageCount.textContent=scores.observations+" échange(s) pris en compte";
 for(const [id,visible] of Object.entries(visibility)){const control=document.querySelector('.radar-legend button[data-radar-series="'+id+'"]');if(control){control.setAttribute("aria-pressed",String(visible));control.classList.toggle("is-hidden",!visible);}}
}
const RADAR_VISIBILITY_KEY="icare-radar-series-visibility-v1";
const RADAR_SERIES_IDS=["radar-user-latest","radar-user-average","radar-assistant-latest","radar-assistant-average"];
function loadRadarVisibility(){let saved={};try{saved=JSON.parse(localStorage.getItem(RADAR_VISIBILITY_KEY)||"{}")||{};}catch{}return Object.fromEntries(RADAR_SERIES_IDS.map(id=>[id,saved[id]!==false]));}
document.querySelector(".radar-legend")?.addEventListener("click",event=>{const control=event.target.closest("[data-radar-series]");if(!control)return;const id=control.dataset.radarSeries;if(!RADAR_SERIES_IDS.includes(id))return;const visibility=loadRadarVisibility();visibility[id]=!visibility[id];try{localStorage.setItem(RADAR_VISIBILITY_KEY,JSON.stringify(visibility));}catch{}renderScoringRadar();});
$("conversation-branch-tree")?.addEventListener("keydown",event=>{
 if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
 if(event.target.closest("a"))return;
 const branches=state.experimentState?.branches||[],active=state.activeBranchId||"main",current=branches.find(item=>item.id===active);
 const visible=visibleConversationTurns(),max=visible.length,mainTurns=state.turns.filter(turn=>!turn.experiment?.branchId),mainCount=active==="main"?(replaySnapshotIndex===null?(replayMainTurnCount??mainTurns.length):Math.min(mainTurns.length,Number(state.workspace?.snapshots?.[replaySnapshotIndex]?.turns)||0)):max,currentCount=active==="main"?mainCount:(replayBranchTurnCount===null?max:Math.max(0,Math.min(max,replayBranchTurnCount)));
 const siblings=branches.filter(item=>(item.parentBranchId||"main")===(current?.parentBranchId||"main"));
 let target=null,turnCount=null;
 if(event.key==="ArrowRight"||event.key==="ArrowLeft"){
  event.preventDefault();const next=Math.max(0,Math.min(max,currentCount+(event.key==="ArrowRight"?1:-1)));
  if(active==="main"){const snapshots=state.workspace?.snapshots||[];let snapshotIndex=-1;snapshots.forEach((snapshot,index)=>{if(Number(snapshot.turns||0)<=next)snapshotIndex=index;});if(snapshotIndex>=0&&Number(snapshots[snapshotIndex].turns||0)===next)showProjectHistory(snapshotIndex);else{replaySnapshotIndex=null;replayMainTurnCount=next;renderConversation(next);renderScoringRadar(next);renderProjectTimeline();renderBranchExplorer();}}
  else showBranchHistory(next);
  tree.focus({preventScroll:true});return;
 }
 if(event.key==="ArrowDown"){event.preventDefault();target=branches.find(item=>(item.parentBranchId||"main")===active);if(target)turnCount=Number(target.sourceIndex??target.contextTurnIds?.length??target.contextTurns?.length??0)+1;}
 if(event.key==="ArrowUp"){event.preventDefault();if(current){target=current.parentBranchId||"main";turnCount=Number(current.sourceIndex??current.contextTurnIds?.length??0)+1;} }
 if(event.key==="ArrowDown"&&event.shiftKey||event.key==="ArrowUp"&&event.shiftKey){event.preventDefault();const list=active==="main"?branches.filter(item=>(item.parentBranchId||"main")==="main"):siblings;const index=list.findIndex(item=>item.id===active),step=event.key==="ArrowDown"?1:-1;target=list[index+step]?.id||null;turnCount=target==="main"?null:(Number(branches.find(item=>item.id===target)?.sourceIndex??0)+1);}
 if(event.key==="Home"){event.preventDefault();if(active==="main"){replaySnapshotIndex=0;showProjectHistory(0);}else showBranchHistory(0);tree.focus({preventScroll:true});return;}
 if(event.key==="End"){event.preventDefault();if(active==="main"){replaySnapshotIndex=null;replayMainTurnCount=null;renderConversation();renderScoringRadar();renderProjectTimeline();renderBranchExplorer();}else showBranchHistory(max);tree.focus({preventScroll:true});return;}
 if(target!==null&&target!==undefined)activateBranchExplorerNode(target,{turnCount});
});

function renderProjectTimeline(){
 const start=$("project-history-start"),position=$("project-history-position"),summary=$("project-history-summary");
 if(!state.workspace)return;
 if(state.activeBranchId&&state.activeBranchId!=="main"){
  const branch=state.experimentState?.branches?.find(item=>item.id===state.activeBranchId),turns=visibleConversationTurns(),max=turns.length;
  const selected=replayBranchTurnCount===null?max:Math.max(0,Math.min(max,replayBranchTurnCount));
  if(start)start.textContent=branch?.name||"Début de la branche";
  if(position)position.textContent=selected===max?"Branche complète":selected+" / "+max;
  if(summary){const turn=selected?turns[selected-1]:null,date=turn?.createdAt?new Date(turn.createdAt).toLocaleString("fr-FR"):"";summary.textContent=[branch?.name||"Branche expérimentale",selected===0?"Contexte initial":selected+" échange(s) affiché(s)",date,selected===max?"historique complet":"replay de branche"].filter(Boolean).join(" · ");}
  return;
 }
 const snapshots=state.workspace.snapshots||[];
 if(!snapshots.length){if(start)start.textContent="Début du projet";if(position)position.textContent="État actuel";if(summary)summary.textContent="L’historique apparaîtra au fil des échanges.";return;}
 const selected=replaySnapshotIndex===null?snapshots.length-1:Math.max(0,Math.min(snapshots.length-1,replaySnapshotIndex));
 const first=snapshots[0],snap=snapshots[selected];
 if(start)start.textContent=new Date(first.at).toLocaleDateString("fr-FR");
 if(position)position.textContent=selected===snapshots.length-1?"État actuel":(selected+1)+" / "+snapshots.length;
 if(summary){const date=snap.at?new Date(snap.at).toLocaleString("fr-FR"):"";summary.textContent=[date,snap.reason||"Étape du projet",snap.turns+" échange(s)"].filter(Boolean).join(" · ")+(selected===snapshots.length-1?" · état courant":" · consultation historique");}
}
function showBranchHistory(index){
 const branch=state.experimentState?.branches?.find(item=>item.id===state.activeBranchId);
 const turns=visibleConversationTurns(),selected=Math.max(0,Math.min(turns.length,Number(index)||0));
 const forkContext=Number(branch?.sourceIndex??branch?.contextTurnIds?.length??0);
 if(shouldReturnToParentBranch(branch,selected)){
  state.replayPreferredBranchId=branch.id;state.activeBranchId="main";replayBranchTurnCount=null;replayMainTurnCount=forkContext;
  const snapshots=state.workspace?.snapshots||[];let snapshotIndex=-1;
  snapshots.forEach((snapshot,i)=>{if(Number(snapshot.turns||0)<=forkContext)snapshotIndex=i;});
  if(snapshotIndex>=0)showProjectHistory(snapshotIndex);
  else{replaySnapshotIndex=null;renderConversation(forkContext);renderScoringRadar(forkContext);renderProjectTimeline();renderBranchExplorer();}
  return;
 }
 replayBranchTurnCount=selected;
 renderConversation(replayBranchTurnCount);renderScoringRadar(replayBranchTurnCount);renderProjectTimeline();renderBranchExplorer();
}
function showProjectHistory(index){
 const snapshots=state.workspace?.snapshots||[];if(!snapshots.length)return;
 replaySnapshotIndex=Math.max(0,Math.min(snapshots.length-1,Number(index)||0));
 replayBranchTurnCount=null;
 const snapshot=snapshots[replaySnapshotIndex];
 const canonicalTurns=state.turns.filter(turn=>!turn.experiment?.branchId);
 const visibleCount=Math.min(canonicalTurns.length,Number(snapshot.turns)||0);replayMainTurnCount=visibleCount;
 renderConversation(visibleCount);
 renderScoringRadar(visibleCount);
 renderProjectTimeline();renderBranchExplorer();
}
function captureSnapshot(reason="Échange",persist=true){if(!state.workspace)return;const snapshot={at:now(),reason,turns:state.turns?.length||0,dimensions:{...state.workspace.dimensions},proposals:state.workspace.proposals.length},last=state.workspace.snapshots.at(-1);if(!last||last.turns!==snapshot.turns||JSON.stringify(last.dimensions)!==JSON.stringify(snapshot.dimensions)||last.proposals!==snapshot.proposals){state.workspace.snapshots.push(snapshot);if(persist)saveWorkspace();renderProjectTimeline();}}
function renderWorkspace(){if(state.activeBranchId&&state.activeBranchId!=="main"){if(replayBranchTurnCount===null){renderConversation();renderScoringRadar();}else showBranchHistory(replayBranchTurnCount);}else if(replaySnapshotIndex===null){renderConversation(state.turns.length);renderScoringRadar(state.turns.length);}else showProjectHistory(replaySnapshotIndex);renderProjectTimeline();renderProjectDocuments();}
$("api-preset")?.addEventListener("change",event=>{const preset=event.target.value,presets={openai:"https://api.openai.com/v1",ollama:"http://localhost:11434/v1",lemonade:"http://127.0.0.1:13305/v1"};if(presets[preset])$("api-base").value=presets[preset];const help={openai:"OpenAI : endpoint public HTTPS. Saisissez une clé API et chargez les modèles disponibles.",ollama:"Ollama local : http://localhost:11434/v1. Pour un site HTTPS distant, Ollama doit autoriser l’origine GitHub Pages via OLLAMA_ORIGINS. localhost désigne votre propre ordinateur.",lemonade:"Lemonade local : http://127.0.0.1:13305/v1. Pour un site HTTPS distant, le serveur doit autoriser l’origine GitHub Pages (CORS).", "":"API compatible OpenAI Chat Completions. Saisissez l’URL de base terminée par /v1."};$("provider-help").textContent=help[preset]||help[""];});

renderScoringRadar();
async function loadIcareDocumentation(){try{const response=await fetch("./icare-referentiel.md");if(!response.ok)throw new Error("Référentiel indisponible ("+response.status+").");$("icare-doc-content").replaceChildren(renderMarkdown(await response.text()));}catch(error){$("icare-doc-content").textContent="Impossible de charger le référentiel : "+error.message;}}
$("icare-doc-open").addEventListener("click",()=>$("icare-doc-dialog").showModal());
$("close-icare-doc").addEventListener("click",()=>$("icare-doc-dialog").close());
icareLaboratory=await createLaboratory({db,get,put,renderMarkdown,onStateChange:renderActiveConfigurationStatus});renderActiveConfigurationStatus();$("laboratory-quick-open").addEventListener("click",()=>window.openIcareLaboratory?.({docId:"system-prompt"}));$("close-project-document").addEventListener("click",()=>$("project-document-dialog").close());
$("project-document-files").addEventListener("change",event=>{$("project-document-add").disabled=!event.target.files?.length||!state.workspace;$("project-document-status").textContent=event.target.files?.length?event.target.files.length+" fichier(s) sélectionné(s).":"Sélectionnez un ou plusieurs documents.";});
$("project-document-add").addEventListener("click",async()=>{const input=$("project-document-files"),button=$("project-document-add");button.disabled=true;button.textContent="Ajout…";try{await addProjectDocuments(input.files);input.value="";}catch(error){$("project-document-status").textContent=error.message;}finally{button.textContent="Joindre au projet";button.disabled=!input.files?.length;}});
await loadOntology();await loadIcareDocumentation();gatewayRoutingConfig=await initGatewayConfiguration({db,get,set:put,loadScoringKey:async()=>(await loadCredentialVault(db)).scoring,saveLegacy:async({config,scoringApiKey})=>{
 const modelCache=new Map();
 async function gatewayConfig(url){
  if(!modelCache.has(url)){const base=url.replace(/\/+$/,""),endpoint=(base.endsWith("/v1")?base:base+"/v1")+"/icare/config";const response=await fetch(endpoint,{credentials:"include",cache:"no-store"});if(!response.ok)throw Error("Impossible de lire la configuration de la Gateway ("+response.status+").");modelCache.set(url,await response.json());}
  return modelCache.get(url);
 }
 const modelFor=async(service,capability)=>{const route=config.routes[service];if(route==="direct")return "";const gateway=config.gateways.find(g=>g.id===Number(route.slice(-1)));const remote=await gatewayConfig(gateway.url);const model=capability==="chat"?remote.defaults?.chatModel:remote.defaults?.transcriptionModel;if(!model)throw Error("Aucun modèle "+(capability==="chat"?"de conversation":"de transcription")+" n’est attribué à "+gateway.name+".");return model;};
 const [textModel,audioModel]=await Promise.all([modelFor("llm","chat"),modelFor("audio","transcription")]);
 if(config.routes.scoring!=="direct"){
  const scoringGateway=config.gateways.find(g=>g.id===Number(config.routes.scoring.slice(-1)));
  const remote=await gatewayConfig(scoringGateway.url);
  if(remote.capabilities?.scoring!==true)throw Error("Cette Gateway n’expose pas le scoring ICARE. Configurez scoring.endpointUrl côté serveur.");
 }
 const scoringKey=String(scoringApiKey||"").trim();
 await saveCredentialVault(db,{text:state.settings.apiKey||"",audio:state.transcriptionSettings.apiKey||"",scoring:scoringKey});
 state.scoringSettings={apiKey:scoringKey};
 const urlFor=service=>{const route=config.routes[service];return route==="direct"?"":config.gateways.find(g=>g.id===Number(route.slice(-1)))?.url||"";};
 state.routing={text:config.routes.llm==="direct"?"local":"gateway",audio:config.routes.audio==="direct"?"local":"gateway"};
 state.gateways={text:urlFor("llm"),audio:urlFor("audio")};state.gatewayModels={text:textModel,audio:audioModel};state.sameGateway=!!state.gateways.text&&state.gateways.text===state.gateways.audio;
 await put(db,"settings",{id:"inference-routing",...state.routing});await put(db,"settings",{id:"inference-gateways",...state.gateways,sameGateway:state.sameGateway});await put(db,"settings",{id:"inference-gateway-models",...state.gatewayModels});modelLabel();
}});await loadProjects();await loadSettings();await loadWorkspace();registerAppServiceWorker({canReload:()=>!state.busy&&!$("message-input").value.trim()}).catch(error=>console.warn("Service worker ICARE indisponible :",error));
