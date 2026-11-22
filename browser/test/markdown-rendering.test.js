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
      "<p class=\"note\"><strong>HTML documentaire autorisé</strong></p>",
      "<img src=\"x\" onerror=\"window.__xss = true\">",
      "<svg onload=\"window.__xss = true\"><script>alert(1)</script></svg>",
      "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
      "<form><input name=\"x\"></form>",
      "<a href=\"javascript:alert(1)\">Lien dangereux</a>",
      "<a href=\"https://example.org\">Lien sûr</a>"
    ].join("\n");
    host.append(renderMarkdown(source));
    await new Promise(resolve => setTimeout(resolve, 1200));
    return {
      html: host.innerHTML,
      xss: window.__xss === true,
      scripts: host.querySelectorAll("script,iframe,form,svg script,foreignObject").length,
      dangerousHref: [...host.querySelectorAll("a")].some(a => /^javascript:/i.test(a.getAttribute("href") || "")),
      eventAttributes: [...host.querySelectorAll("*")].some(el => [...el.attributes].some(attr => /^on/i.test(attr.name))),
      taskBoxes: host.querySelectorAll('input[type="checkbox"][disabled]').length,
      checkedBoxes: host.querySelectorAll('input[type="checkbox"]:checked').length,
      table: host.querySelectorAll(".markdown-table-wrap table").length,
      footnotes: host.querySelectorAll(".footnotes li").length,
      highlighted: host.querySelectorAll("pre code .hljs-keyword, pre code .hljs-number").length,
      mermaid: host.querySelectorAll(".mermaid-diagram svg").length,
      unsafeSvg: host.querySelectorAll(".mermaid-diagram script,.mermaid-diagram foreignObject,.mermaid-diagram iframe").length +
        [...host.querySelectorAll(".mermaid-diagram *")].filter(el => [...el.attributes].some(attr => /^on/i.test(attr.name))).length,
      remoteImages: host.querySelectorAll("img").length,
      rawHtml: host.querySelector("p.note strong")?.textContent || "",
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
  assert.equal(result.footnotes, 1, "les notes de bas de page doivent être rendues");
  assert.ok(result.highlighted > 0, "les blocs de code doivent être colorisés");
  assert.equal(result.mermaid, 1, "le bloc Mermaid doit être transformé en SVG");
  assert.equal(result.unsafeSvg, 0, "le SVG généré par Mermaid ne doit contenir ni foreignObject, script, iframe ni gestionnaire d’événement");
  assert.equal(result.remoteImages, 0, "les images distantes doivent être bloquées pour éviter le pistage par requête réseau");
  assert.equal(result.rawHtml, "HTML documentaire autorisé", "un sous-ensemble HTML documentaire doit rester disponible");
  assert.equal(result.safeLink, true, "les liens HTTPS doivent rester accessibles sans opener");
  console.log("Markdown rendering/security tests passed.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
