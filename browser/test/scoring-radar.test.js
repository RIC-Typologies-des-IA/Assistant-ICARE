import test from "node:test";import assert from "node:assert/strict";import {calculateScoreRadar,calculateExecutionRadar,normaliseScoreVector,backfillConversationScores} from "../scoring-radar.js";
test("les moyennes cumulées incluent les dimensions à zéro à chaque échange",()=>{const radar=calculateScoreRadar([{userScores:{I:1,C:.8,A:0,R:0,E:0},assistantScores:{I:.4,C:.2,A:0,R:0,E:0}},{userScores:{I:0,C:0,A:.5,R:.6,E:0},assistantScores:{I:0,C:.8,A:.6,R:.2,E:0}}]);assert.deepEqual(radar.userAverage,{I:.5,C:.4,A:.25,R:.3,E:0});assert.deepEqual(radar.assistantAverage,{I:.2,C:.5,A:.3,R:.1,E:0});assert.deepEqual(radar.userLatest,{I:0,C:0,A:.5,R:.6,E:0});assert.equal(radar.observations,2);});
test("un historique vide repart de cinq zéros",()=>{const radar=calculateScoreRadar([]);assert.deepEqual(radar.userLatest,{I:0,C:0,A:0,R:0,E:0});assert.deepEqual(radar.userAverage,{I:0,C:0,A:0,R:0,E:0});assert.deepEqual(radar.assistantAverage,{I:0,C:0,A:0,R:0,E:0});});
test("les anciens tours utilisent scores comme compatibilité utilisateur et les absences valent zéro",()=>{const radar=calculateScoreRadar([{scores:{I:.8,C:.4}},{userScores:{A:.6},assistantScores:null}]);assert.deepEqual(radar.userAverage,{I:.4,C:.2,A:.3,R:0,E:0});assert.deepEqual(radar.assistantAverage,{I:0,C:0,A:0,R:0,E:0});});
test("les scores sont bornés entre zéro et un",()=>{assert.deepEqual(normaliseScoreVector({I:2,C:-1,A:"0.5",R:NaN}),{I:1,C:0,A:.5,R:0,E:0});});

test("recalcule les scores ICAR manquants des conversations historiques sans écraser le score utilisateur existant",async()=>{
 const turn={user:"Ancien message",assistant:"Ancienne réponse",scores:{I:.8,C:.4}};
 const calls=[],saved=[];
 const updated=await backfillConversationScores([turn],async(side,text)=>{calls.push({side,text});return side==="assistant"?{I:.2,C:.6,A:.4,R:.8,E:0}:null;},async value=>saved.push({...value}));
 assert.deepEqual(calls,[{side:"assistant",text:"Ancienne réponse"}]);
 assert.deepEqual(turn.userScores,{I:.8,C:.4,A:0,R:0,E:0});
 assert.deepEqual(turn.assistantScores,{I:.2,C:.6,A:.4,R:.8,E:0});
 assert.equal(turn.scoreBackfillVersion,1);
 assert.equal(saved.length,1);
 assert.deepEqual(updated,[turn]);
});
test("complète les deux côtés d'un tour ancien lorsque les deux scores sont absents",async()=>{
 const turn={user:"Question",assistant:"Réponse"};
 const calls=[];
 await backfillConversationScores([turn],async(side)=>{calls.push(side);return side==="user"?{I:1}:{E:1};},async()=>{});
 assert.deepEqual(calls,["user","assistant"]);
 assert.deepEqual(turn.userScores,{I:1,C:0,A:0,R:0,E:0});
 assert.deepEqual(turn.assistantScores,{I:0,C:0,A:0,R:0,E:1});
});
test("un échec de scoring reste réessayable au prochain chargement",async()=>{
 const turn={user:"Question",assistant:"Réponse",scores:{I:.7}};
 let calls=0;
 await backfillConversationScores([turn],async()=>{calls++;throw Error("indisponible");},async()=>{});
 assert.equal(calls,1);
 assert.equal(turn.scoreBackfillVersion,undefined);
 assert.equal(turn.assistantScores,undefined);
});
test("ne recalcule pas un tour déjà migré",async()=>{
 const turn={user:"Question",assistant:"Réponse",userScores:{I:1},assistantScores:{E:1},scoreBackfillVersion:1};
 let calls=0;
 const updated=await backfillConversationScores([turn],async()=>{calls++;return {};},async()=>{});
 assert.equal(calls,0);
 assert.deepEqual(updated,[]);
});

test("le radar d’une exécution cumule uniquement le contexte hérité et le préfixe de sa branche",()=>{
 const context=[{userScores:{I:1},assistantScores:{C:1}}];
 const runs=[
  {id:"r1",scores:{user:{I:0},assistant:{C:0}}},
  {id:"r2",scores:{user:{A:1},assistant:{R:1}}},
  {id:"r3",scores:{user:{E:1},assistant:{I:1}}}
 ];
 const radar=calculateExecutionRadar(context,runs,"r2");
 assert.equal(radar.observations,3);
 assert.deepEqual(radar.userAverage,{I:1/3,C:0,A:1/3,R:0,E:0});
 assert.deepEqual(radar.assistantAverage,{I:0,C:1/3,A:0,R:1/3,E:0});
});
test("un radar branché ne prend pas les scores d’une branche sœur",()=>{
 const branchRuns=[{id:"branch-run",scores:{user:{I:1},assistant:{I:1}}}];
 const sibling={id:"sibling-run",branchId:"sibling",scores:{user:{E:1},assistant:{E:1}}};
 const radar=calculateExecutionRadar([],branchRuns,"branch-run");
 assert.equal(radar.userAverage.E,0);
 assert.equal(radar.assistantAverage.E,0);
 assert.equal(radar.observations,1);
 assert.equal(sibling.branchId,"sibling");
});
