import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "parse5";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const branchNavigation = await readFile(new URL("../branch-navigation.js", import.meta.url), "utf8");
function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

test("HTML has no parser errors, duplicate IDs, or dangling structural references", () => {
  const parseErrors = [];
  const document = parse(html, { onParseError: error => parseErrors.push(error) });
  assert.deepEqual(parseErrors.map(({ code, startLine, startCol }) => ({ code, startLine, startCol })), [],
    "le document HTML doit être analysable sans erreur de syntaxe");
  const ids = new Map();
  const references = [];
  walk(document, node => {
    if (!node.attrs) return;
    const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
    if (attrs.id) ids.set(attrs.id, (ids.get(attrs.id) || 0) + 1);
    for (const name of ["for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-errormessage"]) {
      if (attrs[name]) for (const id of attrs[name].trim().split(/\s+/)) references.push({ name, id });
    }
    if (attrs.href?.startsWith("#") && attrs.href.length > 1) references.push({ name: "href", id: decodeURIComponent(attrs.href.slice(1)) });
  });
  assert.deepEqual([...ids].filter(([, count]) => count > 1), [], "un id HTML ne doit apparaître qu'une seule fois");
  assert.deepEqual(references.filter(({ id }) => !ids.has(id)), [], "les références for/ARIA/ancres doivent toutes cibler un id existant");
  assert.ok(ids.has("radar-latest") && ids.has("radar-accumulation"), "les deux radars doivent conserver leurs conteneurs");
  for (const id of ["project-history-slider", "project-history-summary", "messages", "settings-dialog"]) {
    assert.ok(ids.has(id), "élément structurel requis absent : " + id);
  }
});

test("branch explorer exposes temporal keyboard guidance and an accessible tree",()=>{
 assert.match(html,/id="conversation-branch-tree"[^>]*role="tree"/);
 assert.match(html,/← \/ → temps/);
 assert.match(html,/↑ \/ ↓ branches/);
});



test("branch explorer is the keyboard-first replay control, without a separate range slider",()=>{
 assert.match(html,/id="conversation-branch-tree"[^>]*tabindex="0"/);
 assert.doesNotMatch(html,/id="project-history-slider"/);
 assert.match(html,/← \/ → messages/);
 assert.match(app,/tree\.focus\(\{preventScroll:true\}\)/);
 assert.match(app,/if\(active==="main"\)\{const snapshots=/);
});

test("variant lineage includes its source exchange and makes the source node selectable",()=>{
 assert.match(app,/source=branch\.sourceTurnId\?state\.turns\.find/);
 assert.match(app,/source\?\[source\]:\[\]/);
 assert.match(app,/selectPosition:sourceIndex\+1/);
 assert.match(app,/selectPosition:sourceIndex\+index\+2/);
 assert.match(app,/selected<=forkContext/);
});

test("aborted variants expose an explicit non-selectable empty marker",()=>{
 assert.match(app,/className="branch-time-dot is-empty"/);
 assert.match(branchNavigation,/Variante avortée : aucun échange produit/);
 assert.match(styles,/\.branch-time-dot\.is-empty/);
});

test("dark theme keeps the selected original conversation label readable",()=>{
 assert.match(styles,/html\[data-theme="dark"\] \.branch-lane-choice\.is-active\{background:#29496c;color:#fff/);
});
