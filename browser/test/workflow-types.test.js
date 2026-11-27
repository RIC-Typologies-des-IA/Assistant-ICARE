import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow, workflowOutputType } from "../workflow-engine.js";

const step=(id,type,input)=>({id,type,input});
test("existing default workflow is valid under typed dataflow rules",()=>{
 const workflow={schemaVersion:1,start:"score-user",steps:[
  {...step("score-user","score","userMessage"),side:"user",next:"model"},
  {...step("model","model","score-user"),include:["score-user"],next:"score-assistant"},
  {...step("score-assistant","score","model"),side:"assistant",next:"finish"},
  step("finish","output","model")
 ]};
 assert.equal(validateWorkflow(workflow),true);
});
test("rejects a document result wired directly into scoring",()=>{
 const workflow={schemaVersion:1,start:"document",steps:[
  {...step("document","tool","userMessage"),tool:"search_reference_documents",next:"scoring"},
  step("scoring","score","document")
 ]};
 assert.throws(()=>validateWorkflow(workflow),/Connexion incompatible.*Text.*ScoreReport/);
});
test("accepts scoring output as model context and model output as assistant scoring input",()=>{
 const workflow={schemaVersion:1,start:"score",steps:[
  {...step("score","score","userMessage"),side:"user",next:"model"},
  {...step("model","model","score"),include:["score"],next:"answer-score"},
  {...step("answer-score","score","model"),side:"assistant"}
 ]};
 assert.equal(validateWorkflow(workflow),true);
});
test("rejects missing transition targets",()=>{
 assert.throws(()=>validateWorkflow({schemaVersion:1,start:"a",steps:[{id:"a",type:"model",next:"missing"}]}),/étape inconnue/);
});
test("exposes stable output types for node registry",()=>{
 assert.equal(workflowOutputType({type:"score"}),"ScoreReport");
 assert.equal(workflowOutputType({type:"model"}),"LLMResponse");
});
