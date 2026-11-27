import test from "node:test";
import assert from "node:assert/strict";
import {createExperimentState,createConfiguration,snapshotConfiguration,createConversationBranch,branchHistory,appendBranchTurn,recordExperimentExecution,createWorkflow,validateWorkflow,executeWorkflow} from "../experimentation.js";
test("configurations create immutable reproducibility snapshots",()=>{let state=createExperimentState();const created=createConfiguration(state,{name:"Scoring enrichi",documents:{"scoring-payload":"{}"}});state=created.state;const snapshot=snapshotConfiguration(created.configuration);created.configuration.documents["scoring-payload"]="changed";assert.equal(snapshot.documents["scoring-payload"],"{}");assert.equal(snapshot.configurationId,created.configuration.id);});
test("conversation branches retain explicit historical and configuration ancestry",()=>{let state=createExperimentState();const config=createConfiguration(state,{name:"A"});const snapshot=snapshotConfiguration(config.configuration);const result=createConversationBranch(config.state,{projectId:"p1",sourceTurnId:"t2",sourceTurnIndex:1,configurationSnapshot:snapshot,name:"Rejeu t2"});assert.equal(result.branch.sourceTurnId,"t2");assert.equal(result.branch.configurationSnapshot.id,snapshot.id);const turns=[{id:"t1"},{id:"t2"},{id:"t3"}];assert.deepEqual(branchHistory(turns,result.branch),turns.slice(0,2));const appended=appendBranchTurn(result.branch,{id:"t4"});assert.deepEqual(appended.turnIds,["t4"]);});
test("workflow validates dependencies and rejects cycles and unknown node types",()=>{assert.deepEqual(validateWorkflow({nodes:[{id:"a",type:"scoring"},{id:"b",type:"llm"}],edges:[{from:"a",to:"b"}]}),[]);assert.ok(validateWorkflow({nodes:[{id:"a",type:"llm"},{id:"b",type:"tool"}],edges:[{from:"a",to:"b"},{from:"b",to:"a"}]}).some(x=>x.includes("cycle")));assert.ok(validateWorkflow({nodes:[{id:"a",type:"eval"}],edges:[]}).length);});
test("workflow executes scoring before injecting its result into the LLM adapter",async()=>{const order=[];const workflow=createWorkflow({nodes:[{id:"score",type:"scoring",config:{}} ,{id:"answer",type:"llm"}],edges:[{from:"score",to:"answer"}],output:"answer"});const result=await executeWorkflow(workflow,{input:{text:"test"},adapters:{scoring:async({input})=>{order.push("score");return {I:.9,text:input.text};},llm:async({parents})=>{order.push("llm");return {prompt:"Scores : "+JSON.stringify(parents.score)};}}});assert.deepEqual(order,["score","llm"]);assert.match(result.result.prompt,/"I":0.9/);});
test("workflow refuses execution without the required adapter",async()=>{const workflow=createWorkflow({nodes:[{id:"score",type:"scoring"}]});await assert.rejects(executeWorkflow(workflow),/Aucun adaptateur/);});

test("nested branches reconstruct only their own ancestry and never leak sibling turns",()=>{
 let state=createExperimentState();const a=createConfiguration(state,{name:"A"});state=a.state;const snap=snapshotConfiguration(a.configuration);
 const root={id:"root",projectId:"p",turnIds:["t1","t2"]};
 const child={id:"child",projectId:"p",parentBranchId:"root",sourceTurnId:"t1",configurationSnapshot:snap,turnIds:["t3"]};
 const sibling={id:"sibling",projectId:"p",parentBranchId:"root",sourceTurnId:"t2",configurationSnapshot:snap,turnIds:["t4"]};
 const grandchild={id:"grandchild",projectId:"p",parentBranchId:"child",sourceTurnId:"t3",configurationSnapshot:snap,turnIds:["t5"]};
 const turns=[{id:"t1"},{id:"t2",branchId:"root"},{id:"t3",branchId:"child"},{id:"t4",branchId:"sibling"},{id:"t5",branchId:"grandchild"}];
 assert.deepEqual(branchHistory(turns,grandchild,[root,child,sibling,grandchild]).map(x=>x.id),["t1","t3","t5"]);
 assert.deepEqual(branchHistory(turns,sibling,[root,child,sibling,grandchild]).map(x=>x.id),["t1","t2","t4"]);
});
test("branch history rejects missing parents and cycles",()=>{
 const branch={id:"a",parentBranchId:"missing",turnIds:[]};
 assert.throws(()=>branchHistory([],branch,[branch]),/parente/);
 const a={id:"a",parentBranchId:"b",turnIds:[]},b={id:"b",parentBranchId:"a",turnIds:[]};
 assert.throws(()=>branchHistory([],a,[a,b]),/cycle/);
});

test("experiment executions preserve branch, snapshot, inputs, outputs and trace",()=>{
 const base=createExperimentState(),execution={id:"run-1",branchId:"branch-1",configurationSnapshotId:"snapshot-1",sourceTurnId:"turn-2",parentTurnId:"turn-1",input:{text:"test"},output:{content:"réponse"},trace:[{type:"model"}],deterministic:false};
 const next=recordExperimentExecution(base,execution);
 assert.equal(next.executions[0].configurationSnapshotId,"snapshot-1");
 assert.equal(next.executions[0].trace[0].type,"model");
 assert.equal(base.executions.length,0);
 assert.throws(()=>recordExperimentExecution(next,execution),/déjà utilisé/);
});

test("replay branches start immediately before the selected historical turn",()=>{
 const base=createExperimentState(),cfg=createConfiguration(base,{name:"Replay"}),snap=snapshotConfiguration(cfg.configuration);
 const source={id:"t2",projectId:"p",user:"à rejouer",assistant:"ancienne réponse"};
 const turns=[{id:"t1"},{...source}];
 const branch=createConversationBranch(cfg.state,{projectId:"p",sourceTurnId:"t2",sourceTurnMode:"before",configurationSnapshot:snap}).branch;
 assert.deepEqual(branchHistory(turns,branch,[branch]).map(turn=>turn.id),["t1"]);
});
