const LABELS=[
 {code:"I",label:"information and intention",description:"Information, purpose, intent, goals, stated needs and the meaning or direction of the system."},
 {code:"C",label:"context and understanding",description:"Context, situation, constraints, actors, environment, relationships and understanding of the system."},
 {code:"A",label:"action and operation",description:"Actions, operations, implementation, tasks and concrete interventions."},
 {code:"R",label:"regulation and reflexivity",description:"Regulation, feedback, critical reflection, evaluation, adjustment and governance."},
 {code:"E",label:"emergence and evolution",description:"Emergence, transformation, learning, temporal dynamics, novelty and evolution."}
];
function parseScores(payload){
 const raw=payload?.scores&&typeof payload.scores==="object"?payload.scores:payload;
 if(!raw||typeof raw!=="object")throw new Error("Réponse du service de scoring ICARE non reconnue.");
 return Object.fromEntries(["I","C","A","R","E"].map(code=>[code,Number(raw[code]??raw[code.toLowerCase()])]));
}
export async function scoreIcareMultilabel({text,route="direct",gatewayUrl="",directUrl="",fetchImpl=fetch}){
 if(typeof text!=="string"||!text.trim())throw new Error("Message vide : scoring impossible.");
 let url,credentials="omit";
 if(route==="direct"){if(!directUrl)throw new Error("Configurez l’URL du service de scoring ICARE.");url=directUrl;}
 else{if(!gatewayUrl)throw new Error("URL de la Gateway de scoring absente.");const base=gatewayUrl.replace(/\/+$/,"");url=(base.endsWith("/v1")?base:base+"/v1")+"/icare/scoring";credentials="include";}
 let endpoint;try{endpoint=new URL(url);}catch{throw new Error("URL du service de scoring ICARE invalide.");}
 if(!["http:","https:"].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw new Error("L’URL du service de scoring doit être une URL HTTP(S) sans identifiants.");
 let response;
 try{response=await fetchImpl(endpoint.href,{method:"POST",credentials,cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,dimensions:LABELS,multi_label:true})});}
 catch(error){throw new Error("Impossible de joindre le service de scoring ICARE : "+error.message);}
 if(!response.ok){let detail="";try{const data=await response.json();detail=data.error?.message||data.error||data.message||"";}catch{}throw new Error("Service de scoring ICARE indisponible ("+response.status+")"+(detail?" : "+detail:""));}
 const scores=parseScores(await response.json());
 for(const code of ["I","C","A","R","E"])if(!Number.isFinite(scores[code])||scores[code]<0||scores[code]>1)throw new Error("Score ICARE invalide pour la dimension "+code+".");
 return {method:"icare-multilabel-endpoint",scores,createdAt:new Date().toISOString()};
}
