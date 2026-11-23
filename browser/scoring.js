const MODEL="Horizon-Labs/multilingual-zeroshot-base";
const LABELS=[
 {label:"information and intention",code:"I",description:"Information, purpose, intent, goals, stated needs and the meaning or direction of the system."},
 {label:"context and understanding",code:"C",description:"Context, situation, constraints, actors, environment, relationships and understanding of the system."},
 {label:"action and operation",code:"A",description:"Actions, operations, decisions to act, implementation, tasks and concrete interventions."},
 {label:"regulation and reflexivity",code:"R",description:"Regulation, feedback, critical reflection, evaluation, adjustment, governance and self-observation."},
 {label:"emergence and evolution",code:"E",description:"Emergence, transformation, learning, temporal dynamics, novelty and evolution of the system."}
];
function parseScores(payload){
 let result=payload;
 if(Array.isArray(result)&&result.length===1)result=result[0];
 if(result?.labels&&result?.scores){const scores={};result.labels.forEach((label,i)=>{const item=LABELS.find(x=>x.label===label||x.code===label||String(label).startsWith(x.label+" :"));if(item)scores[item.code]=Number(result.scores[i]);});return scores;}
 if(result?.scores&&typeof result.scores==="object"&&!Array.isArray(result.scores))return Object.fromEntries(["I","C","A","R","E"].map(k=>[k,Number(result.scores[k]??0)]));
 if(result?.I!==undefined)return Object.fromEntries(["I","C","A","R","E"].map(k=>[k,Number(result[k]??0)]));
 throw new Error("Réponse du moteur de scoring non reconnue.");
}
export async function scoreIcareMultilabel({text,route="direct",gatewayUrl="",directUrl="",fetchImpl=fetch}){
 if(!text?.trim())throw new Error("Message vide : scoring impossible.");
 const viaGateway=route!=="direct";
 let url,body,credentials;
 if(viaGateway){
  if(!gatewayUrl)throw new Error("URL de la Gateway de scoring absente.");
  const base=gatewayUrl.replace(/\/+$/,"");url=(base.endsWith("/v1")?base:base+"/v1")+"/icare/scoring";
  body={model:"horizon-multilingual-zeroshot",text,labels:LABELS.map(x=>({code:x.code,label:x.label,description:x.description})),multi_label:true};
  credentials="include";
 }else{
  url=directUrl||"https://router.huggingface.co/hf-inference/models/"+MODEL;
  body={inputs:text,parameters:{candidate_labels:LABELS.map(x=>x.label+" : "+x.description),multi_label:true}};
  credentials="omit";
 }
 let response;
 try{response=await fetchImpl(url,{method:"POST",credentials,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}
 catch(error){throw new Error("Échec de connexion au moteur de scoring (CORS ou réseau) : "+error.message);}
 if(!response.ok){let detail="";try{const data=await response.json();detail=data.error||data.message||"";}catch{}throw new Error("Moteur de scoring indisponible ("+response.status+")"+(detail?" : "+detail:""));}
 const payload=await response.json(),scores=parseScores(payload);
 for(const code of ["I","C","A","R","E"])if(!Number.isFinite(scores[code])||scores[code]<0||scores[code]>1)throw new Error("Score invalide pour la dimension "+code+".");
 return {model:MODEL,method:"multilabel-zero-shot",scores,createdAt:new Date().toISOString()};
}
