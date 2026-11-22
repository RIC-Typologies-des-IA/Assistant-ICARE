export const ICARE_TOOLS = [
{type:"function",function:{name:"list_available_models",description:"Lister les modèles disponibles chez le fournisseur configuré.",parameters:{type:"object",properties:{},additionalProperties:false}}},
{type:"function",function:{name:"get_ontology",description:"Consulter l'ontologie ICARE structurée, ses dimensions et ses vocabulaires.",parameters:{type:"object",properties:{},additionalProperties:false}}},
{type:"function",function:{name:"get_exploration_state",description:"Lire l'état courant des cinq dimensions ICARE du projet.",parameters:{type:"object",properties:{},additionalProperties:false}}},
{type:"function",function:{name:"search_reference_documents",description:"Rechercher dans les documents de référence du projet.",parameters:{type:"object",properties:{query:{type:"string"}},required:["query"],additionalProperties:false}}},
{type:"function",function:{name:"list_propositions",description:"Lister les propositions et leurs statuts.",parameters:{type:"object",properties:{status:{type:"string",enum:["all","candidate","accepted","rejected"]}},additionalProperties:false}}},
{type:"function",function:{name:"propose_observation",description:"Enregistrer une observation candidate dans le registre ICARE. Ne jamais annoncer un succès sans identifiant retourné.",parameters:{type:"object",properties:{text:{type:"string"},dimensions:{type:"array",items:{type:"string",enum:["I","C","A","R","E"]}},primary_dimension:{type:"string",enum:["I","C","A","R","E"]},temporal:{type:"string",enum:["past","present","future","unknown"]},evaluation:{type:"string",enum:["desired","undesired","feared","preferred","unfavorable","neutral","unknown"]},modality:{type:"string",enum:["possible","impossible","necessary","permitted","forbidden","unknown"]},epistemic:{type:"string",enum:["observed","asserted","reported","inferred","hypothesis","predicted","unknown"]},practical:{type:"string",enum:["considered","proposed","decided","committed","in_progress","completed","abandoned","unspecified"]},confidence:{type:"number",minimum:0,maximum:1},source:{type:"string"},subject:{type:"string"},predicate:{type:"string"},value:{type:"string"},justification:{type:"string"}},required:["text","dimensions","epistemic","confidence","source"],additionalProperties:false}}},
{type:"function",function:{name:"propose_relation",description:"Créer une relation candidate entre deux propositions existantes.",parameters:{type:"object",properties:{from_id:{type:"string"},to_id:{type:"string"},relation:{type:"string",enum:["confirms","specifies","complements","nuances","contradicts","revises","derived_from","same_aspect","precedes","succeeds","previous_state_of","current_state_of","target_state_of","contributes_to","prevents","conditions","desired_by","rejected_by","decided_by","committed_by","realized_by"]},note:{type:"string"}},required:["from_id","to_id","relation"],additionalProperties:false}}},
{type:"function",function:{name:"update_exploration_status",description:"Modifier le statut d'une dimension du projet. Les statuts sufficient et not_applicable exigent une justification.",parameters:{type:"object",properties:{dimension:{type:"string",enum:["I","C","A","R","E"]},status:{type:"string",enum:["unexplored","insufficient","sufficient","not_applicable"]},justification:{type:"string"}},required:["dimension","status","justification"],additionalProperties:false}}},
{type:"function",function:{name:"create_reference_document",description:"Ajouter un document au corpus documentaire du projet.",parameters:{type:"object",properties:{title:{type:"string"},content:{type:"string"}},required:["title","content"],additionalProperties:false}}},
{type:"function",function:{name:"update_reference_document",description:"Modifier un document de référence existant par son identifiant.",parameters:{type:"object",properties:{id:{type:"string"},title:{type:"string"},content:{type:"string"}},required:["id","title","content"],additionalProperties:false}}},
{type:"function",function:{name:"list_wasi_components",description:"Lister les composants WebAssembly ICARE chargés dans le runtime navigateur et leurs capacités déclarées.",parameters:{type:"object",properties:{},additionalProperties:false}}},
{type:"function",function:{name:"invoke_wasi_component",description:"Invoquer un composant WASI explicitement enregistré. Les capacités non accordées par l'hôte sont refusées.",parameters:{type:"object",properties:{component_id:{type:"string",enum:["ontology-validator","context-summary"]},operation:{type:"string"},payload:{type:"object",additionalProperties:true}},required:["component_id","operation","payload"],additionalProperties:false}}}
];
export async function runAgentTurn({messages,complete,executeTool,maxSteps=8}) {
 const transcript=[...messages],executed=[];
 for(let step=0;step<maxSteps;step++){
  const message=await complete(transcript,ICARE_TOOLS);
  if(!message||typeof message!=="object")throw new Error("Réponse agentique invalide.");
  if(!Array.isArray(message.tool_calls)||!message.tool_calls.length){return {content:typeof message.content==="string"?message.content:"",executed};}
  transcript.push({role:"assistant",content:message.content||null,tool_calls:message.tool_calls});
  for(const call of message.tool_calls){
   const name=call.function?.name||"",id=call.id||"";
   let result;
   try{const args=JSON.parse(call.function?.arguments||"{}");result=await executeTool(name,args);executed.push({name,result});}
   catch(error){result={ok:false,error:error.message};}
   transcript.push({role:"tool",tool_call_id:id,name,content:JSON.stringify(result)});
  }
 }
 throw new Error("La limite de huit étapes d'outils a été atteinte. Le tour n'a pas reçu de réponse finale.");
}
