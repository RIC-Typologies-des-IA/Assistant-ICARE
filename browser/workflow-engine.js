const clone=value=>JSON.parse(JSON.stringify(value??null));
const ALLOWED_TYPES=new Set(["score","model","tool","transform","condition","output"]);
const pathValue=(root,path)=>String(path||"").split(".").filter(Boolean).reduce((value,key)=>value==null?undefined:value[key],root);
const WORKFLOW_TYPES={
 score:{output:"ScoreReport",input:["Message","LLMResponse","Text"]},
 model:{output:"LLMResponse",input:["Message","Text","ScoreReport","Context","Document","DocumentSet","JSON","ToolResult"]},
 tool:{output:"ToolResult",input:["Query","Message","Text","Document","DocumentSet","Context","JSON","LLMResponse"]},
 transform:{output:"Text",input:["JSON","Text","ScoreReport","LLMResponse"]},
 condition:{output:"Boolean",input:["Boolean","Score","ScoreReport","Number","Text"]},
 output:{output:"FinalOutput",input:["LLMResponse","Text","ScoreReport","Document","JSON"]}
};
export const workflowOutputType=step=>WORKFLOW_TYPES[step?.type]?.output||"Any";
export function validateWorkflow(workflow){
 if(!workflow||workflow.schemaVersion!==1||!Array.isArray(workflow.steps))throw Error("Workflow invalide : schemaVersion 1 et steps sont requis.");
 const ids=new Set();
 for(const step of workflow.steps){if(!step||typeof step.id!=="string"||!step.id||ids.has(step.id))throw Error("Chaque étape doit avoir un identifiant unique.");ids.add(step.id);if(!ALLOWED_TYPES.has(step.type))throw Error("Type d’étape non autorisé : "+step.type);if(step.next&&!Array.isArray(step.next)&&typeof step.next!=="string")throw Error("La transition next doit être une chaîne ou une liste.");}
 for(const step of workflow.steps){
  const targets=[...(Array.isArray(step.next)?step.next:step.next?[step.next]:[]),...(step.onTrue?[step.onTrue]:[]),...(step.onFalse?[step.onFalse]:[]),...(step.onError?[step.onError]:[])];
  for(const target of targets)if(!ids.has(target))throw Error("Transition vers une étape inconnue : "+target);
  const inputRef=String(step.input||"").split(".")[0],source=workflow.steps.find(candidate=>candidate.id===inputRef);
  if(source){const produced=workflowOutputType(source),accepted=WORKFLOW_TYPES[step.type]?.input||["Any"];if(!accepted.includes(produced)&&!accepted.includes("Any"))throw Error("Connexion incompatible : "+source.id+" produit "+produced+", mais "+step.id+" attend "+accepted.join(" ou ")+".");}
  if(step.include!==undefined){if(!Array.isArray(step.include)||step.include.some(id=>!ids.has(id)))throw Error("La liste include de "+step.id+" contient une étape inconnue.");for(const includedId of step.include){const included=workflow.steps.find(candidate=>candidate.id===includedId),produced=workflowOutputType(included),accepted=WORKFLOW_TYPES[step.type]?.input||["Any"];if(!accepted.includes(produced)&&!accepted.includes("Any"))throw Error("Donnée include incompatible : "+includedId+" produit "+produced+", mais "+step.id+" ne l’accepte pas.");}}
 }
 return true;
}
export function evaluateCondition(condition,context){if(!condition)return true;const left=pathValue(context,condition.path);const right=condition.value;switch(condition.operator||"truthy"){case"eq":return left===right;case"neq":return left!==right;case"gt":return Number(left)>Number(right);case"gte":return Number(left)>=Number(right);case"lt":return Number(left)<Number(right);case"contains":return Array.isArray(left)?left.includes(right):String(left??"").includes(String(right));case"truthy":return !!left;default:throw Error("Opérateur de condition interdit : "+condition.operator);}}
export async function executeWorkflow(workflow,{context={},executors={},maxSteps=32}={}){validateWorkflow(workflow);const byId=new Map(workflow.steps.map(step=>[step.id,step])),trace=[],values=clone(context),visited=new Map();let current=workflow.start||workflow.steps[0]?.id,steps=0;while(current){if(++steps>maxSteps)throw Error("Limite d’étapes du workflow dépassée.");const step=byId.get(current);if(!step)throw Error("Étape introuvable : "+current);const count=(visited.get(current)||0)+1;visited.set(current,count);if(count>4)throw Error("Boucle du workflow détectée à l’étape "+current+".");let result=null,error=null;try{if(step.type==="condition"){result=evaluateCondition(step.condition,values);values[step.id]=result;}else{const executor=executors[step.type];if(typeof executor!=="function")throw Error("Aucun exécuteur disponible pour "+step.type);const input=step.input?pathValue(values,step.input):values;result=await executor({step:clone(step),input:clone(input),context:clone(values)});values[step.id]=clone(result);}}catch(cause){error=cause.message;trace.push({stepId:step.id,type:step.type,status:"error",error});if(step.onError){current=step.onError;continue;}throw Object.assign(new Error("Échec du workflow à l’étape "+step.id+" : "+error),{workflowTrace:trace});}trace.push({stepId:step.id,type:step.type,status:"success",result:clone(result)});if(step.type==="condition")current=result?(step.onTrue||step.next):(step.onFalse||step.next);else current=step.next||null;if(Array.isArray(current)){const selected=current.find(target=>byId.get(target)?.when?evaluateCondition(byId.get(target).when,values):true);current=selected||null;}}return {values,trace};}
export const DEFAULT_WORKFLOW={schemaVersion:1,start:"score-user",steps:[{id:"score-user",type:"score",side:"user",input:"userMessage",next:"model"},{id:"model",type:"model",input:"score-user",include:["score-user"],next:"score-assistant"},{id:"score-assistant",type:"score",side:"assistant",input:"model",next:"finalize"},{id:"finalize",type:"output",input:"model"}]};
