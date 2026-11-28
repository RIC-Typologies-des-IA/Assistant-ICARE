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
      if (attrs[name]) for (const id of attrs[name].trim().split(/\s+/)) references.push({ name, id });
    }
    if (attrs.href?.startsWith("#") && attrs.href.length > 1) references.push({ name: "href", id: decodeURIComponent(attrs.href.slice(1)) });
  });
  assert.deepEqual([...ids].filter(([, count]) => count > 1), []);
  assert.deepEqual(references.filter(({ id }) => !ids.has(id)), []);
  for (const id of ["radar-latest", "radar-accumulation", "project-history-summary", "messages", "settings-dialog"]) assert.ok(ids.has(id));
  assert.equal(ids.has("project-history-slider"), false);
});

test("conversation tree is focusable and is the only replay navigation control", () => {
  assert.ok(html.includes('id="conversation-branch-tree" class="branch-tree" role="tree" tabindex="0"'));
  assert.ok(html.includes("← / → messages"));
  assert.ok(!html.includes('type="range"'));
  assert.ok(!app.includes("project-history-slider"));
  assert.ok(app.includes('$("conversation-branch-tree")?.addEventListener("keydown"'));
  assert.ok(app.includes('tree.focus({preventScroll:true})'));
});

test("application delegates lineage and source-node navigation to the tested branch model", () => {
  assert.ok(app.includes("buildBranchReplayTimeline(state.turns,branch).turns"));
  assert.ok(app.includes("lineage.sourceSelectionCount"));
  assert.ok(!app.includes("kind:\"fork\""));
  assert.ok(!app.includes("is-fork"));
  assert.ok(app.includes("lineage.variantNodes.forEach"));
  assert.ok(app.includes("shouldReturnToParentBranch(branch,selected)"));
  assert.ok(app.includes("shouldResumeBranchOnForward(preferred,next)"));
  assert.ok(branchNavigation.includes("sourceSelectionCount: sourceIndex + 1"));
  assert.ok(branchNavigation.includes("selectionCount: sourceIndex + index + 2"));
});

test("aborted variants expose a visible non-selectable marker", () => {
  assert.ok(app.includes('className="branch-time-dot is-empty"'));
  assert.ok(branchNavigation.includes("Variante avortée : aucun échange produit"));
  assert.ok(styles.includes(".branch-time-dot.is-empty"));
});

test("selected branch label remains readable in dark mode", () => {
  assert.ok(styles.includes('html[data-theme="dark"] .branch-lane-choice.is-active{background:#29496c;color:#fff'));
});
