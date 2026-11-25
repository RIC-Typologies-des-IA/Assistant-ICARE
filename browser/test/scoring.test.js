import test from "node:test";
import assert from "node:assert/strict";
import { scoreIcareMultilabel, listLemonadeScoringModels } from "../scoring.js";
const scores={I:.8,C:.6,A:.3,R:.7,E:.4};
test("direct scoring calls the configured endpoint without a model vendor dependency",async()=>{
 let request;
 const result=await scoreIcareMultilabel({text:"Cette situation nous oblige à revoir notre intention.",directUrl:"https://scoring.example.org/api/score",apiKey:"score-secret",fetchImpl:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({scores})};}});
 assert.equal(request.url,"https://scoring.example.org/api/score");assert.equal(request.options.headers.Authorization,"Bearer score-secret");
 const body=JSON.parse(request.options.body);assert.equal(body.multi_label,true);assert.equal(body.text,"Cette situation nous oblige à revoir notre intention.");
 assert.deepEqual(result.scores,scores);assert.notEqual(Object.values(result.scores).reduce((x,y)=>x+y,0),1);
});
test("rejects malformed scoring endpoint URLs",async()=>{
 await assert.rejects(()=>scoreIcareMultilabel({text:"Bonjour",directUrl:"javascript:alert(1)"}),/HTTPS/);
 await assert.rejects(()=>scoreIcareMultilabel({text:"Bonjour",directUrl:"http://scoring.example.org/score"}),/HTTPS/);
});
test("routes scoring through a selected HTTPS Gateway",async()=>{
 let request;
 const result=await scoreIcareMultilabel({text:"Bonjour",route:"gateway-2",gatewayUrl:"https://gateway.example.org",fetchImpl:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({scores})};}});
 assert.equal(request.url,"https://gateway.example.org/v1/icare/scoring");assert.equal(request.options.credentials,"include");assert.equal(request.options.headers.Authorization,undefined);assert.deepEqual(result.scores,scores);
});
test("rejects invalid independent scores",async()=>{
 await assert.rejects(()=>scoreIcareMultilabel({text:"Bonjour",directUrl:"http://localhost:8787/score",fetchImpl:async()=>({ok:true,json:async()=>({scores:{I:2,C:.2,A:.3,R:.4,E:.5}})})}),/Score ICARE invalide/);
});


test("Lemonade discovery only exposes FastFlowLM decision models that support classification and systemone",async()=>{
 let requestedUrl="";
 const models=await listLemonadeScoringModels({baseUrl:"http://127.0.0.1:13305",fetchImpl:async(url)=>{
  requestedUrl=String(url);
  return new Response(JSON.stringify({data:[
   {id:"d3-ultra-FLM",recipe:"flm",labels:["classification","systemone"],downloaded:false,size:15.4},
   {id:"d3-lite-FLM",recipe:"flm",labels:["classification","systemone"],downloaded:true},
   {id:"Qwen3-FLM",recipe:"flm",labels:["chat"]},
   {id:"Bert-ONNX",recipe:"onnxruntime",labels:["classification"]}
  ]}),{status:200,headers:{"content-type":"application/json"}});
 }});
 assert.equal(requestedUrl,"http://127.0.0.1:13305/v1/models?show_all=true");
 assert.deepEqual(models.map(model=>model.id),["d3-lite-FLM","d3-ultra-FLM"]);
 assert.equal(models[1].downloaded,false);
});

test("Lemonade D3 scoring sends five independent noul questions and returns five independent probabilities",async()=>{
 let call;
 const result=await scoreIcareMultilabel({
  text:"Le collectif définit une finalité, organise des actions et adapte sa gouvernance.",
  provider:"lemonade",lemonadeBaseUrl:"http://127.0.0.1:13305",model:"d3-ultra-FLM",
  fetchImpl:async(url,options)=>{
   call={url:String(url),options,body:JSON.parse(options.body)};
   return new Response(JSON.stringify({model:"d3-ultra-FLM",answers:{
    I:{type:"noul",noul:0.91},C:{type:"noul",noul:0.72},A:{type:"noul",noul:0.84},
    R:{type:"noul",noul:0.63},E:{type:"noul",noul:0.58}
   }}),{status:200,headers:{"content-type":"application/json"}});
  }
 });
 assert.equal(call.url,"http://127.0.0.1:13305/v1/systemone");
 assert.equal(call.body.model,"d3-ultra-FLM");
 assert.equal(call.body.state,"Le collectif définit une finalité, organise des actions et adapte sa gouvernance.");
 assert.deepEqual(Object.keys(call.body.questions),["I","C","A","R","E"]);
 assert.ok(Object.values(call.body.questions).every(question=>question.type==="noul"));
 assert.deepEqual(result.scores,{I:0.91,C:0.72,A:0.84,R:0.63,E:0.58});
 assert.equal(result.method,"lemonade-fastflowlm-systemone-multilabel");
});

test("Lemonade scoring refuses non-local endpoints",async()=>{
 await assert.rejects(()=>listLemonadeScoringModels({baseUrl:"https://remote.example"}),/doit rester local/);
});
