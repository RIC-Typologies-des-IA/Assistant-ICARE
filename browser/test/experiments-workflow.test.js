import test from "node:test";import assert from "node:assert/strict";
import {createExperimentState,createConfigurationSnapshot,createConversationBranch,recordExperimentRun,getExperimentLineage,compareExperimentRuns,experimentStorageKey,remapExperimentState} from "../experiments.js";
import {validateWorkflow,evaluateCondition,executeWorkflow,DEFAULT_WORKFLOW} from "../workflow-engine.js";
test("experimental branch snapshots its configuration and links its source",()=>{const config=createConfigurationSnapshot({id:"cfg-a",documents:{prompt:"custom"}});const created=createConversationBranch(createExperimentState(),{sourceTurnId:"turn-12",sourceIndex:12,configuration:config,contextTurns:[{id:"turn-11",user:"avant"}],workspaceSnapshot:{dimensions:{I:"sufficient"}}});config.documents.prompt="changed";assert.equal(created.branch.configurationSnapshot.documents.prompt,"custom");assert.equal(created.branch.sourceTurnId,"turn-12");assert.deepEqual(created.branch.contextTurnIds,["turn-11"]);assert.equal(created.branch.workspaceSnapshot.dimensions.I,"sufficient");const recorded=recordExperimentRun(created.state,{branchId:created.branch.id,sourceTurnId:"turn-12",userMessage:"rejouer",assistantMessage:"résultat",workspaceSnapshotAfter:{dimensions:{I:"changed"}}});assert.equal(recorded.state.runs.length,1);assert.equal(recorded.state.branches[0].workspaceSnapshot.dimensions.I,"changed");assert.equal(getExperimentLineage(recorded.state,created.branch.id).length,1);assert.equal(compareExperimentRuns(recorded.run,recorded.run).sameSource,true);});
test("workflow validates references and executes score before model with explicit output",async()=>{const workflow={schemaVersion:1,start:"score",steps:[{id:"score",type:"score",input:"userMessage",next:"model"},{id:"model",type:"model",input:"score",next:"done"},{id:"done",type:"output"}]};const order=[];const result=await executeWorkflow(workflow,{context:{userMessage:"texte"},executors:{score:async({input})=>{order.push("score");return {I:.8,text:input};},model:async({input})=>{order.push("model");return {received:input};},output:async()=>null}});assert.deepEqual(order,["score","model"]);assert.equal(result.values.model.received.I,.8);});
test("workflow conditions select a branch and reject unsafe operators",async()=>{assert.equal(evaluateCondition({path:"score.I",operator:"gte",value:.5},{score:{I:.8}}),true);const result=await executeWorkflow({schemaVersion:1,start:"check",steps:[{id:"check",type:"condition",condition:{path:"flag"},onTrue:"yes",onFalse:"no"},{id:"yes",type:"output"},{id:"no",type:"output"}]},{context:{flag:true},executors:{output:async()=>null}});assert.equal(result.trace[0].result,true);assert.throws(()=>validateWorkflow({schemaVersion:1,steps:[{id:"x",type:"model",next:"missing"}]}),/inconnue/);assert.throws(()=>evaluateCondition({path:"x",operator:"eval"},{}),/interdit/);});

test("default workflow scores before generation and scores the response",()=>{assert.deepEqual(DEFAULT_WORKFLOW.steps.map(step=>step.type),["score","model","score","output"]);assert.equal(DEFAULT_WORKFLOW.steps[1].include[0],"score-user");});

test("experiment settings are isolated by project",()=>{
 assert.equal(experimentStorageKey("project-a"),"experiments:project-a");
 assert.notEqual(experimentStorageKey("project-a"),experimentStorageKey("project-b"));
 assert.throws(()=>experimentStorageKey(""),/projet/);
});

test("comparison computes user and assistant score deltas independently",()=>{
 const left={sourceTurnId:"turn-1",userMessage:"same",assistantMessage:"A",scores:{user:{I:.2},assistant:{I:.4}}};
 const right={sourceTurnId:"turn-1",userMessage:"same",assistantMessage:"B",scores:{user:{I:.7},assistant:{I:.1}}};
 const result=compareExperimentRuns(left,right);
 assert.ok(Math.abs(result.scoreDelta.I-.5)<1e-10);
 assert.ok(Math.abs(result.assistantScoreDelta.I+.3)<1e-10);
 assert.equal(result.assistantChanged,true);
});

test("project import remaps branch and run source references to imported turn ids",()=>{
 const state=createExperimentState({branches:[{id:"branch-a",sourceTurnId:"turn-1",contextTurnIds:["turn-0","turn-1"],turnIds:["run-1"]}],runs:[{id:"run-1",branchId:"branch-a",sourceTurnId:"turn-1"}]});
 const remapped=remapExperimentState(state,new Map([["turn-0","new-0"],["turn-1","new-1"]]));
 assert.equal(remapped.branches[0].sourceTurnId,"new-1");
 assert.deepEqual(remapped.branches[0].contextTurnIds,["new-0","new-1"]);
 assert.equal(remapped.runs[0].sourceTurnId,"new-1");
 assert.equal(remapped.branches[0].turnIds[0],"run-1");
});
