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
    const host = document.createElement("div");
    host.className = "message-content";
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
    return {
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
      mermaidNodeClasses: host.querySelectorAll(".mermaid-diagram svg .node").length,
      pieSlices: host.querySelectorAll(".mermaid-diagram .pieCircle, .mermaid-diagram .slice").length,
      pieColors: [...host.querySelectorAll(".mermaid-diagram .pieCircle")].map(node => getComputedStyle(node).fill).filter(Boolean),
      mindmapNodeColors: [...host.querySelectorAll(".mermaid-diagram .mindmap-node rect, .mermaid-diagram .mindmap-node circle, .mermaid-diagram .mindmap-node ellipse")].map(node => getComputedStyle(node).fill).filter(Boolean),
      unsafeSvg: host.querySelectorAll(".mermaid-diagram script,.mermaid-diagram foreignObject,.mermaid-diagram iframe").length +
        [...host.querySelectorAll(".mermaid-diagram *")].filter(el => [...el.attributes].some(attr => /^on/i.test(attr.name))).length,
      remoteImages: host.querySelectorAll("img").length,
      rawHtml: [...host.querySelectorAll("p")].find(p => p.textContent.includes("HTML documentaire autorisé"))?.querySelector("strong")?.textContent || "",
      safeLink: [...host.querySelectorAll("a")].some(a => a.href === "https://example.org/" && a.rel.includes("noopener"))
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
  assert.equal(result.mermaid, 16, "toutes les familles Mermaid prises en charge doivent produire un SVG, même lorsqu’un diagramme voisin est invalide");
  assert.equal(result.mermaidErrors, 1, "un diagramme invalide doit afficher sa propre erreur sans bloquer les diagrammes suivants");
  assert.ok(result.mermaidNodeClasses > 0, "les classes SVG Mermaid doivent être conservées pour appliquer le thème accessible");
  assert.ok(result.pieSlices >= 3, "le diagramme circulaire doit conserver ses secteurs colorés");
  assert.ok(new Set(result.pieColors).size >= 3 && result.pieColors.every(fill => !/^#?000(?:000)?$/i.test(fill)), "les secteurs du diagramme circulaire doivent conserver des couleurs distinctes");
  assert.ok(new Set(result.mindmapNodeColors).size >= 2, "les nœuds de la carte mentale doivent conserver la palette Mermaid multicolore");
  assert.equal(result.unsafeSvg, 0, "le SVG généré par Mermaid ne doit contenir ni foreignObject, script, iframe ni gestionnaire d’événement");
  assert.equal(result.remoteImages, 0, "les images distantes doivent être bloquées pour éviter le pistage par requête réseau");
  assert.equal(result.rawHtml, "HTML documentaire autorisé", "un sous-ensemble HTML documentaire doit rester disponible");
  assert.equal(result.safeLink, true, "les liens HTTPS doivent rester accessibles sans opener");
  console.log("Markdown rendering/security tests passed.");

} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
