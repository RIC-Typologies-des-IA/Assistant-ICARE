const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const id=()=>globalThis.crypto?.randomUUID?.()||"exp-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
const stamp=()=>new Date().toISOString();
export const WORKFLOW_NODE_TYPES=Object.freeze(["scoring","llm","tool","transform"]);
export function createExperimentState(value={}){
 const branches=Array.isArray(value.branches)?clone(value.branches):[];
 const configurations=Array.isArray(value.configurations)?clone(value.configurations):[];
 const workflows=Array.isArray(value.workflows)?clone(value.workflows):[];
 return {schemaVersion:1,activeBranchId:value.activeBranchId||null,activeConfigurationId:value.activeConfigurationId||null,branches,configurations,workflows};
}
export function createConfiguration(state,{name="Expérience",parentConfigurationId=null,profileId=null,documents={},settings={},workflowId=null}={}){
 const next=createExperimentState(state),parent=next.configurations.find(x=>x.id===parentConfigurationId)||null;
 const config={id:id(),name:String(name).trim()||"Expérience",parentConfigurationId:parent?.id||null,profileId,documents:clone(documents),settings:clone(settings),workflowId,createdAt:stamp(),revision:1};
 next.configurations.push(config);next.activeConfigurationId=config.id;return {state:next,configuration:clone(config)};
}
export function snapshotConfiguration(configuration){
 if(!configuration?.id)throw Error("Configuration expérimentale manquante.");
 const snapshot={id:id(),configurationId:configuration.id,name:configuration.name,revision:configuration.revision||1,documents:clone(configuration.documents||{}),settings:clone(configuration.settings||{}),workflowId:configuration.workflowId||null,workflow:clone(configuration.workflow||null),capturedAt:stamp()};
 return Object.freeze(snapshot);
}
export function createConversationBranch(state,{projectId,conversationId=null,parentBranchId=null,sourceTurnId=null,sourceTurnIndex=null,configurationSnapshot,kind="experiment",name="Nouvelle expérience"}={}){
 if(!projectId)throw Error("Projet de conversation manquant.");
 if(!configurationSnapshot?.id)throw Error("Un instantané de configuration est requis.");
 const next=createExperimentState(state);
 const parent=next.branches.find(x=>x.id===parentBranchId)||null;
 const branch={id:id(),projectId,conversationId,parentBranchId:parent?.id||null,sourceTurnId:sourceTurnId||null,sourceTurnIndex:Number.isInteger(sourceTurnIndex)?sourceTurnIndex:null,configurationSnapshot:clone(configurationSnapshot),kind,name:String(name).trim()||"Nouvelle expérience",createdAt:stamp(),turnIds:[]};
 next.branches.push(branch);next.activeBranchId=branch.id;next.activeConfigurationId=configurationSnapshot.configurationId;return {state:next,branch:clone(branch)};
}
export function branchHistory(turns,branch,branches=[]){
 if(!branch)throw Error("Branche introuvable.");
 const byId=new Map(turns.map(turn=>[turn.id,turn])),branchById=new Map(branches.map(item=>[item.id,item]));branchById.set(branch.id,branch);
 const resolve=(current,seen=new Set())=>{
  if(!current?.id||seen.has(current.id))throw Error("La lignée des branches contient un cycle ou une référence invalide.");
  const nextSeen=new Set(seen);nextSeen.add(current.id);let history=[];
  if(current.parentBranchId){
   const parent=branchById.get(current.parentBranchId);if(!parent)throw Error("La branche parente est introuvable : "+current.parentBranchId);
   history=resolve(parent,nextSeen);
   if(current.sourceTurnId){const index=history.findIndex(turn=>turn.id===current.sourceTurnId);if(index<0)throw Error("Le message source n’appartient pas à la branche parente.");history=history.slice(0,index+1);}
   else if(Number.isInteger(current.sourceTurnIndex))history=history.slice(0,Math.max(0,current.sourceTurnIndex+1));
  }else if(current.sourceTurnId){
   const source=byId.get(current.sourceTurnId);if(!source)throw Error("Le message historique de départ est introuvable.");
   if(source.branchId){const sourceBranch=branchById.get(source.branchId);if(!sourceBranch)throw Error("La branche du message source est introuvable.");history=resolve(sourceBranch,nextSeen);const index=history.findIndex(turn=>turn.id===source.id);if(index<0)throw Error("Le message source n’appartient pas à sa lignée.");history=history.slice(0,index+1);}
   else{const originals=turns.filter(turn=>!turn.branchId),index=originals.findIndex(turn=>turn.id===source.id);if(index<0)throw Error("Le message source original est introuvable.");history=originals.slice(0,index+1);}
  }else if(Number.isInteger(current.sourceTurnIndex))history=turns.filter(turn=>!turn.branchId).slice(0,Math.max(0,current.sourceTurnIndex+1));
  for(const turnId of current.turnIds||[]){const turn=byId.get(turnId);if(turn&&!history.some(item=>item.id===turnId))history.push(turn);}
  return history;
 };
 return resolve(branch);
}
export function appendBranchTurn(branch,turn){
 if(!branch?.id||!turn?.id)throw Error("Branche et tour requis.");
 const next=clone(branch);next.turnIds=[...(next.turnIds||[]),turn.id];next.lastTurnId=turn.id;next.updatedAt=stamp();return next;
}
export function validateWorkflow(workflow){
 const errors=[];
 if(!workflow||!Array.isArray(workflow.nodes)||!Array.isArray(workflow.edges))return ["Le workflow doit contenir des nœuds et des liaisons."];
 const ids=new Set();
 for(const node of workflow.nodes){if(!node?.id||ids.has(node.id))errors.push("Identifiant de nœud absent ou dupliqué.");ids.add(node?.id);if(!WORKFLOW_NODE_TYPES.includes(node?.type))errors.push("Type de nœud non autorisé : "+node?.type);if(node?.type==="transform"&&node?.operation&&!["pick","template","merge"].includes(node.operation))errors.push("Opération de transformation non autorisée.");}
 const adjacency=new Map([...ids].map(key=>[key,[]])),indegree=new Map([...ids].map(key=>[key,0]));
 for(const edge of workflow.edges){if(!ids.has(edge.from)||!ids.has(edge.to)){errors.push("Une liaison référence un nœud inexistant.");continue;}adjacency.get(edge.from).push(edge.to);indegree.set(edge.to,indegree.get(edge.to)+1);}
 const queue=[...indegree].filter(([,n])=>n===0).map(([key])=>key);let visited=0;
 while(queue.length){const current=queue.shift();visited++;for(const target of adjacency.get(current)){indegree.set(target,indegree.get(target)-1);if(indegree.get(target)===0)queue.push(target);}}
 if(visited!==ids.size)errors.push("Le workflow contient un cycle.");
 return errors;
}
const readPath=(object,path)=>String(path||"").split(".").filter(Boolean).reduce((value,key)=>value==null?undefined:value[key],object);
function interpolate(template,context){return String(template??"").replace(/\$\{([\w.]+)\}/g,(_,path)=>{const value=readPath(context,path);return value==null?"":typeof value==="string"?value:JSON.stringify(value);});}
export async function executeWorkflow(workflow,{input={},adapters={},signal,onNodeStart=()=>{},onNodeComplete=()=>{}}={}){
 const errors=validateWorkflow(workflow);if(errors.length)throw Error(errors.join(" "));
 const nodes=new Map(workflow.nodes.map(node=>[node.id,node])),incoming=new Map(workflow.nodes.map(node=>[node.id,[]]));
 for(const edge of workflow.edges)incoming.get(edge.to).push(edge.from);
 const pending=new Set(nodes.keys()),outputs={},context={input:clone(input),nodes:outputs};
 while(pending.size){
  if(signal?.aborted)throw new DOMException("Exécution interrompue","AbortError");
  const ready=[...pending].filter(key=>incoming.get(key).every(parent=>Object.hasOwn(outputs,parent)));
  if(!ready.length)throw Error("Le workflow ne peut pas progresser.");
  for(const key of ready){
   const node=nodes.get(key),parents=Object.fromEntries(incoming.get(key).map(parent=>[parent,outputs[parent]]));
   const nodeContext={...context,parents,config:clone(node.config||{})};onNodeStart(node);
   let result;
   if(node.type==="scoring"||node.type==="llm"||node.type==="tool"){
    const adapter=adapters[node.type];if(typeof adapter!=="function")throw Error("Aucun adaptateur disponible pour l’étape "+node.type+".");
    result=await adapter({node:clone(node),input:clone(input),parents:clone(parents),context:clone(nodeContext),signal});
   }else{
    const operation=node.operation||"merge",source=node.source?readPath(nodeContext,node.source):parents;
    if(operation==="pick")result=clone(readPath(nodeContext,node.path)||null);
    else if(operation==="template")result=interpolate(node.template,nodeContext);
    else result={...clone(source||{}),...clone(node.value||{})};
   }
   outputs[key]=clone(result);pending.delete(key);onNodeComplete(node,clone(result));
  }
 }
 return {outputs,result:clone(outputs[workflow.output]??outputs[workflow.nodes.at(-1)?.id]??null),workflowId:workflow.id||null,completedAt:stamp()};
}
export function createWorkflow({name="Workflow expérimental",nodes=[],edges=[],output=null}={}){
 const workflow={id:id(),name,nodes:clone(nodes),edges:clone(edges),output,createdAt:stamp(),revision:1};
 const errors=validateWorkflow(workflow);if(errors.length)throw Error(errors.join(" "));
 return workflow;
}
