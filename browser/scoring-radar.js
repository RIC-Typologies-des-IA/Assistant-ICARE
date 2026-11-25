export const SCORE_DIMENSIONS=Object.freeze(["I","C","A","R","E"]);
export function normaliseScoreVector(value){const source=value&&typeof value==="object"?value:{};return Object.fromEntries(SCORE_DIMENSIONS.map(code=>{const number=Number(source[code]);return [code,Number.isFinite(number)?Math.max(0,Math.min(1,number)):0];}));}
export function calculateScoreRadar(turns=[]){const history=Array.isArray(turns)?turns:[],latestTurn=history.at(-1)||{};const userScores=history.map(turn=>normaliseScoreVector(turn.userScores??turn.scores)),assistantScores=history.map(turn=>normaliseScoreVector(turn.assistantScores));const average=scores=>Object.fromEntries(SCORE_DIMENSIONS.map(code=>[code,scores.length?scores.reduce((sum,score)=>sum+score[code],0)/scores.length:0]));return {userLatest:normaliseScoreVector(latestTurn.userScores??latestTurn.scores),assistantLatest:normaliseScoreVector(latestTurn.assistantScores),userAverage:average(userScores),assistantAverage:average(assistantScores),observations:history.length};}

export async function backfillConversationScores(turns,scoreText,persist,version=1){
 const updated=[];
 for(const turn of Array.isArray(turns)?turns:[]){
  if(Number(turn.scoreBackfillVersion)>=version)continue;
  let userScores=turn.userScores??turn.scores??null,assistantScores=turn.assistantScores??null,complete=true;
  if(!userScores){try{userScores=await scoreText("user",turn.user||"");}catch{complete=false;}}
  if(!assistantScores){try{assistantScores=await scoreText("assistant",turn.assistant||"");}catch{complete=false;}}
  if(!userScores||!assistantScores)complete=false;
  let changed=false;
  if(userScores){const normalized=normaliseScoreVector(userScores);if(!turn.userScores||!turn.scores){turn.userScores=normalized;turn.scores=normalized;changed=true;}}
  if(assistantScores){const normalized=normaliseScoreVector(assistantScores);if(!turn.assistantScores){turn.assistantScores=normalized;changed=true;}}
  if(complete){turn.scoreBackfillVersion=version;changed=true;}
  if(changed){await persist(turn);updated.push(turn);}
 }
 return updated;
}
