import test from "node:test";
import assert from "node:assert/strict";
import { scoreIcareMultilabel } from "../scoring.js";
const scores={I:.8,C:.6,A:.3,R:.7,E:.4};
test("direct scoring calls only the local loopback inference endpoint",async()=>{
 let request;
 const result=await scoreIcareMultilabel({text:"Cette situation nous oblige à revoir notre intention et nos pratiques.",directUrl:"http://127.0.0.1:8787/v1/icare/scoring",fetchImpl:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({scores})};}});
 assert.equal(request.url,"http://127.0.0.1:8787/v1/icare/scoring");
 assert.equal(JSON.parse(request.options.body).multi_label,true);
 assert.equal(JSON.parse(request.options.body).text,"Cette situation nous oblige à revoir notre intention et nos pratiques.");
 assert.deepEqual(result.scores,scores);
 assert.notEqual(Object.values(result.scores).reduce((x,y)=>x+y,0),1);
});
test("rejects any direct scoring endpoint outside loopback",async()=>{
 await assert.rejects(()=>scoreIcareMultilabel({text:"Bonjour",directUrl:"https://router.huggingface.co/inference",fetchImpl:async()=>{throw Error("must not be called");}}),/loopback local/);
});
test("routes multilabel scoring through a selected controlled Gateway",async()=>{
 let request;
 const result=await scoreIcareMultilabel({text:"Bonjour",route:"gateway-2",gatewayUrl:"https://gateway.example.org",fetchImpl:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({scores})};}});
 assert.equal(request.url,"https://gateway.example.org/v1/icare/scoring");
 assert.equal(request.options.credentials,"include");
 assert.deepEqual(result.scores,scores);
});
test("rejects malformed scores",async()=>{
 await assert.rejects(()=>scoreIcareMultilabel({text:"Bonjour",directUrl:"http://localhost:8787/v1/icare/scoring",fetchImpl:async()=>({ok:true,json:async()=>({scores:{I:2,C:.2,A:.3,R:.4,E:.5}})})}),/Score invalide/);
});
