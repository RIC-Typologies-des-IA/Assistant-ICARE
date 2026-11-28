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
  assert.deepEqual(parseErrors.map(({ code, startLine, startCol }) => ({ code, startLine, startCol })), []);
  const ids = new Map(), references = [];
  walk(document, node => {
    if (!node.attrs) return;
    const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
    if (attrs.id) ids.set(attrs.id, (ids.get(attrs.id) || 0) + 1);
    for (const name of ["for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-errormessage"]) {
      if (attrs[name]) for (const id of attrs[name].trim().split(/\\s+/)) references.push({ name, id });
    }
    if (attrs.href?.startsWith("#") && attrs.href.length > 1) references.push({ name: "href", id: decodeURIComponent(attrs.href.slice(1)) });
  });
  assert.deepEqual([...ids].filter(([, count]) => count > 1), []);
  assert.deepEqual(references.filter(({ id }) => !ids.has(id)), []);
  for (const id of ["radar-latest", "radar-accumulation", "project-history-summary", "messages", "settings-dialog"]) assert.ok(ids.has(id));
  assert.equal(ids.has("project-history-slider"), false);
});

test("conversation tree is focusable and is the only replay navigation control", () => {
  assert.match(html, /id="conversation-branch-tree"[^>]*role="tree"[^>]*tabindex="0"/);
  assert.match(html, /← \\/ → messages/);
  assert.doesNotMatch(html, /type="range"/);
  assert.doesNotMatch(app, /project-history-slider/);
  assert.match(app, /conversation-branch-tree.*addEventListener\("keydown"/s);
  assert.match(app, /tree\\.focus\\(\\{preventScroll:true\\}\\)/);
});

test("application delegates lineage and source-node navigation to the tested branch model", () => {
  assert.match(app, /buildBranchReplayTimeline\\(state\\.turns,branch\\)\\.turns/);
  assert.match(app, /lineage\\.sourceSelectionCount/);
  assert.match(app, /lineage\\.variantNodes\\.forEach/);
  assert.match(app, /shouldReturnToParentBranch\\(branch,selected\\)/);
  assert.match(branchNavigation, /sourceSelectionCount: sourceIndex \\+ 1/);
  assert.match(branchNavigation, /selectionCount: sourceIndex \\+ index \\+ 2/);
});

test("aborted variants expose a visible non-selectable marker", () => {
  assert.match(app, /className="branch-time-dot is-empty"/);
  assert.match(branchNavigation, /Variante avortée : aucun échange produit/);
  assert.match(styles, /\\.branch-time-dot\\.is-empty/);
});

test("selected branch label remains readable in dark mode", () => {
  assert.match(styles, /html\\[data-theme="dark"\\] \\.branch-lane-choice\\.is-active\\{background:#29496c;color:#fff/);
});
