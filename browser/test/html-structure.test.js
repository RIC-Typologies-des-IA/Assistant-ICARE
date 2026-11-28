import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "parse5";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
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


test("branch explorer renders exchange dots and fork markers with an integrated replay control",()=>{
 assert.match(app,/className="branch-time-dot"/);
 assert.match(app,/kind==="fork"/);
 assert.match(app,/className="branch-lane-track"/);
 assert.match(styles,/\.branch-lane-track/);
 assert.match(styles,/\.branch-lane-children:before/);
 assert.match(html,/class="project-history branch-primary-timeline"/);
 assert.doesNotMatch(html,/branch-compare-(select|slider|open)/);
 assert.match(html,/id="project-history-slider"/);
});


test("branch tree keeps inherited turns on the original timeline and removes branch comparison controls",()=>{
 assert.match(html,/id="conversation-branch-tree"/);
 assert.doesNotMatch(html,/branch-compare-(select|slider|open)/);
 assert.match(app,/kind==="fork"/);
 assert.doesNotMatch(app,/kind:"shared"/);
 assert.match(app,/state\.replayPreferredBranchId/);
 assert.match(app,/selected<=forkContext/);
 assert.match(app,/renderBranchExplorer\(\);/);
 assert.match(styles,/\.branch-lane-track\.is-branch-track \.branch-time-line/);
});
