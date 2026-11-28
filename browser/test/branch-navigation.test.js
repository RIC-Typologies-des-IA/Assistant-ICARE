import test from "node:test";
import assert from "node:assert/strict";
import { buildBranchReplayTimeline, shouldReturnToParentBranch, shouldResumeBranchOnForward } from "../branch-navigation.js";

const turn = (id, branchId = null) => ({ id, experiment: branchId ? { branchId } : null });
const fixture = () => {
  const turns = [turn("a"), turn("b"), turn("source"), turn("variant-1", "v1"), turn("variant-2", "v1")];
  const branch = { id: "v1", sourceTurnId: "source", sourceIndex: 2, contextTurnIds: ["a", "b"] };
  return { turns, branch };
};

test("branch replay contains shared context, source message, then variant messages exactly once", () => {
  const { turns, branch } = fixture();
  const timeline = buildBranchReplayTimeline(turns, branch);
  assert.deepEqual(timeline.turns.map(item => item.id), ["a", "b", "source", "variant-1", "variant-2"]);
  assert.equal(new Set(timeline.turns.map(item => item.id)).size, timeline.turns.length);
  assert.equal(timeline.sourcePosition, 3);
  assert.equal(timeline.sourceSelectionCount, 3);
  assert.deepEqual(timeline.variantNodes.map(node => [node.turn.id, node.position, node.selectionCount]), [
    ["variant-1", 4, 4], ["variant-2", 5, 5]
  ]);
  assert.equal(timeline.emptyMarker, null);
});

test("rewind crosses to the parent only before the source message", () => {
  const { branch } = fixture();
  for (let count = 0; count <= 2; count++) assert.equal(shouldReturnToParentBranch(branch, count), true);
  assert.equal(shouldReturnToParentBranch(branch, 3), false);
  assert.equal(shouldReturnToParentBranch(branch, 4), false);
});

test("aborted branch retains its selectable source and displays a non-selectable empty marker", () => {
  const turns = [turn("one"), turn("source")];
  const branch = { id: "aborted", sourceTurnId: "source", sourceIndex: 1, contextTurnIds: ["one"] };
  const timeline = buildBranchReplayTimeline(turns, branch);
  assert.deepEqual(timeline.turns.map(item => item.id), ["one", "source"]);
  assert.equal(timeline.sourceSelectionCount, 2);
  assert.deepEqual(timeline.emptyMarker, { position: 3, label: "Variante avortée : aucun échange produit" });
  assert.equal(timeline.variantNodes.length, 0);
});

test("nested branch replay uses the parent branch message as its source", () => {
  const turns = [turn("root"), turn("parent-source"), turn("parent-run", "parent"), turn("child-run", "child")];
  const branch = { id: "child", sourceTurnId: "parent-run", sourceIndex: 2, contextTurnIds: ["root", "parent-source"], parentBranchId: "parent" };
  const timeline = buildBranchReplayTimeline(turns, branch);
  assert.deepEqual(timeline.turns.map(item => item.id), ["root", "parent-source", "parent-run", "child-run"]);
  assert.equal(timeline.sourceSelectionCount, 3);
  assert.equal(timeline.variantNodes[0].selectionCount, 4);
});

test("repeated forward/backward navigation preserves the same branch boundary", () => {
  const { branch } = fixture();
  for (let cycle = 0; cycle < 25; cycle++) {
    assert.equal(shouldReturnToParentBranch(branch, 2), true);
    assert.equal(shouldReturnToParentBranch(branch, 3), false);
    assert.equal(shouldReturnToParentBranch(branch, 4), false);
  }
});

test("forward replay resumes the remembered branch exactly when it reaches the source message", () => {
  const { branch } = fixture();
  for (let count = 0; count <= 2; count++) assert.equal(shouldResumeBranchOnForward(branch, count), false);
  assert.equal(shouldResumeBranchOnForward(branch, 3), true);
  assert.equal(shouldResumeBranchOnForward(branch, 4), true);
});
