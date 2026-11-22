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
  await page.addInitScript(()=>{const original=window.fetch;window.__icareFetchCalls=[];window.fetch=(input,init={})=>{window.__icareFetchCalls.push({url:String(input),credentials:init.credentials||"same-origin",authorization:new Headers(init.headers||{}).get("Authorization")});return original(input,init);};});
  await page.route("https://mock-provider.example/**",route=>{assert.equal(route.request().headers()["authorization"],"Bearer test-secret","la clé doit être disponible en mémoire de session");const requestBody=route.request().postDataJSON();if(Array.isArray(requestBody?.messages))chatPayloads.push(requestBody);const body=route.request().url().endsWith("/models")?{data:[{id:"test-model"}]}:{choices:[{message:{content:["Réponse locale de test.","","# Niveau 1","","## Niveau 2","","### Votre avis","","#### Auto-évaluation","", "#### Points d’attention / tensions éventuelles","","##### Niveau 5","","###### Niveau 6","","####Titre sans espace","","**Texte en gras**.","","| Étape | Ce qui a été réalisé | Conformité aux principes ICARE & maïeutiques |","|-------|----------------------|----------------------------------------------|","| **1. Capture de l’intention (I)** | - Vous avez exprimé votre **but** : fournir des connaissances. | ✅ Reformulation pour vérification ; ✅ distinction claire. |","| **2. Confirmation de l’intention** | Vous avez confirmé la reformulation (« Oui »). | ✅ Attente d’un accord avant de passer à la suite. |","| **3. Passage à la dimension suivante (C)** | J’ai présenté les cinq axes possibles du **Contexte**. | ✅ Question unique, ouverte. |","","### Synthèse de la dimension I","","| Champ | Valeur |","|-------|--------|","| **id** | `proj-foret-I-001` |","| **text** | *Instruire les politiques publiques de la forêt.* |","","> undefined","","<img src=x onerror=alert(1)>","[lien dangereux](javascript:alert(1))"].join("\n")}}]};return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});});
  let gatewayRequests=[];
  let gatewayConfigPayload={service:"icare-enterprise-gateway",defaults:{chatModel:"enterprise-chat",transcriptionModel:"enterprise-audio"}};
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
  assert.equal(await page.locator("#project-export-button svg path").count(),1,"l’export doit utiliser une flèche pleine et un réceptacle SVG");
  assert.equal(await page.locator("#project-import-button svg path").count(),1,"l’import doit utiliser une flèche pleine et un réceptacle SVG");
  assert.ok((await page.locator("#project-export-button svg path").getAttribute("d")).includes("M11 2"),"l’export doit avoir une flèche orientée vers le bas");
  assert.ok((await page.locator("#project-import-button svg path").getAttribute("d")).includes("M11 16V6.83"),"l’import doit avoir une flèche orientée vers le haut");
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
  assert.equal(await page.locator("#settings-tab-standalone").getAttribute("aria-selected"),"true","le mode autonome doit être sélectionné par défaut");
  await page.locator("#close-settings-dialog").click();
  assert.equal(await page.locator("#settings-dialog").evaluate(dialog=>dialog.open),false,"la boîte de dialogue doit toujours pouvoir être fermée sans modèle renseigné");
  await page.locator("#settings-button").click();
  await page.locator("#settings-tab-enterprise").click();
  assert.equal(await page.locator("#settings-panel-enterprise").isVisible(),true,"l’onglet entreprise doit afficher uniquement son formulaire");
  assert.equal(await page.locator("#settings-panel-standalone").isVisible(),false,"le formulaire autonome doit être masqué en mode entreprise");
  await page.locator("#enterprise-gateway-url").fill("https://gateway.example.org");
  assert.equal(await page.locator("#api-model").evaluate(el=>el.required),false,"les modèles ne sont pas requis en mode entreprise");
  await page.locator("#settings-tab-standalone").click();
  assert.equal(await page.locator("#settings-panel-standalone").isVisible(),true,"le mode autonome doit rester accessible par son onglet");
  assert.equal(await page.locator("#api-key").evaluate(el=>el.parentElement.hidden),false,"le mode autonome doit afficher sa configuration directe");
  await page.locator("#api-base").fill("https://mock-provider.example/v1");
  await page.locator("#api-model").fill("test-model");
  await page.locator("#api-key").fill("test-secret");
  await page.locator("#load-models").click();
  await page.waitForFunction(()=>document.querySelectorAll("#available-models option").length===1);
  await page.locator("#test-provider").click();
  await page.waitForFunction(()=>document.querySelector("#provider-status").textContent.includes("Réponse locale de test"));
  await page.locator("#save-enterprise-config").click();
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
  await page.locator("#project-menu-toggle").click();
  assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("project-menu-open")),true,"le bouton hamburger doit ouvrir le volet projets");
  assert.equal(await page.locator(".sidebar").evaluate(el=>Math.round(el.getBoundingClientRect().width)),250,"le rail doit s’élargir sans se superposer au dialogue");
  await page.locator("#project-menu-toggle").click();
  assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("project-menu-open")),false,"le hamburger doit replier le volet en conservant le rail");
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
  assert.equal(await page.locator("#project-title").textContent(),"Projet navigateur","Annuler ne doit ni enregistrer ni changer de projet");
  assert.equal(await page.locator("#project-select option").count(),2,"Annuler ne doit pas créer de projet");
  const downloadPromise=page.waitForEvent("download");
  await page.locator("#project-export-button").click();
  await page.locator("#export-author").fill("Martin");
  await page.locator("#confirm-export").click();
  const backupDownload=await downloadPromise,backupPath=await backupDownload.path();
  const backup=JSON.parse(await readFile(backupPath,"utf8"));
  assert.equal(backup.format,"icare-project-export","l'export doit être limité au format de sauvegarde d'un projet");
  assert.equal(backup.project.name,"Projet navigateur","l'export doit contenir le projet actif");
  assert.equal(backup.project.provenance.author,"Martin","le pseudo doit être conservé comme provenance");
  assert.equal(backup.turns.length,0,"les échanges d'un autre projet ne doivent pas être exportés");
  await page.locator("#project-import-file").setInputFiles(backupPath);
  await page.waitForFunction(()=>document.querySelector("#project-select").options.length===3);
  assert.equal(await page.locator("#project-title").textContent(),"Projet navigateur","l'import doit ouvrir le projet nouvellement importé");


  await page.emulateMedia({colorScheme:"dark"});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
  assert.equal(await page.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(16, 24, 39)","le fond de page doit réellement devenir sombre");
  assert.equal(await page.locator(".chat-panel").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(27, 41, 59)","le panneau de dialogue doit réellement devenir sombre");
  assert.equal(await page.locator("#theme-toggle").evaluate(el=>getComputedStyle(el).width),"34px","le sélecteur de thème doit rester une petite icône");
  assert.ok(await page.locator("#settings-button").evaluate(el=>el.nextElementSibling?.id==="theme-toggle"),"l’icône de thème doit être immédiatement à droite de Configuration");
  await page.locator("#theme-toggle").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"),"light","le bouton doit permettre de choisir le thème clair");
  assert.equal(await page.evaluate(()=>localStorage.getItem("icare-theme")),"light","le choix manuel doit être enregistré");
  await page.emulateMedia({colorScheme:"dark"});
  assert.equal(await page.locator("html").getAttribute("data-theme"),"light","le choix manuel doit primer sur les changements de préférence système");



  // Vérifie le parcours réel du client entreprise : découverte des valeurs par défaut,
  // appels sans secret fournisseur, persistance puis restauration après rechargement.
  await page.locator("#settings-button").click();
  await page.locator("#settings-tab-enterprise").click();
  await page.locator("#enterprise-gateway-url").fill("https://gateway.example.org");
  await page.locator("#save-enterprise-config").click();
  await page.locator("#settings-dialog").waitFor({state:"hidden"});
  assert.ok(gatewayRequests.some(request=>request.url.endsWith("/v1/icare/config")),"le client doit demander les modèles par défaut au gateway");
  await page.locator("#message-input").fill("Bonjour entreprise");
  await page.locator("#composer").evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>[...document.querySelectorAll(".message.assistant p")].some(p=>p.textContent==="Réponse entreprise de test."));
  const enterprisePayload=gatewayRequests.find(request=>request.url.endsWith("/v1/chat/completions"))?.payload;
  assert.ok(enterprisePayload?.messages?.some(message=>message.role==="user"&&message.content==="Bonjour entreprise"),"le dialogue doit réellement être routé vers le gateway");
  const enterpriseChatRequest=gatewayRequests.find(request=>request.url.endsWith("/v1/chat/completions"));
  assert.equal(enterpriseChatRequest?.authorization,undefined,"aucune clé API fournisseur ne doit être envoyée au gateway");
  const browserGatewayFetch=await page.evaluate(()=>window.__icareFetchCalls.find(call=>call.url.endsWith("/v1/chat/completions")));
  assert.equal(browserGatewayFetch?.credentials,"include","les appels entreprise doivent transmettre les cookies de session SSO");
  await page.reload();
  await page.waitForFunction(()=>document.querySelector("#project-select").options.length>=1);
  await page.waitForFunction(()=>document.querySelector("#enterprise-gateway-url").value==="https://gateway.example.org");
  await page.locator("#settings-button").click();
  assert.equal(await page.locator("#enterprise-gateway-url").inputValue(),"https://gateway.example.org","le mode entreprise doit être conservé après rechargement");
  assert.equal(await page.locator("#settings-panel-enterprise").isVisible(),true,"le mode entreprise doit être restauré après rechargement");
  assert.equal(await page.locator("#api-model").inputValue(),"enterprise-chat","le modèle par défaut attribué par le gateway doit être persisté");
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

  // La configuration entreprise doit valider le protocole, résoudre les deux modèles
  // et ne jamais rendre les champs fournisseur obligatoires ou actifs.
  await page.locator("#settings-button").click();
  assert.equal(await page.locator("#api-base").evaluate(el=>el.required),false,"l’URL fournisseur ne doit pas être obligatoire en mode entreprise");
  assert.equal(await page.locator("#api-model").evaluate(el=>el.required),false,"le modèle texte ne doit pas être obligatoire en mode entreprise");
  assert.equal(await page.locator("#transcription-model").inputValue(),"enterprise-audio","le modèle audio par défaut doit être restauré après rechargement");
  assert.equal(await page.locator("#settings-panel-standalone").isVisible(),false,"aucun champ de modèle autonome ne doit être visible en mode entreprise");
  await page.locator("#enterprise-gateway-url").fill("http://gateway.example.org");
  await page.locator("#save-enterprise-config").click();
  assert.match(await page.locator("#enterprise-status").textContent(),/HTTPS valide/,"un gateway HTTP distant doit être refusé explicitement");
  assert.equal(await page.locator("#settings-dialog").evaluate(el=>el.open),true,"une URL de gateway invalide ne doit pas fermer la configuration");
  await page.locator("#enterprise-gateway-url").fill("https://gateway.example.org/v1");
  gatewayConfigPayload={service:"icare-enterprise-gateway",defaults:{transcriptionModel:"enterprise-audio"}};
  gatewayConfigPayload={service:"icare-enterprise-gateway",defaults:{}};
  await page.locator("#save-enterprise-config").click();
  assert.match(await page.locator("#enterprise-status").textContent(),/Aucun modèle de conversation/,"l’absence de modèle texte doit être signalée sans enregistrer une configuration inutilisable");
  assert.equal(await page.locator("#settings-dialog").evaluate(el=>el.open),true,"une configuration gateway incomplète doit rester corrigeable");
  gatewayConfigPayload={service:"icare-enterprise-gateway",defaults:{chatModel:"enterprise-chat-v2",transcriptionModel:"enterprise-audio-v2"}};
  await page.locator('#settings-form button[value="save"]').click();
  await page.locator("#settings-dialog").waitFor({state:"hidden"});
  await page.reload();
  await page.waitForFunction(()=>document.querySelector("#enterprise-gateway-url").value==="https://gateway.example.org/v1");
  await page.locator("#settings-button").click();
  assert.equal(await page.locator("#api-model").inputValue(),"enterprise-chat-v2","le modèle texte renvoyé par le gateway doit être persisté");
  assert.equal(await page.locator("#transcription-model").inputValue(),"enterprise-audio-v2","le modèle audio renvoyé par le gateway doit être persisté");
  assert.equal(await page.locator("#settings-panel-enterprise").isVisible(),true,"le panneau entreprise doit rester seul visible après rechargement");
  // Un autre gateway ne doit pas hériter des modèles du précédent.
  gatewayConfigPayload={service:"icare-enterprise-gateway",defaults:{chatModel:"tenant-chat",transcriptionModel:"tenant-audio"}};
  await page.locator("#enterprise-gateway-url").fill("https://gateway.example.org/tenant");
  await page.locator('#settings-form button[value="save"]').click();
  await page.locator("#settings-dialog").waitFor({state:"hidden"});
  await page.reload();
  await page.waitForFunction(()=>document.querySelector("#enterprise-gateway-url").value==="https://gateway.example.org/tenant");
  await page.locator("#settings-button").click();
  assert.equal(await page.locator("#api-model").inputValue(),"tenant-chat","un nouveau gateway doit fournir son propre modèle texte, sans reprendre l’ancien");
  assert.equal(await page.locator("#transcription-model").inputValue(),"tenant-audio","un nouveau gateway doit fournir son propre modèle audio, sans reprendre l’ancien");
  await page.locator("#settings-tab-standalone").click();
  assert.equal(await page.locator("#api-base").evaluate(el=>el.required),true,"le mode autonome doit réactiver la validation de l’endpoint texte");
  assert.equal(await page.locator("#api-model").evaluate(el=>el.required),true,"le mode autonome doit réactiver la validation du modèle texte");
  assert.equal(await page.locator("#settings-panel-standalone").isVisible(),true,"le mode autonome doit réafficher son formulaire complet");
  await page.locator("#settings-dialog").evaluate(dialog=>dialog.close());

  console.log("Browser smoke test passed: standalone and enterprise configuration, gateway validation, dual model defaults, SSO routing, persistence, projects, import/export, timeline, Markdown, themes and layout.");

}finally{
  if(browser)await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
