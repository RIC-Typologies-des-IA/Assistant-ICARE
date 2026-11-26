import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("Not found"); }
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port + "/index.html");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("./markdown.js");
    const bodyChildrenBeforeHost = document.body.children.length;
    const host = document.createElement("div");
    host.className = "message-content mermaid-test-host";
    document.body.append(host);
    const source = [
      "# Titre",
      "",
      "Texte **gras**, *italique*, ~~barré~~ et `code`.",
      "",
      "- [x] Tâche terminée",
      "- [ ] Tâche à faire",
      "",
      "| Colonne | Valeur |",
      "|:--|--:|",
      "| A | 12 |",
      "",
      "Une note[^n1].",
      "",
      "[^n1]: Note de bas de page.",
      "",
      "```javascript",
      "const answer = 42;",
      "```",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[Départ] --> B[Arrivée]",
      "  B --> C[\"<img src=x onerror=alert(1)>\"]",
      "```",
      "",
      "```mermaid",
      "graph LR",
      "  A[Forêt de Meudon] --> B{Pressions}",
      "  B --> C[Urbanisation]",
      "  B --> D[Pollution]",
      "  A --> E[Services écosystémiques]",
      "  E --> F[Qualité de l’air]",
      "  E --> G[Récréation]",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      "  I[\"Intention (I)\"] --> C[\"Contexte (C)\"]",
      "  C --> A[\"Action (A)\"]",
      "  A --> R[\"Régulation (R)\"]",
      "  R --> E[\"Évolution (E)\"]",
      "  E --> I",
      "```",
      "",
      "",
      "```mermaid",
      "flowchart LR",
      "  X[Diagramme invalide] -->",
      "```",
      "",
      "```mermaid",
      "sequenceDiagram",
      "  Alice->>Bob: Bonjour Bob",
      "  Bob-->>Alice: Bonjour Alice",
      "```",
      "",
      "```mermaid",
      "classDiagram",
      "  class Animal {",
      "    +String name",
      "    +eat()",
      "  }",
      "  Animal <|-- Dog",
      "```",
      "",
      "```mermaid",
      "stateDiagram-v2",
      "  [*] --> Inactive",
      "  Inactive --> Active: start",
      "  Active --> [*]: stop",
      "```",
      "",
      "```mermaid",
      "gantt",
      "  title Plan de projet",
      "  dateFormat YYYY-MM-DD",
      "  section Conception",
      "  Analyse :a1, 2026-01-01, 3d",
      "  section Réalisation",
      "  Développement :a2, after a1, 4d",
      "```",
      "",
      "```mermaid",
      "pie showData",
      "  title Répartition",
      "  \"A\" : 40",
      "  \"B\" : 35",
      "  \"C\" : 25",
      "```",
      "",
      "```mermaid",
      "journey",
      "  title Parcours utilisateur",
      "  section Découverte",
      "    Arriver sur le site: 5: User",
      "    Comprendre l’offre: 4: User",
      "  section Utilisation",
      "    Créer un projet: 3: User",
      "```",
      "",
      "```mermaid",
      "requirementDiagram",
      "  requirement auth_req {",
      "    id: 1",
      "    text: Accès sécurisé",
      "    risk: high",
      "    verifymethod: test",
      "  }",
      "  element auth_module {",
      "    type: module",
      "  }",
      "  auth_module - satisfies -> auth_req",
      "```",
      "",
      "```mermaid",
      "gitGraph",
      "  commit",
      "  branch develop",
      "  commit",
      "  checkout main",
      "  commit",
      "  merge develop",
      "```",
      "",
      "```mermaid",
      "timeline",
      "  title Évolution du projet",
      "  2024 : Idée",
      "  2025 : Prototype",
      "  2026 : Déploiement",
      "```",
      "",
      "```mermaid",
      "erDiagram",
      "  CLIENT ||--o{ COMMANDE : passe",
      "  COMMANDE ||--|{ LIGNE : contient",
      "  CLIENT {",
      "    int id",
      "    string nom",
      "  }",
      "```",
      "",
      "```mermaid",
      "radar-beta",
      "  title Compétences",
      "  axis a[\"Analyse\"], c[\"Contexte\"], r[\"Régulation\"]",
      "  curve icare[\"ICARE\"]{4, 5, 3}",
      "  max 5",
      "```",
      "",
      "```mermaid",
      "mindmap",
      "  root((ICARE))",
      "    Intention",
      "    Contexte",
      "    Action",
      "    Régulation",
      "    Évolution",
      "```",
      "",
      "```mermaid",
      "sankey-beta",
      "  Source A, Cible A, 10",
      "  Source A, Cible B, 5",
      "  Source B, Cible B, 7",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Style personnalisé] --> B[Style secondaire]",
      "  classDef redStyle fill:#ff0000,stroke:#333333,stroke-width:2px",
      "  classDef greenStyle fill:#00aa00,stroke:#333333,stroke-width:2px",
      "  class A redStyle;",
      "  class B greenStyle;",
      "```",
      "",
      "<p class=\"note\"><strong>HTML documentaire autorisé</strong></p>",
      "<img src=\"x\" onerror=\"window.__xss = true\">",
      "<svg onload=\"window.__xss = true\"><script>alert(1)</script></svg>",
      "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
      "<form><input name=\"x\"></form>",
      "<a href=\"javascript:alert(1)\">Lien dangereux</a>",
      "<a href=\"https://example.org\">Lien sûr</a>"
    ].join("\n");
    host.append(renderMarkdown(source));
    await new Promise(resolve => {
      const started = Date.now();
      const poll = () => {
        if (!host.querySelector(".mermaid-source") || Date.now() - started > 10000) resolve();
        else setTimeout(poll, 50);
      };
      poll();
    });
    const mindmapSvg = [...host.querySelectorAll(".mermaid-diagram svg")].find(svg => ["Intention","Contexte","Action","Régulation","Évolution"].every(label => svg.textContent.includes(label)));
    const mindmapShapeInfo = [...(mindmapSvg?.querySelectorAll("rect,circle,ellipse,path,polygon") || [])].slice(0,30).map(node => ({
      tag: node.tagName, className: node.getAttribute("class"), fill: node.getAttribute("fill"),
      style: node.getAttribute("style"), computedFill: getComputedStyle(node).fill
    }));
    const lightSnapshot = {
      html: host.innerHTML,
      xss: window.__xss === true,
      scripts: host.querySelectorAll("script,iframe,form,svg script,foreignObject").length,
      dangerousHref: [...host.querySelectorAll("a")].some(a => /^javascript:/i.test(a.getAttribute("href") || "")),
      eventAttributes: [...host.querySelectorAll("*")].some(el => [...el.attributes].some(attr => /^on/i.test(attr.name))),
      taskBoxes: host.querySelectorAll('input[type="checkbox"][disabled]').length,
      checkedBoxes: host.querySelectorAll('input[type="checkbox"]:checked').length,
      table: host.querySelectorAll(".markdown-table-wrap table").length,
      alignedCells: host.querySelectorAll("th.align-left,td.align-left,th.align-right,td.align-right").length,
      footnotes: host.querySelectorAll(".footnotes li").length,
      highlighted: host.querySelectorAll("pre code .hljs-keyword, pre code .hljs-number").length,
      mermaid: host.querySelectorAll(".mermaid-diagram svg").length,
      mermaidErrors: host.querySelectorAll(".mermaid-error").length,
      bodyChildrenAfterMermaidError: document.body.children.length,
      bodyChildrenBeforeHost,
      mermaidNodeClasses: host.querySelectorAll(".mermaid-diagram svg .node").length,
      pieSlices: host.querySelectorAll(".mermaid-diagram .pieCircle, .mermaid-diagram .slice").length,
      pieColors: [...host.querySelectorAll(".mermaid-diagram .pieCircle")].map(node => getComputedStyle(node).fill).filter(Boolean),
      mindmapShapeInfo,
      unsafeSvg: host.querySelectorAll(".mermaid-diagram script,.mermaid-diagram foreignObject,.mermaid-diagram iframe").length +
        [...host.querySelectorAll(".mermaid-diagram *")].filter(el => [...el.attributes].some(attr => /^on/i.test(attr.name))).length,
      remoteImages: host.querySelectorAll("img").length,
      rawHtml: [...host.querySelectorAll("p")].find(p => p.textContent.includes("HTML documentaire autorisé"))?.querySelector("strong")?.textContent || "",
      safeLink: [...host.querySelectorAll("a")].some(a => a.href === "https://example.org/" && a.rel.includes("noopener"))
    };
    document.documentElement.dataset.theme = "dark";
    window.dispatchEvent(new CustomEvent("icare-theme-change", { detail: { theme: "dark" } }));
    await new Promise(resolve => {
      const started = Date.now();
      const poll = () => {
        if (!host.querySelector(".mermaid-source") && host.querySelectorAll(".mermaid-diagram svg").length === 17) resolve();
        else if (Date.now() - started > 10000) resolve();
        else setTimeout(poll, 50);
      };
      poll();
    });
    const darkSvgs = [...host.querySelectorAll(".mermaid-diagram svg")];
    const darkTexts = darkSvgs.flatMap(svg => [...svg.querySelectorAll("text,tspan")]);
    const darkTextLabels = darkTexts.filter(node => (node.textContent || "").trim());
    const darkTextFillCount = darkTextLabels.filter(node => {
      let current = node;
      while (current && current !== host) {
        const style = current.getAttribute("style") || "";
        const attrFill = current.getAttribute("fill") || "";
        if (attrFill && !/^(?:none|transparent)$/i.test(attrFill)) return true;
        if (/(?:^|;)\s*fill\s*:\s*(?!none(?:;|$)|transparent(?:;|$))/i.test(style)) return true;
        current = current.parentElement;
      }
      return false;
    }).length;
    const darkPieColors = [...host.querySelectorAll(".mermaid-diagram .pieCircle")].map(node => getComputedStyle(node).fill);
    const customStyleSvg = darkSvgs.find(svg => svg.textContent.includes("Style personnalisé") && svg.textContent.includes("Style secondaire"));
    const customNodeFill = label => {
      const node = [...(customStyleSvg?.querySelectorAll(".node") || [])].find(item => item.textContent.includes(label));
      if (!node) return "";
      const fragments = [];
      let current = node;
      while (current && current !== customStyleSvg) {
        fragments.push(current.getAttribute("style") || "", current.getAttribute("fill") || "");
        current = current.parentElement;
      }
      for (const shape of node.querySelectorAll("rect,polygon,path")) fragments.push(shape.getAttribute("style") || "", shape.getAttribute("fill") || "");
      return fragments.filter(Boolean).join(" | ");
    };
    const darkCustomStyleFills = [customNodeFill("Style personnalisé"), customNodeFill("Style secondaire")];
    const darkMindmap = darkSvgs.find(svg => ["Intention","Contexte","Action","Régulation","Évolution"].every(label => svg.textContent.includes(label)));
    const darkMindmapColors = [...(darkMindmap?.querySelectorAll("rect,circle,ellipse,path,polygon") || [])]
      .map(node => getComputedStyle(node).fill).filter(fill => fill && fill !== "none" && fill !== "rgba(0, 0, 0, 0)");
    const familyText = darkSvgs.map(svg => svg.textContent || "");
    const familyChecks = {
      flowchart: familyText.some(text => text.includes("Départ") && text.includes("Arrivée")),
      sequence: familyText.some(text => text.includes("Bonjour Bob")),
      classDiagram: familyText.some(text => text.includes("Animal")),
      stateDiagram: familyText.some(text => text.includes("Inactive")),
      gantt: familyText.some(text => text.includes("Développement")),
      pie: familyText.some(text => text.includes("Répartition")),
      journey: familyText.some(text => text.includes("Parcours utilisateur")),
      requirement: familyText.some(text => text.includes("Accès sécurisé")),
      gitGraph: familyText.some(text => text.includes("main")),
      timeline: familyText.some(text => text.includes("Évolution du projet")),
      erDiagram: familyText.some(text => text.includes("CLIENT")),
      radar: familyText.some(text => text.includes("Compétences")),
      mindmap: familyText.some(text => text.includes("Intention")),
      sankey: familyText.some(text => text.includes("Source A"))
    };
    document.documentElement.dataset.theme = "light";
    window.dispatchEvent(new CustomEvent("icare-theme-change", { detail: { theme: "light" } }));
    await new Promise(resolve => {
      const started = Date.now();
      const poll = () => {
        if (!host.querySelector(".mermaid-source") && host.querySelectorAll(".mermaid-diagram svg").length === 17) resolve();
        else if (Date.now() - started > 10000) resolve();
        else setTimeout(poll, 50);
      };
      poll();
    });
    return {
      ...lightSnapshot,
      darkDiagramCount: darkSvgs.length,
      darkTextCount: darkTexts.length,
      darkTextLabelCount: darkTextLabels.length,
      darkTextFillCount,
      darkTextFills: [...new Set(darkTexts.map(node => getComputedStyle(node).fill).filter(fill => fill && fill !== "none"))],
 
      darkPieColors,
      darkCustomStyleFills,
 
      darkMindmapColors,
      familyChecks,
      lightRestoredCount: host.querySelectorAll(".mermaid-diagram svg").length
    };
  });
  assert.equal(result.xss, false, "aucun gestionnaire d’événement ne doit être exécuté");
  assert.equal(result.scripts, 0, "scripts, iframes, formulaires et SVG arbitraire doivent être absents");
  assert.equal(result.dangerousHref, false, "les URI javascript doivent être supprimées");
  assert.equal(result.eventAttributes, false, "aucun attribut on* ne doit survivre");
  assert.equal(result.taskBoxes, 2, "les cases de task-list doivent être rendues désactivées");
  assert.equal(result.checkedBoxes, 1, "l’état coché doit être préservé");
  assert.equal(result.table, 1, "les tableaux doivent être enveloppés pour le défilement");
  assert.ok(result.alignedCells >= 2, "l’alignement des colonnes doit survivre à la sanitisation sans style inline");
  assert.equal(result.footnotes, 1, "les notes de bas de page doivent être rendues");
  assert.ok(result.highlighted > 0, "les blocs de code doivent être colorisés");
  assert.equal(result.mermaid, 17, "toutes les familles Mermaid prises en charge doivent produire un SVG, même lorsqu’un diagramme voisin est invalide");
  assert.equal(result.mermaidErrors, 1, "un diagramme invalide doit afficher sa propre erreur sans bloquer les diagrammes suivants");
  assert.equal(result.bodyChildrenAfterMermaidError, result.bodyChildrenBeforeHost + 1, "Mermaid ne doit pas injecter son icône SVG d'erreur globale hors du conteneur Markdown");
  assert.ok(result.mermaidNodeClasses > 0, "les classes SVG Mermaid doivent être conservées pour appliquer le thème accessible");
  assert.ok(result.pieSlices >= 3, "le diagramme circulaire doit conserver ses secteurs colorés");
  assert.ok(new Set(result.pieColors).size >= 3 && result.pieColors.every(fill => !/^#?000(?:000)?$/i.test(fill)), "les secteurs du diagramme circulaire doivent conserver des couleurs distinctes");
  assert.ok(new Set(result.mindmapShapeInfo.map(shape => shape.computedFill).filter(fill => fill && fill !== "none" && fill !== "rgba(0, 0, 0, 0)")).size >= 2, "la carte mentale doit conserver plusieurs couleurs natives ; formes observées : " + JSON.stringify(result.mindmapShapeInfo));
  assert.equal(result.unsafeSvg, 0, "le SVG généré par Mermaid ne doit contenir ni foreignObject, script, iframe ni gestionnaire d’événement");
  assert.equal(result.remoteImages, 0, "les images distantes doivent être bloquées pour éviter le pistage par requête réseau");
  assert.equal(result.rawHtml, "HTML documentaire autorisé", "un sous-ensemble HTML documentaire doit rester disponible");
  assert.equal(result.safeLink, true, "les liens HTTPS doivent rester accessibles sans opener");
  assert.equal(result.darkDiagramCount, 17, "les 16 diagrammes doivent être rerendus au changement de thème");
  assert.ok(result.darkTextCount > 0, "les libellés SVG doivent rester présents en mode sombre");
  assert.ok(result.darkTextLabelCount > 0 && result.darkTextFillCount >= Math.ceil(result.darkTextLabelCount * 0.8), "au moins 80 % des libellés SVG doivent porter une couleur explicite ou héritée en mode sombre");
  assert.ok(new Set(result.darkPieColors).size >= 3, "la palette du diagramme circulaire doit rester différenciée en mode sombre");
  assert.equal(result.darkCustomStyleFills.length, 2, "le diagramme Mermaid personnalisé doit être conservé en mode sombre");
  assert.ok(/fill:\s*(?:#ff0000|rgb\(255,\s*0,\s*0\))/i.test(result.darkCustomStyleFills[0]), "la couleur rouge explicitement définie doit être conservée : " + JSON.stringify(result.darkCustomStyleFills));
  assert.ok(/fill:\s*(?:#00aa00|rgb\(0,\s*170,\s*0\))/i.test(result.darkCustomStyleFills[1]), "la couleur verte explicitement définie doit être conservée");
  assert.ok(new Set(result.darkMindmapColors).size >= 2, "la palette de la carte mentale doit rester différenciée en mode sombre");
  assert.ok(Object.entries(result.familyChecks).every(([, passed]) => passed), "chaque famille de diagrammes doit conserver ses libellés : " + JSON.stringify(result.familyChecks));
  assert.equal(result.lightRestoredCount, 17, "le retour au mode clair doit rerendre les 17 diagrammes");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const host = document.querySelector(".mermaid-test-host");
    const wrapper = host?.querySelector(".mermaid-diagram");
    const svg = wrapper?.querySelector("svg");
    if (!host || !wrapper || !svg) return null;
    const hostRect = host.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    return {
      hostWidth: hostRect.width,
      wrapperRight: wrapperRect.right,
      hostRight: hostRect.right,
      wrapperOverflow: getComputedStyle(wrapper).overflowX,
      svgMaxWidth: getComputedStyle(svg).maxWidth
    };
  });
  assert.ok(mobileLayout, "un diagramme doit rester présent sur mobile");
  assert.ok(mobileLayout.wrapperRight <= mobileLayout.hostRight + 1, "le conteneur Mermaid ne doit pas déborder horizontalement sur mobile");
  assert.equal(mobileLayout.wrapperOverflow, "auto", "un diagramme large doit rester défilable horizontalement sur mobile");
  assert.equal(mobileLayout.svgMaxWidth, "100%", "le SVG doit s'adapter à la largeur disponible");
  console.log("Markdown rendering/security tests passed.");

} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
