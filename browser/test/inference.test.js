import test from "node:test";
import assert from "node:assert/strict";
import { chatCompletionsEndpoint, chatCompletion, audioTranscriptionsEndpoint, transcribeAudio, audioBufferToWav, listModels, resolveInferenceRoute } from "../inference.js";
test("normalise les endpoints OpenAI compatibles",()=>{assert.equal(chatCompletionsEndpoint("https://api.example/v1"),"https://api.example/v1/chat/completions");assert.equal(chatCompletionsEndpoint("https://api.example"),"https://api.example/v1/chat/completions");assert.equal(chatCompletionsEndpoint("https://api.example/v1/chat/completions"),"https://api.example/v1/chat/completions");});
test("refuse une URL vide",()=>assert.throws(()=>chatCompletionsEndpoint("  "),/adresse de l.?API/i));
test("envoie le modèle, les messages et le bearer token",async()=>{let captured;const answer=await chatCompletion({baseUrl:"https://api.example/v1",model:"model-x",apiKey:"secret",messages:[{role:"user",content:"bonjour"}],fetchImpl:async(url,options)=>{captured={url,options};return{ok:true,json:async()=>({choices:[{message:{content:"Bonjour."}}]})};}});assert.equal(answer,"Bonjour.");assert.equal(captured.url,"https://api.example/v1/chat/completions");assert.equal(captured.options.headers.Authorization,"Bearer secret");assert.equal(JSON.parse(captured.options.body).model,"model-x");});
test("expose les erreurs HTTP du fournisseur",async()=>{await assert.rejects(()=>chatCompletion({baseUrl:"https://api.example/v1",model:"x",messages:[],fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:{message:"invalid key"}})})}),/401 : invalid key/);});

test("charge les identifiants de modèles du catalogue compatible",async()=>{const models=await listModels({baseUrl:"http://localhost:11434/v1",fetchImpl:async(url)=>{assert.equal(url,"http://localhost:11434/v1/models");return{ok:true,json:async()=>({data:[{id:"model-b"},{id:"model-a"}]})};}});assert.deepEqual(models,["model-a","model-b"]);});

test("normalise un endpoint collé avec /models",async()=>{const models=await listModels({baseUrl:"https://api.example/v1/models",fetchImpl:async url=>{assert.equal(url,"https://api.example/v1/models");return{ok:true,json:async()=>({data:[{id:"x"}]})};}});assert.deepEqual(models,["x"]);});
test("explique les erreurs réseau et CORS",async()=>{await assert.rejects(()=>chatCompletion({baseUrl:"http://localhost:11434/v1",model:"x",messages:[],fetchImpl:async()=>{throw new TypeError("Failed to fetch");}}),/CORS/);});
test("refuse les protocoles non HTTP",()=>assert.throws(()=>chatCompletionsEndpoint("file:///tmp/api"),/HTTP ou HTTPS/));

test("construit l’endpoint audio/transcriptions",()=>{assert.equal(audioTranscriptionsEndpoint("https://api.example/v1"),"https://api.example/v1/audio/transcriptions");assert.equal(audioTranscriptionsEndpoint("https://api.example/v1/audio/transcriptions"),"https://api.example/v1/audio/transcriptions");});
test("envoie un fichier audio et retourne le texte transcrit",async()=>{let captured;const blob=new Blob(["audio-bytes"],{type:"audio/webm"});const text=await transcribeAudio({baseUrl:"https://api.example/v1",model:"whisper-1",apiKey:"audio-secret",audioBlob:blob,filename:"dictation.webm",fetchImpl:async(url,options)=>{captured={url,options};return{ok:true,json:async()=>({text:"Bonjour ICARE."})};}});assert.equal(text,"Bonjour ICARE.");assert.equal(captured.url,"https://api.example/v1/audio/transcriptions");assert.equal(captured.options.headers.Authorization,"Bearer audio-secret");assert.equal(captured.options.body.get("model"),"whisper-1");assert.equal(captured.options.body.get("file").name,"dictation.webm");});
test("refuse une transcription sans modèle",async()=>{await assert.rejects(()=>transcribeAudio({baseUrl:"https://api.example/v1",model:"",audioBlob:new Blob(["x"])}),/modèle de transcription/i);});

test("filtre les modèles Lemonade avec le label transcription",async()=>{const models=await listModels({baseUrl:"http://127.0.0.1:13305/v1",label:"transcription",fetchImpl:async url=>{assert.equal(url,"http://127.0.0.1:13305/v1/models");return{ok:true,json:async()=>({data:[{id:"chat-model",labels:["chat"]},{id:"Whisper-Tiny",labels:["transcription","realtime-transcription"]},{id:"Whisper-Base",labels:["transcription"]}]})};}});assert.deepEqual(models,["Whisper-Base","Whisper-Tiny"]);});
test("encode un audio PCM mono en WAV 16 kHz",()=>{const samples=new Float32Array(480).fill(.25),audioBuffer={sampleRate:48000,length:samples.length,numberOfChannels:1,getChannelData:()=>samples};const wav=audioBufferToWav(audioBuffer);assert.equal(wav.type,"audio/wav");assert.equal(wav.size,44+160*2);return wav.arrayBuffer().then(bytes=>{const view=new DataView(bytes);assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint16(34,true),16);assert.equal(view.getUint32(40,true),320);});});

test("refuse HTTP pour les endpoints distants",()=>{assert.throws(()=>chatCompletionsEndpoint("http://inference.example/v1"),/HTTPS est obligatoire/);assert.throws(()=>audioTranscriptionsEndpoint("http://speech.example/v1"),/HTTPS est obligatoire/);});
test("refuse les identifiants dans une URL d’API",()=>assert.throws(()=>chatCompletionsEndpoint("https://user:password@api.example/v1"),/identifiants ne doivent pas être intégrés/));
test("autorise HTTP uniquement sur loopback, IPv4 et IPv6",()=>{assert.equal(chatCompletionsEndpoint("http://localhost:11434/v1"),"http://localhost:11434/v1/chat/completions");assert.equal(chatCompletionsEndpoint("http://127.0.0.1:13305/v1"),"http://127.0.0.1:13305/v1/chat/completions");assert.equal(chatCompletionsEndpoint("http://[::1]:11434/v1"),"http://[::1]:11434/v1/chat/completions");assert.throws(()=>chatCompletionsEndpoint("http://192.168.1.2:11434/v1"),/HTTPS est obligatoire/);});

test("route la transcription en local et le texte vers une Gateway",()=>{
 const audio=resolveInferenceRoute({kind:"audio",routing:{audio:"local",text:"gateway"},localSettings:{baseUrl:"http://127.0.0.1:13305/v1",model:"whisper",apiKey:"local-audio"},gateways:{text:"https://text.example.org"},gatewayModels:{text:"chat-model"}});
 const text=resolveInferenceRoute({kind:"text",routing:{audio:"local",text:"gateway"},localSettings:{baseUrl:"https://local.example/v1",model:"local-chat",apiKey:"secret"},gateways:{text:"https://text.example.org"},gatewayModels:{text:"chat-model"}});
 assert.deepEqual(audio,{baseUrl:"http://127.0.0.1:13305/v1",model:"whisper",apiKey:"local-audio",credentials:"omit",route:"local"});
 assert.deepEqual(text,{baseUrl:"https://text.example.org",model:"chat-model",apiKey:"",credentials:"include",route:"gateway"});
});
test("route la transcription vers une Gateway et le texte en local",()=>{
 const audio=resolveInferenceRoute({kind:"audio",routing:{audio:"gateway",text:"local"},localSettings:{baseUrl:"http://127.0.0.1:13305/v1",model:"whisper",apiKey:"local-audio"},gateways:{audio:"https://audio.example.org"},gatewayModels:{audio:"remote-whisper"}});
 const text=resolveInferenceRoute({kind:"text",routing:{audio:"gateway",text:"local"},localSettings:{baseUrl:"http://localhost:11434/v1",model:"local-chat",apiKey:"local-text"},gateways:{audio:"https://audio.example.org"},gatewayModels:{audio:"remote-whisper"}});
 assert.equal(audio.baseUrl,"https://audio.example.org");assert.equal(audio.model,"remote-whisper");assert.equal(audio.credentials,"include");assert.equal(audio.apiKey,"");
 assert.equal(text.baseUrl,"http://localhost:11434/v1");assert.equal(text.model,"local-chat");assert.equal(text.credentials,"omit");assert.equal(text.apiKey,"local-text");
});
test("partage une seule Gateway lorsque les deux fonctions sont routées à la même adresse",()=>{
 const options={routing:{audio:"gateway",text:"gateway"},gateways:{text:"https://shared.example.org",audio:"https://audio-other.example.org"},gatewayModels:{text:"chat",audio:"speech"},sameGateway:true};
 assert.equal(resolveInferenceRoute({...options,kind:"text"}).baseUrl,"https://shared.example.org");
 assert.equal(resolveInferenceRoute({...options,kind:"audio"}).baseUrl,"https://shared.example.org");
});
test("accepte deux Gateways distinctes pour audio et texte",()=>{
 const options={routing:{audio:"gateway",text:"gateway"},gateways:{text:"https://text.example.org",audio:"https://audio.example.org"},gatewayModels:{text:"chat",audio:"speech"},sameGateway:false};
 assert.equal(resolveInferenceRoute({...options,kind:"text"}).baseUrl,"https://text.example.org");
 assert.equal(resolveInferenceRoute({...options,kind:"audio"}).baseUrl,"https://audio.example.org");
});
test("refuse les gateways HTTP et exige une adresse pour chaque route distante",()=>{
 assert.throws(()=>resolveInferenceRoute({kind:"text",routing:{text:"gateway"},gateways:{text:"http://gateway.example.org"}}),/HTTPS/);
 assert.throws(()=>resolveInferenceRoute({kind:"audio",routing:{audio:"gateway"},gateways:{}}),/adresse du gateway/);
});

test("refuse les identifiants intégrés à l’URL d’une Gateway",()=>assert.throws(()=>resolveInferenceRoute({kind:"text",routing:{text:"gateway"},gateways:{text:"https://user:secret@gateway.example.org"}}),/identifiants/));
