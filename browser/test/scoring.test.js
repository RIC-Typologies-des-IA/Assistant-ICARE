import test from "node:test";
import assert from "node:assert/strict";
import { scoreIcareMultilabel } from "../scoring.js";
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
