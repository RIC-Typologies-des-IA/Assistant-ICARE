import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".md":"text/markdown; charset=utf-8"};
const server=createServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);if(pathname==="/")pathname="/index.html";const file=resolve(root,"."+pathname);if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}const body=await readFile(file);res.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream"}).end(body);}catch{res.writeHead(404).end("Not found");}});
await new Promise(resolveListen=>server.listen(0,"127.0.0.1",resolveListen));
const address=server.address(),url="http://127.0.0.1:"+address.port+"/";
let browser,chatPayloads=[];
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({serviceWorkers:"block"});
  const page=await context.newPage();
  page.on("dialog",dialog=>dialog.accept());
  await page.addInitScript(()=>{const original=window.fetch;window.__icareFetchCalls=[];window.fetch=(input,init={})=>{window.__icareFetchCalls.push({url:String(input),credentials:init.credentials||"same-origin",authorization:new Headers(init.headers||{}).get("Authorization"),body:typeof init.body==="string"?init.body:""});return original(input,init);};});
  await page.route("https://mock-provider.example/**",route=>{assert.equal(route.request().headers()["authorization"],"Bearer test-secret","la clé doit être disponible en mémoire de session");const requestBody=route.request().postDataJSON();if(Array.isArray(requestBody?.messages))chatPayloads.push(requestBody);const body=route.request().url().endsWith("/models")?{data:[{id:"test-model"}]}:{choices:[{message:{content:["Réponse locale de test.","","# Niveau 1","","## Niveau 2","","### Votre avis","","#### Auto-évaluation","", "#### Points d’attention / tensions éventuelles","","##### Niveau 5","","###### Niveau 6","","####Titre sans espace","","**Texte en gras**.","","| Étape | Ce qui a été réalisé | Conformité aux principes ICARE & maïeutiques |","|-------|----------------------|----------------------------------------------|","| **1. Capture de l’intention (I)** | - Vous avez exprimé votre **but** : fournir des connaissances. | ✅ Reformulation pour vérification ; ✅ distinction claire. |","| **2. Confirmation de l’intention** | Vous avez confirmé la reformulation (« Oui »). | ✅ Attente d’un accord avant de passer à la suite. |","| **3. Passage à la dimension suivante (C)** | J’ai présenté les cinq axes possibles du **Contexte**. | ✅ Question unique, ouverte. |","","### Synthèse de la dimension I","","| Champ | Valeur |","|-------|--------|","| **id** | `proj-foret-I-001` |","| **text** | *Instruire les politiques publiques de la forêt.* |","","> undefined","","<img src=x onerror=alert(1)>","[lien dangereux](javascript:alert(1))"].join("\n")}}]};return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});});
  let gatewayRequests=[];
  let gatewayConfigPayload={service:"icare-enterprise-gateway",capabilities:{chat:true,transcription:true,scoring:true},defaults:{chatModel:"enterprise-chat",transcriptionModel:"enterprise-audio"}};
  let gatewayConfigStatus=200;
  await page.route("https://gateway.example.org/**",async route=>{
    const request=route.request(),url=new URL(request.url());
    const headers=request.headers();
    assert.equal(headers.authorization,undefined,"aucune clé fournisseur ne doit être envoyée au gateway");
    const payload=request.postDataJSON?.();
    gatewayRequests.push({url:request.url(),payload,authorization:headers.authorization});
    if(url.pathname.endsWith("/icare/config")&&gatewayConfigStatus!==200)return route.fulfill({status:gatewayConfigStatus,contentType:"application/json",body:JSON.stringify({error:"Configuration indisponible"})});
    const body=url.pathname.endsWith("/icare/config")
      ?gatewayConfigPayload
      :url.pathname.endsWith("/icare/scoring")
        ?{scores:{I:0.81,C:0.72,A:0.63,R:0.54,E:0.45}}
        :url.pathname.endsWith("/models")
          ?{data:[{id:"enterprise-chat"},{id:"enterprise-audio"}]}
          :{choices:[{message:{content:"Réponse entreprise de test."}}]};
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto(url);

  await page.waitForFunction(()=>document.querySelector("#project-select").options.length===1);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector(".workspace")).display==="grid");
  assert.ok((await page.locator(".project-heading").evaluate(el=>getComputedStyle(el).gridArea)).includes("heading"),"l’en-tête projet doit occuper sa propre zone de grille");
  assert.ok((await page.locator(".chat-panel").evaluate(el=>getComputedStyle(el).gridArea)).includes("chat"),"le dialogue doit occuper la zone principale");
  assert.ok((await page.locator(".insights").evaluate(el=>getComputedStyle(el).gridArea)).includes("insights"),"les panneaux d’exploration doivent rester dans leur colonne dédiée");
  const desktopGeometry=await page.evaluate(()=>{const chat=document.querySelector(".chat-panel").getBoundingClientRect(),insights=document.querySelector(".insights").getBoundingClientRect();return {chat:{left:Math.round(chat.left),right:Math.round(chat.right),top:Math.round(chat.top)},insights:{left:Math.round(insights.left),right:Math.round(insights.right),top:Math.round(insights.top)}};});
  assert.ok(desktopGeometry.chat.left<desktopGeometry.insights.left,"le dialogue doit être à gauche des panneaux d’exploration : "+JSON.stringify(desktopGeometry));
  assert.ok(Math.abs(desktopGeometry.chat.top-desktopGeometry.insights.top)<8,"le dialogue et l’exploration doivent commencer sur la même ligne : "+JSON.stringify(desktopGeometry));
  assert.equal(await page.locator(".sidebar").evaluate(el=>Math.round(el.getBoundingClientRect().width)),await page.locator("html").evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue("--project-rail-width"))),"la largeur réelle du rail doit suivre la largeur de référence CSS");
  assert.equal(await page.locator("#project-menu-toggle").evaluate(el=>el.closest(".sidebar")!==null),true,"le hamburger doit être placé dans le rail tout à gauche");
  const railGeometry=await page.evaluate(()=>{const rail=document.querySelector(".sidebar").getBoundingClientRect(),chat=document.querySelector(".chat-panel").getBoundingClientRect();return {railRight:Math.round(rail.right),chatLeft:Math.round(chat.left),railTop:Math.round(rail.top),chatTop:Math.round(chat.top)}});
  assert.ok(railGeometry.railRight<railGeometry.chatLeft,"le rail doit être à gauche du dialogue avec un espace : "+JSON.stringify(railGeometry));
  assert.ok(railGeometry.chatTop>railGeometry.railTop,"le rail doit commencer sous la bannière avec une marge");
  assert.equal(await page.locator("#project-import-button svg").count(),1,"l’import doit être représenté par une icône accessible");
  assert.equal(await page.locator("#new-project").textContent(),"＋","la création d’un projet doit rester accessible par le bouton plus");
  assert.equal(await page.locator(".sidebar .project-list").evaluate(el=>getComputedStyle(el).display),"none","la liste et ses actions doivent être masquées volet fermé");
  await page.setViewportSize({width:900,height:900});
  assert.ok(await page.locator(".insights").evaluate(el=>el.getBoundingClientRect().top>document.querySelector(".chat-panel").getBoundingClientRect().top),"sur tablette, les panneaux doivent passer sous le dialogue");
  await page.setViewportSize({width:1440,height:1000});

  await page.waitForFunction(()=>document.querySelectorAll("#radar-labels text").length===5);
  assert.equal(await page.locator("#radar").count(),1,"le radar ICARE doit être présent");
  assert.deepEqual(await page.locator("#radar-labels text").allTextContents(),["Intention","Contexte","Action","Régulation","Évolution"],"le radar doit afficher les noms complets des cinq dimensions");
  assert.equal(await page.locator("#dimensions").count(),0,"la rangée de dimensions au-dessus du dialogue ne doit plus être affichée");
  assert.equal(await page.locator(".brand-affiliation a").count(),1,"le lien institutionnel doit rester dans la ligne d’affiliation");
  assert.equal(await page.locator(".brand-affiliation").evaluate(el=>el.parentElement.classList.contains("brand-copy")),true,"l’affiliation doit partager le même conteneur que le titre et le sous-titre");
  const headerLayout=await page.locator(".brand").evaluate(el=>({display:getComputedStyle(el).display,copyDisplay:getComputedStyle(el.querySelector(".brand-copy")).display,affiliationLeft:Math.round(el.querySelector(".brand-affiliation").getBoundingClientRect().left),copyLeft:Math.round(el.querySelector(".brand-copy").getBoundingClientRect().left)}));
  assert.equal(headerLayout.display,"flex","la bannière doit utiliser une structure flex stable, sans grille à colonnes implicites");
  assert.equal(headerLayout.copyDisplay,"flex","les trois lignes de texte doivent former une seule pile verticale");
  assert.ok(Math.abs(headerLayout.affiliationLeft-headerLayout.copyLeft)<=2,"la ligne d’affiliation doit rester alignée sous ICARE, sans être repoussée à droite");
  await page.goto(url+"?utm_source=chatgpt.com");
  assert.equal(new URL(page.url()).searchParams.has("utm_source"),false,"les paramètres de suivi ajoutés aux liens doivent être neutralisés sans recharger l’application");
  await page.waitForFunction(()=>document.querySelector(".brand-affiliation a"));

  assert.equal(await page.locator("#dimension-statuses .dimension-status-row").count(),5,"les cinq statuts doivent être éditables");
  assert.equal(await page.locator("#project-title").textContent(),"Mon premier projet");
  await page.locator("#settings-button").click();
  assert.equal(await page.locator("#settings-tab-direct").getAttribute("aria-selected"),"true","l’onglet Accès direct doit être sélectionné par défaut");
  assert.equal(await page.locator("#settings-panel-direct").isVisible(),true,"le panneau Accès direct doit être visible");
  assert.equal(await page.locator("#settings-panel-gateway").isVisible(),false,"le panneau Gateway doit être masqué tant qu’il n’est pas sélectionné");
  assert.equal(await page.locator("#route-llm").count(),1,"un seul sélecteur de routage LLM doit exister");
  assert.equal(await page.locator("#text-route").count(),0,"l’ancien sélecteur de routage ne doit plus exister");
  await page.locator("#close-settings-dialog").click();
  assert.equal(await page.locator("#settings-dialog").evaluate(dialog=>dialog.open),false,"la boîte de dialogue doit toujours pouvoir être fermée sans modèle renseigné");
  await page.locator("#settings-button").click();
  await page.locator("#api-base").fill("https://mock-provider.example/v1");
  await page.locator("#api-model").fill("test-model");
  await page.locator("#api-key").fill("test-secret");
  await page.locator("#transcription-base").fill("https://mock-provider.example/v1");
  await page.locator("#transcription-model").fill("test-audio-model");
  await page.locator("#transcription-key").fill("test-secret");
  await page.locator("#direct-scoring-key").fill("scoring-secret");
  assert.equal(await page.locator("#local-text-config").isVisible(),true,"la configuration directe du LLM doit être visible dans son onglet");
  assert.equal(await page.locator("#local-audio-config").isVisible(),true,"la configuration directe de la transcription doit être visible dans son onglet");
  assert.equal(await page.locator("#direct-scoring-url").isVisible(),true,"l’URL du scoring direct doit être visible dans son onglet");
  await page.locator("#load-models").click();
  await page.waitForFunction(()=>document.querySelectorAll("#available-models option").length===1);
  assert.equal(await page.locator("#load-transcription-models").count(),1,"la recherche de modèles audio doit être présente dans l’onglet direct");
  assert.equal(await page.locator("#test-transcription").count(),1,"le test du moteur audio doit être présent dans l’onglet direct");
  await page.locator("#test-provider").click();
  await page.waitForFunction(()=>document.querySelector("#provider-status").textContent.includes("Réponse locale de test"));
  await page.locator("#save-inference-config").click();
  await page.locator("#settings-dialog").waitFor({state:"hidden"});
  await page.locator("#message-input").fill("Bonjour ICARE");
  await page.locator("#composer").evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>[...document.querySelectorAll(".message.assistant p")].some(p=>p.textContent==="Réponse locale de test."));
  for (const [level,title] of [[1,"Niveau 1"],[2,"Niveau 2"],[3,"Votre avis"],[4,"Auto-évaluation"],[5,"Niveau 5"],[6,"Niveau 6"]]) {
    assert.equal(await page.locator(".message.assistant h"+level).first().textContent(),title,"le titre Markdown de niveau "+level+" doit être rendu sans dièses visibles");
  }
  assert.equal(await page.locator(".message.assistant h4").nth(1).textContent(),"Points d’attention / tensions éventuelles","le titre français exact signalé doit être rendu sans dièses visibles");
  assert.equal(await page.locator(".message.assistant h4").nth(2).textContent(),"Titre sans espace","un titre sans espace après les dièses doit être toléré");
  assert.equal(await page.locator(".message.assistant strong").first().textContent(),"Texte en gras","le gras Markdown doit être rendu sans astérisques");
  const table=page.locator(".message.assistant table").first();
  assert.equal(await table.locator("thead th").count(),3,"le tableau Markdown doit avoir trois colonnes");
  assert.equal(await table.locator("tbody tr").count(),3,"les trois lignes du tableau doivent être rendues");
  assert.equal(await table.locator("tbody tr").nth(0).locator("td").nth(0).textContent(),"1. Capture de l’intention (I)","le contenu Markdown des cellules doit être interprété");
  assert.equal(await table.locator("tbody tr").nth(1).locator("td").nth(0).textContent(),"2. Confirmation de l’intention","la deuxième ligne doit rester dans le tableau");
  assert.equal(await table.locator("tbody tr").nth(2).locator("td").nth(0).textContent(),"3. Passage à la dimension suivante (C)","la troisième ligne doit rester dans le tableau");
  assert.equal(await table.locator("tbody tr").nth(0).locator("td strong").nth(1).textContent(),"but","le gras doit être rendu à l’intérieur d’une cellule");
  const summaryTable=page.locator(".message.assistant table").nth(1);
  assert.equal(await summaryTable.locator("thead th").count(),2,"le tableau Champ/Valeur doit être rendu en deux colonnes");
  assert.equal(await summaryTable.locator("tbody tr").count(),2,"les deux champs du tableau doivent être conservés");
  assert.equal(await summaryTable.locator("tbody tr").nth(0).locator("td code").textContent(),"proj-foret-I-001","le code inline doit être interprété dans une cellule");
  assert.equal(await summaryTable.locator("tbody tr").nth(1).locator("td em").textContent(),"Instruire les politiques publiques de la forêt.","l’italique doit être interprété dans une cellule");
  assert.equal((await page.locator(".message.assistant blockquote").last().textContent()).trim(),"undefined","les citations Markdown doivent être rendues");
  assert.equal(await page.locator(".message.assistant img").count(),0,"le HTML brut fourni par le modèle ne doit pas devenir un élément actif");
  assert.equal(await page.locator('.message.assistant a[href^="javascript:"]').count(),0,"les URL javascript doivent être neutralisées");
  const systemMessage=chatPayloads.map(payload=>payload.messages.find(message=>message.role==="system")?.content||"").join("\n");
  assert.ok(systemMessage.includes("Comprendre la démarche ICARE"),"le guide méthodologique doit être transmis au modèle local");
  assert.ok(systemMessage.includes('"state_time"'),"l’ontologie structurée doit être transmise au modèle local");
  assert.ok(systemMessage.includes("ÉTAT ACTUEL DU TABLEAU ICARE"),"l’état du projet doit être transmis au modèle local");
  assert.ok(systemMessage.includes('"I": "unexplored"'),"les statuts des dimensions doivent être présents dans le contexte");
  assert.ok(systemMessage.includes("utilise réellement les outils pour enregistrer les observations substantielles"),"les capacités d’action agentique doivent être transmises au modèle local");
  await page.waitForFunction(()=>Number(document.querySelector("#timeline-slider").max)>=1);
  await page.locator("#timeline-slider").evaluate(slider=>{slider.value="0";slider.dispatchEvent(new Event("input",{bubbles:true}));});
  assert.equal(await page.locator(".message.user").count(),0,"le premier instantané doit rejouer le dialogue avant le premier échange");
  await page.locator("#timeline-slider").evaluate(slider=>{slider.value=slider.max;slider.dispatchEvent(new Event("input",{bubbles:true}));});
  assert.equal(await page.locator(".message.user p").first().textContent(),"Bonjour ICARE","le dernier instantané doit réafficher l’échange complet");
  const readPersistedTurns=()=>new Promise((resolve,reject)=>{const request=indexedDB.open("icare-browser");request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction("turns","readonly"),read=tx.objectStore("turns").getAll();read.onsuccess=()=>{const turns=read.result;db.close();resolve(turns);};read.onerror=()=>reject(read.error);};});
  await page.waitForFunction(async()=>{const request=indexedDB.open("icare-browser");return await new Promise(resolve=>{request.onerror=()=>resolve(false);request.onsuccess=()=>{const db=request.result,tx=db.transaction("turns","readonly"),read=tx.objectStore("turns").getAll();read.onsuccess=()=>{const found=read.result.some(turn=>turn.user==="Bonjour ICARE"&&turn.assistant.startsWith("Réponse locale de test."));db.close();resolve(found);};read.onerror=()=>{db.close();resolve(false);};};});});
  const persistedTurns=await page.evaluate(readPersistedTurns);
  assert.ok(persistedTurns.some(turn=>turn.user==="Bonjour ICARE"&&turn.assistant.startsWith("Réponse locale de test.")),"le dialogue doit être effectivement persisté dans IndexedDB : "+JSON.stringify(persistedTurns));
  await page.locator("#proposal-text").fill("Le système doit conserver son identité visuelle.");
  await page.locator("#proposal-form").evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>document.querySelectorAll("#proposal-list .proposal-item").length===1);
  await page.locator("#proposal-list .accept").click();
  await page.waitForFunction(()=>document.querySelector("#proposal-list").textContent.includes("Validée"));
  await page.locator("#project-menu-toggle").click();
  await page.locator("#new-project").click();
  await page.locator("#project-name").fill("Projet navigateur");
  await page.locator("#project-intention").fill("Vérifier la persistance locale");
  await page.locator("#save-project").click();
  await page.locator("#project-dialog").waitFor({state:"hidden"});
  await page.waitForFunction(()=>document.querySelector("#project-title").textContent==="Projet navigateur");
  assert.equal(await page.locator("#project-select option").count(),2,"la création doit ajouter un deuxième projet");
  await page.waitForFunction(()=>!document.body.classList.contains("project-menu-open")&&document.querySelector(".sidebar").getBoundingClientRect().width<=45,null,{timeout:1500});
  const hamburgerClosed=await page.locator("#project-menu-toggle").boundingBox();
  const railClosedWidth=await page.locator(".sidebar").evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(await page.locator(".sidebar-toolbar-actions").evaluate(el=>getComputedStyle(el).display==="none"),"volet fermé, seul le hamburger doit rester visible");
  assert.ok(await page.locator(".sidebar").evaluate(el=>el.getBoundingClientRect().height<=42),"volet fermé, aucun bandeau vertical ne doit subsister");
  await page.locator("#project-menu-toggle").click();
  assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("project-menu-open")),true,"le bouton hamburger doit ouvrir le volet projets");
  const hamburgerOpen=await page.locator("#project-menu-toggle").boundingBox();
  assert.ok(Math.abs(hamburgerOpen.x-hamburgerClosed.x)<0.5 && Math.abs(hamburgerOpen.y-hamburgerClosed.y)<0.5,"le hamburger doit rester exactement à la même position quand le volet se déploie");
  assert.equal(await page.locator("#project-title").evaluate(el=>el.closest(".workspace")!==null),true,"le nom du projet actif doit rester au-dessus de la conversation");
  assert.equal(await page.locator("#project-import-button").evaluate(el=>el.closest(".sidebar-toolbar")!==null),true,"Importer doit être dans la barre supérieure du volet");
  assert.equal(await page.locator("#new-project").evaluate(el=>el.closest(".sidebar-toolbar")!==null),true,"Nouveau projet doit être au même niveau qu’Importer");
  assert.equal(await page.locator("#project-list .project-row").count(),2,"les deux projets doivent être visibles dans la liste");
  await page.locator("#project-list .project-row").filter({has:page.locator(".project-row-name",{hasText:"Mon premier projet"})}).locator(".project-row-name").click();
  await page.waitForFunction(()=>document.querySelector("#project-title").textContent==="Mon premier projet");
  assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("project-menu-open")),true,"sélectionner un projet ne doit pas fermer le volet");
  await page.locator("#project-list .project-row").filter({has:page.locator(".project-row-name",{hasText:"Projet navigateur"})}).locator(".project-row-name").click();
  await page.waitForFunction(()=>document.querySelector("#project-title").textContent==="Projet navigateur");
  assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("project-menu-open")),true,"changer à nouveau de projet doit conserver le volet ouvert");
  assert.ok(await page.locator("#project-list .project-row-action svg").count()>=4,"les actions Renommer et Télécharger doivent être de vraies icônes");
  const panelMetrics=await page.locator(".sidebar").evaluate(el=>({height:el.getBoundingClientRect().height,scrollHeight:el.scrollHeight,children:[...el.children].map(child=>({className:child.className,height:child.getBoundingClientRect().height,display:getComputedStyle(child).display,margin:getComputedStyle(child).margin,padding:getComputedStyle(child).padding}))}));
  const panelHeight=panelMetrics.height;
  assert.ok(panelHeight<180,"le panneau ouvert doit épouser la liste de deux projets sans hauteur artificielle");
  for(const row of await page.locator("#project-list .project-row").all()){assert.equal(await row.locator(".project-row-name").count(),1,"chaque projet doit avoir son nom");assert.equal(await row.locator("[aria-label^=\"Renommer \"]").count(),1,"chaque projet doit avoir sa propre commande Renommer");assert.equal(await row.locator("[aria-label^=\"Télécharger \"]").count(),1,"chaque projet doit avoir sa propre commande Télécharger");}
  await page.locator("#project-list .project-row").filter({has:page.locator(".project-row-name",{hasText:"Projet navigateur"})}).locator("[aria-label^=\"Renommer \"]").click();
  await page.locator("#project-name").fill("Projet navigateur renommé");
  await page.locator("#save-project").click();
  await page.locator("#project-dialog").waitFor({state:"hidden"});
  assert.equal(await page.locator("#project-title").textContent(),"Projet navigateur renommé","le renommage depuis la ligne du projet doit actualiser le titre principal");
  // Le renommage ferme volontairement le volet ; le rouvrir avant de mesurer sa géométrie.
  await page.locator("#project-menu-toggle").click();
  await page.waitForFunction(()=>document.body.classList.contains("project-menu-open"));
  await page.waitForFunction(closedWidth=>document.querySelector(".sidebar").getBoundingClientRect().width>closedWidth+100,railClosedWidth,{timeout:1000});
  const expandedGeometry=await page.evaluate(()=>{const rail=document.querySelector(".sidebar").getBoundingClientRect(),chat=document.querySelector(".chat-panel").getBoundingClientRect();return {railWidth:rail.width,railRight:rail.right,chatLeft:chat.left}});
  assert.ok(expandedGeometry.railWidth>railClosedWidth+100,"le volet doit réellement s’élargir à l’ouverture : "+JSON.stringify(expandedGeometry));
  assert.ok(expandedGeometry.railRight<expandedGeometry.chatLeft,"le volet élargi ne doit pas se superposer au dialogue : "+JSON.stringify(expandedGeometry));
  await page.locator("#project-menu-toggle").click();
  assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("project-menu-open")),false,"le hamburger doit replier le volet en conservant le rail");
  const hamburgerClosedAgain=await page.locator("#project-menu-toggle").boundingBox();
  assert.ok(Math.abs(hamburgerClosedAgain.x-hamburgerClosed.x)<0.5 && Math.abs(hamburgerClosedAgain.y-hamburgerClosed.y)<0.5,"le hamburger doit retrouver exactement la même position après fermeture du volet");
  await page.waitForFunction(()=>{
    const rail=document.querySelector(".sidebar");
    const expected=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--project-rail-width"));
    return !document.body.classList.contains("project-menu-open") && Math.abs(rail.getBoundingClientRect().width-expected)<1;
  });
  const railBox=await page.locator(".sidebar").boundingBox();
  const layoutBox=await page.locator(".layout").boundingBox();
  const workspaceBox=await page.locator(".workspace").boundingBox();
  assert.equal(Math.round(layoutBox.x),0,"la grille principale doit commencer au bord gauche de la fenêtre");
  assert.equal(Math.round(railBox.x),0,"le rail Projets doit être collé au bord gauche de la fenêtre");
  assert.ok(Math.abs(workspaceBox.x-(railBox.x+railBox.width+8))<=1,"le dialogue doit commencer juste après le rail avec un espace de 8 px : "+JSON.stringify({railBox,workspaceBox}));
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>{
    const rail=document.querySelector(".sidebar");
    const expected=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--project-rail-width"));
    return Math.abs(rail.getBoundingClientRect().width-expected)<1;
  });
  const mobileRailWidth=await page.locator(".sidebar").evaluate(el=>({actual:el.getBoundingClientRect().width,expected:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--project-rail-width"))}));
  assert.equal(mobileRailWidth.expected,38,"sur mobile, la variable CSS doit définir un rail compact de 38 px");
  assert.ok(Math.abs(mobileRailWidth.actual-mobileRailWidth.expected)<=1,"la largeur extérieure du rail mobile doit suivre sa référence CSS : "+JSON.stringify(mobileRailWidth));
  assert.equal(await page.locator(".layout").evaluate(el=>Math.round(el.getBoundingClientRect().left)),0,"sur mobile aussi, la grille doit rester plaquée au bord gauche");
  await page.setViewportSize({width:1440,height:1000});
  await page.locator("#project-menu-toggle").click();
  await page.locator("#new-project").click();
  await page.locator("#project-name").fill("Projet à annuler");
  await page.locator("#cancel-project").click();
  assert.equal(await page.locator("#project-title").textContent(),"Projet navigateur renommé","Annuler ne doit ni enregistrer ni changer de projet");
  assert.equal(await page.locator("#project-select option").count(),2,"Annuler ne doit pas créer de projet");
  const otherProjectDownload=page.waitForEvent("download");
  await page.locator("#project-list .project-row").filter({has:page.locator(".project-row-name",{hasText:"Mon premier projet"})}).locator("[aria-label^=\"Télécharger \"]").click();
  const otherProjectBackup=JSON.parse(await readFile(await (await otherProjectDownload).path(),"utf8"));
  assert.equal(otherProjectBackup.project.name,"Mon premier projet","le téléchargement doit viser le projet de la ligne cliquée et non le projet actif");
  assert.ok(otherProjectBackup.turns.length>0,"l’export du projet non actif doit contenir son propre historique");
  const downloadPromise=page.waitForEvent("download");
  await page.locator("#project-list .project-row").filter({has:page.locator(".project-row-name", {hasText:"Projet navigateur renommé"})}).locator("[aria-label^=\"Télécharger \"]").click();
  const backupDownload=await downloadPromise,backupPath=await backupDownload.path();
  const backup=JSON.parse(await readFile(backupPath,"utf8"));
  assert.equal(backup.format,"icare-project-export","l'export doit être limité au format de sauvegarde d'un projet");
  assert.equal(backup.project.name,"Projet navigateur renommé","l'export doit contenir le projet actif");
  assert.equal(backup.turns.length,0,"les échanges d'un autre projet ne doivent pas être exportés");
  await page.locator("#project-import-file").setInputFiles(backupPath);
  await page.waitForFunction(()=>document.querySelector("#project-select").options.length===3);
  assert.equal(await page.locator("#project-title").textContent(),"Projet navigateur renommé","l'import doit ouvrir le projet nouvellement importé");


  await page.emulateMedia({colorScheme:"dark"});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
  assert.equal(await page.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(16, 24, 39)","le fond de page doit réellement devenir sombre");
  assert.equal(await page.locator(".chat-panel").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(27, 41, 59)","le panneau de dialogue doit réellement devenir sombre");
  assert.equal(await page.locator("#theme-toggle").evaluate(el=>getComputedStyle(el).width),"34px","le sélecteur de thème doit rester une petite icône");
  assert.ok(await page.locator("#settings-button").evaluate(el=>el.nextElementSibling?.id==="theme-toggle"),"l’icône de thème doit être immédiatement à droite de Configuration");

  // La configuration Gateway doit rester lisible et cohérente en mode sombre.
  await page.locator("#settings-button").click();
  await page.locator("#settings-tab-gateway").click();
  const darkGatewayPalette=await page.evaluate(()=>({
    tabs:getComputedStyle(document.querySelector("#settings-dialog .settings-tabs")).backgroundColor,
    card:getComputedStyle(document.querySelector("#gateway-card-1")).backgroundColor,
    field:getComputedStyle(document.querySelector("#gateway-1-url")).backgroundColor,
    fieldText:getComputedStyle(document.querySelector("#gateway-1-url")).color,
    route:getComputedStyle(document.querySelector("#route-llm").closest(".route-choice")).backgroundColor,
    routeSelect:getComputedStyle(document.querySelector("#route-llm")).backgroundColor
  }));
  assert.equal(darkGatewayPalette.tabs,"rgb(17, 30, 48)","les onglets Gateway doivent adopter la palette sombre");
  assert.equal(darkGatewayPalette.card,"rgb(29, 45, 66)","les cartes Gateway ne doivent plus rester blanches");
  assert.equal(darkGatewayPalette.field,"rgb(16, 30, 48)","les champs Gateway doivent avoir un fond sombre");
  assert.equal(darkGatewayPalette.fieldText,"rgb(240, 245, 252)","le texte saisi dans les champs Gateway doit rester très lisible");
  assert.equal(darkGatewayPalette.route,"rgb(29, 45, 66)","les lignes de routage doivent être cohérentes avec les cartes");
  assert.equal(darkGatewayPalette.routeSelect,"rgb(16, 30, 48)","les listes de routage doivent être sombres");
  await page.locator("#settings-tab-direct").click();
  await page.locator("#close-settings-dialog").click();
  await page.locator("#theme-toggle").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"),"light","le bouton doit permettre de choisir le thème clair");
  assert.equal(await page.evaluate(()=>localStorage.getItem("icare-theme")),"light","le choix manuel doit être enregistré");
  await page.emulateMedia({colorScheme:"dark"});
  assert.equal(await page.locator("html").getAttribute("data-theme"),"light","le choix manuel doit primer sur les changements de préférence système");



  // Les onglets isolent totalement l’accès direct et le paramétrage Gateway.
  await page.locator("#settings-button").click();
  assert.equal(await page.locator("#settings-tab-direct").getAttribute("aria-selected"),"true");
  assert.equal(await page.locator("#settings-panel-direct").isVisible(),true);
  await page.locator("#settings-tab-gateway").click();
  assert.equal(await page.locator("#settings-tab-gateway").getAttribute("aria-selected"),"true");
  assert.equal(await page.locator("#settings-panel-gateway").isVisible(),true);
  assert.equal(await page.locator("#settings-panel-direct").isVisible(),false);
  for(let id=1;id<=3;id++)assert.equal(await page.locator("#gateway-card-"+id).isVisible(),true,"les trois Gateway doivent toujours rester visibles");
  for(const service of ["llm","audio","scoring"]){
    assert.equal(await page.locator("#gateway-1-"+service).isChecked(),true,"Gateway 1 doit prendre en charge "+service+" par défaut");
    assert.equal(await page.locator("#gateway-2-"+service).isVisible(),false,service+" doit disparaître de Gateway 2 tant qu’elle est affectée à Gateway 1");
    assert.equal(await page.locator("#gateway-3-"+service).isVisible(),false,service+" doit disparaître de Gateway 3 tant qu’elle est affectée à Gateway 1");
  }
  await page.locator("#gateway-1-url").fill("https://gateway.example.org/one");
  await page.locator("#gateway-2-url").fill("https://gateway.example.org/two");
  await page.locator("#gateway-3-url").fill("https://gateway.example.org/three");

  // LLM : transfert vers Gateway 2, puis retour vers Gateway 1.
  await page.locator("#gateway-1-llm").uncheck();
  assert.equal(await page.locator("#gateway-2-llm").isVisible(),true,"LLM doit redevenir disponible dans Gateway 2 après décochage");
  assert.equal(await page.locator("#gateway-3-llm").isVisible(),true,"LLM doit redevenir disponible dans Gateway 3 après décochage");
  await page.locator("#gateway-2-llm").check();
  assert.equal(await page.locator("#gateway-1-llm").isVisible(),false,"LLM doit disparaître de Gateway 1 après affectation à Gateway 2");
  assert.equal(await page.locator("#gateway-3-llm").isVisible(),false,"LLM doit disparaître de Gateway 3 après affectation à Gateway 2");
  assert.equal(await page.locator("#route-llm").inputValue(),"gateway-2","l’affectation LLM doit définir automatiquement sa route unique");
  await page.locator("#gateway-2-llm").uncheck();
  await page.locator("#gateway-1-llm").check();
  assert.equal(await page.locator("#route-llm").inputValue(),"gateway-1","le déplacement du LLM doit mettre à jour sa route unique");

  // Transcription : une seule Gateway disponible à la fois.
  await page.locator("#gateway-1-audio").uncheck();
  assert.equal(await page.locator("#gateway-2-audio").isVisible(),true,"la transcription doit apparaître dans Gateway 2 après libération");
  assert.equal(await page.locator("#gateway-3-audio").isVisible(),true,"la transcription doit apparaître dans Gateway 3 après libération");
  await page.locator("#gateway-2-audio").check();
  assert.equal(await page.locator("#gateway-1-audio").isVisible(),false,"la transcription doit disparaître de Gateway 1");
  assert.equal(await page.locator("#gateway-3-audio").isVisible(),false,"la transcription doit disparaître de Gateway 3");
  assert.equal(await page.locator("#route-audio").inputValue(),"gateway-2","la route de transcription doit être unique");

  // Scoring : affectation à Gateway 3, sans doublon dans les deux autres.
  await page.locator("#gateway-1-scoring").uncheck();
  assert.equal(await page.locator("#gateway-2-scoring").isVisible(),true,"le scoring doit apparaître dans Gateway 2 après libération");
  assert.equal(await page.locator("#gateway-3-scoring").isVisible(),true,"le scoring doit apparaître dans Gateway 3 après libération");
  await page.locator("#gateway-3-scoring").check();
  assert.equal(await page.locator("#gateway-1-scoring").isVisible(),false,"le scoring doit disparaître de Gateway 1");
  assert.equal(await page.locator("#gateway-2-scoring").isVisible(),false,"le scoring doit disparaître de Gateway 2");
  assert.equal(await page.locator("#route-scoring").inputValue(),"gateway-3","la route de scoring doit être unique");

  assert.deepEqual(await page.locator("#route-llm").inputValue(),"gateway-1");
  assert.equal(await page.locator("#route-audio").inputValue(),"gateway-2");
  assert.equal(await page.locator("#route-scoring").inputValue(),"gateway-3");
  await page.locator("#save-gateway-matrix").click();
  await page.waitForFunction(()=>document.querySelector("#gateway-matrix-status").textContent.includes("Routage Gateway enregistré"));
  await page.locator("#settings-dialog").waitFor({state:"hidden"});
  assert.ok(gatewayRequests.some(request=>request.url.endsWith("/one/v1/icare/config")),"la configuration Gateway 1 doit être interrogée pour le modèle LLM");
  assert.ok(gatewayRequests.some(request=>request.url.endsWith("/two/v1/icare/config")),"la configuration Gateway 2 doit être interrogée pour le modèle audio");
  assert.ok(gatewayRequests.some(request=>request.url.endsWith("/three/v1/icare/config")),"la configuration Gateway 3 doit être interrogée pour vérifier sa capacité de scoring");
  await page.locator("#message-input").fill("Bonjour gateway texte");
  await page.locator("#composer").evaluate(form=>form.requestSubmit());
  await page.waitForTimeout(1500);
  const gatewayChatDiagnostic=await page.evaluate(()=>({messages:document.querySelector("#messages")?.innerText||"",calls:window.__icareFetchCalls.filter(call=>call.url.includes("gateway.example.org")).map(call=>({url:call.url,credentials:call.credentials,body:call.body.slice(0,160)}))}));
  assert.ok(gatewayChatDiagnostic.messages.includes("Réponse entreprise de test."),"la réponse LLM via Gateway doit être rendue ; diagnostic : "+JSON.stringify(gatewayChatDiagnostic));
  const textGatewayCall=await page.evaluate(()=>window.__icareFetchCalls.find(call=>call.url.startsWith("https://gateway.example.org/one/")&&call.url.endsWith("/v1/chat/completions")&&JSON.parse(call.body||"{}").messages?.some(message=>message.content==="Bonjour gateway texte")));
  assert.equal(textGatewayCall?.credentials,"include","le texte envoyé à la Gateway sélectionnée doit utiliser la session SSO");
  assert.equal(textGatewayCall?.authorization,null,"aucune clé fournisseur ne doit être envoyée à la Gateway");
  const scoringGatewayCall=await page.evaluate(()=>window.__icareFetchCalls.find(call=>call.url==="https://gateway.example.org/three/v1/icare/scoring"));
  assert.equal(scoringGatewayCall?.credentials,"include","le scoring doit utiliser la Gateway explicitement sélectionnée");
  assert.equal(scoringGatewayCall?.authorization,null,"la clé de scoring direct ne doit jamais être transmise à une Gateway");
  await page.reload();
  await page.waitForFunction(()=>document.querySelector("#project-select").options.length>=1);
  await page.locator("#settings-button").click();
  assert.equal(await page.locator("#settings-tab-gateway").getAttribute("aria-selected"),"true","le dernier onglet choisi doit être mémorisé");
  assert.equal(await page.locator("#route-llm").inputValue(),"gateway-1","le routage LLM doit persister");
  assert.equal(await page.locator("#route-audio").inputValue(),"gateway-2","le routage audio doit persister indépendamment");
  assert.equal(await page.locator("#route-scoring").inputValue(),"gateway-3","le routage du scoring doit persister indépendamment");
  assert.equal(await page.locator("#gateway-1-url").inputValue(),"https://gateway.example.org/one");
  assert.equal(await page.locator("#gateway-2-url").inputValue(),"https://gateway.example.org/two");
  assert.equal(await page.locator("#gateway-3-url").inputValue(),"https://gateway.example.org/three");
  assert.equal(await page.locator("#gateway-card-2").isVisible(),true);
  assert.equal(await page.locator("#gateway-card-3").isVisible(),true);
  await page.locator("#settings-tab-direct").click();
  assert.equal(await page.locator("#settings-panel-direct").isVisible(),true);
  assert.equal(await page.locator("#settings-panel-gateway").isVisible(),false);
  assert.equal(await page.locator("#api-base").inputValue(),"https://mock-provider.example/v1","les paramètres directs doivent rester disponibles et distincts");
  assert.equal(await page.locator("#transcription-base").inputValue(),"https://mock-provider.example/v1");
  assert.equal(await page.locator("#direct-scoring-key").inputValue(),"scoring-secret","la clé du scoring direct doit persister dans le coffre chiffré");
  await page.locator("#settings-tab-gateway").click();
  await page.locator("#gateway-1-url").fill("http://gateway.example.org/insecure");
  await page.locator("#save-gateway-matrix").click();
  assert.match(await page.locator("#gateway-matrix-status").textContent(),/HTTPS/,"une Gateway distante en HTTP doit être refusée");
  assert.equal(await page.locator("#settings-dialog").evaluate(dialog=>dialog.open),true,"une URL non sécurisée doit laisser le dialogue ouvert");
  await page.locator("#settings-dialog").evaluate(dialog=>dialog.close());

  const autoContext=await browser.newContext({colorScheme:"light"});
  const autoPage=await autoContext.newPage();
  await autoPage.goto(url);
  await autoPage.waitForFunction(()=>document.querySelector("#project-select").options.length===1);
  assert.equal(await autoPage.locator("html").getAttribute("data-theme"),"light","le thème clair du navigateur doit être détecté");
  await autoPage.emulateMedia({colorScheme:"dark"});
  await autoPage.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
  await autoContext.close();

  const fallbackContext=await browser.newContext();
  await fallbackContext.addInitScript(()=>Object.defineProperty(window,"matchMedia",{value:undefined,configurable:true}));
  const fallbackPage=await fallbackContext.newPage();
  await fallbackPage.goto(url);
  await fallbackPage.waitForFunction(()=>document.querySelector("#project-select").options.length===1);
  assert.equal(await fallbackPage.locator("html").getAttribute("data-theme"),"light","en l'absence de détection système, le thème doit être clair");
  await fallbackContext.close();

  // Les validations HTTPS et la persistance des profils sont couvertes ci-dessus.
  await page.locator("#settings-dialog").evaluate(dialog=>{if(dialog.open)dialog.close();});

  console.log("Browser smoke test passed: independent audio/text routing, local and shared/distinct gateways, HTTPS validation, persistence, projects, import/export, timeline, Markdown, themes and layout.");

}finally{
  if(browser)await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
