const QUESTIONS={
 I:"Ce texte exprime-t-il une intention, une finalité, un objectif, un besoin explicite ou une orientation du système ?",
 C:"Ce texte apporte-t-il des éléments sur le contexte, la situation, les acteurs, l'environnement, les contraintes ou les relations du système ?",
 A:"Ce texte décrit-il une action, une opération, une activité, une mise en œuvre ou une intervention concrète ?",
 R:"Ce texte décrit-il une régulation, un retour d'information, une évaluation, une réflexivité, un ajustement ou une gouvernance ?",
 E:"Ce texte décrit-il une évolution, une transformation, un apprentissage, une émergence, une dynamique temporelle ou une nouveauté ?"
};
function apiBase(value){
 let base=String(value||"").trim().replace(/\\/+$/,"");
 if(!base)throw new Error("Renseignez l’adresse de Lemonade.");
 let parsed;try{parsed=new URL(base);}catch{throw new Error("Adresse Lemonade invalide.");}
 if(parsed.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(parsed.hostname)||parsed.username||parsed.password)throw new Error("Le scoring Lemonade doit rester local : HTTP sur localhost ou 127.0.0.1 uniquement.");
 return base;
}
function endpoint(base,path){const clean=apiBase(base).replace(/\\/v1$/i,"");return clean+"/v1/"+path;}
export async function listLemonadeScoringModels({baseUrl="http://127.0.0.1:13305",apiKey="",fetchImpl=fetch}={}){
 const headers={};if(apiKey)headers.Authorization="Bearer "+apiKey;
 let response;try{response=await fetchImpl(endpoint(baseUrl,"models?show_all=true"),{headers,cache:"no-store"});}catch(error){throw new Error("Impossible de joindre Lemonade local : "+(error?.message||String(error)));}
 if(!response.ok){let detail="";try{const data=await response.json();detail=data.error?.message||data.message||"";}catch{}throw new Error("Catalogue Lemonade indisponible ("+response.status+")"+(detail?" : "+detail:""));}
 const data=await response.json(),items=data.data||data.models||[];
 return items.filter(item=>item&&item.recipe==="flm"&&Array.isArray(item.labels)&&item.labels.includes("classification")&&item.labels.includes("systemone"))
  .map(item=>({id:String(item.id||""),downloaded:item.downloaded===true,size:item.size??null}))
  .filter(item=>item.id).sort((a,b)=>a.id.localeCompare(b.id));
}
function parseDecisionScores(payload){
 const answers=payload?.answers;if(!answers||typeof answers!=="object")throw new Error("Réponse Lemonade /v1/systemone non reconnue.");
 const scores={};
 for(const code of ["I","C","A","R","E"]){
  const answer=answers[code];
  if(answer?.error)throw new Error("Scoring "+code+" refusé : "+(answer.message||answer.error));
  const value=Number(answer?.noul);
  if(!Number.isFinite(value)||value<0||value>1)throw new Error("Probabilité de décision invalide pour la dimension "+code+".");
  scores[code]=value;
 }
 return scores;
}
function parseScores(payload){
 const raw=payload?.scores&&typeof payload.scores==="object"?payload.scores:payload;
 if(!raw||typeof raw!=="object")throw new Error("Réponse du service de scoring ICARE non reconnue.");
 return Object.fromEntries(["I","C","A","R","E"].map(code=>[code,Number(raw[code]??raw[code.toLowerCase()])]));
}
export async function scoreIcareMultilabel({text,route="direct",gatewayUrl="",directUrl="",apiKey="",provider="custom",lemonadeBaseUrl="http://127.0.0.1:13305",model="",fetchImpl=fetch}={}){
 if(typeof text!=="string"||!text.trim())throw new Error("Message vide : scoring impossible.");
 let url,credentials="omit";
 if(route==="direct"&&provider==="lemonade"){
  if(!String(model||"").trim())throw new Error("Sélectionnez un modèle FastFlowLM compatible avec le scoring ICARE.");
  url=endpoint(lemonadeBaseUrl,"systemone");
  const headers={"Content-Type":"application/json"};if(apiKey)headers.Authorization="Bearer "+apiKey;
  const questions=Object.fromEntries(Object.entries(QUESTIONS).map(([code,instructions])=>[code,{type:"noul",instructions}]));
  let response;try{response=await fetchImpl(url,{method:"POST",headers,cache:"no-store",body:JSON.stringify({model,state:text,questions})});}
  catch(error){throw new Error("Impossible de joindre le moteur de scoring Lemonade : "+(error?.message||String(error)));}
  if(!response.ok){let detail="";try{const data=await response.json();detail=data.error?.message||data.message||data.error||"";}catch{}throw new Error("Lemonade /v1/systemone indisponible ("+response.status+")"+(detail?" : "+detail:""));}
  const scores=parseDecisionScores(await response.json());
  return {method:"lemonade-fastflowlm-systemone-multilabel",model,scores,createdAt:new Date().toISOString()};
 }
 if(route==="direct"){if(!directUrl)throw new Error("Configurez l’URL du service de scoring ICARE.");url=directUrl;}
 else{if(!gatewayUrl)throw new Error("URL de la Gateway de scoring absente.");const base=gatewayUrl.replace(/\\/+$/,"");url=(base.endsWith("/v1")?base:base+"/v1")+"/icare/scoring";credentials="include";}
 let parsed;try{parsed=new URL(url);}catch{throw new Error("URL du service de scoring ICARE invalide.");}
 const loopback=["localhost","127.0.0.1","[::1]"].includes(parsed.hostname);if((parsed.protocol!=="https:"&&!(parsed.protocol==="http:"&&loopback))||parsed.username||parsed.password)throw new Error("Le service de scoring doit utiliser HTTPS, sauf sur loopback local.");
 const headers={"Content-Type":"application/json"};if(route==="direct"&&apiKey)headers.Authorization="Bearer "+apiKey;
 let response;
 try{response=await fetchImpl(parsed.href,{method:"POST",credentials,cache:"no-store",headers,body:JSON.stringify({text,dimensions:["I","C","A","R","E"],multi_label:true})});}
 catch(error){throw new Error("Impossible de joindre le service de scoring ICARE : "+error.message);}
 if(!response.ok){let detail="";try{const data=await response.json();detail=data.error?.message||data.error||data.message||"";}catch{}throw new Error("Service de scoring ICARE indisponible ("+response.status+")"+(detail?" : "+detail:""));}
 const scores=parseScores(await response.json());
 for(const code of ["I","C","A","R","E"])if(!Number.isFinite(scores[code])||scores[code]<0||scores[code]>1)throw new Error("Score ICARE invalide pour la dimension "+code+".");
 return {method:"icare-multilabel-endpoint",scores,createdAt:new Date().toISOString()};
}
