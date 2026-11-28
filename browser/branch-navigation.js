export function buildBranchReplayTimeline(turns, branch) {
  const allTurns = Array.isArray(turns) ? turns : [];
  if (!branch) return { turns: [], sourceIndex: 0, sourcePosition: 1, sourceSelectionCount: 1, ownTurns: [], variantNodes: [], emptyMarker: null };
  const byId = new Map(allTurns.map(turn => [turn.id, turn]));
  const context = Array.isArray(branch.contextTurnIds)
    ? branch.contextTurnIds.map(id => byId.get(id)).filter(Boolean)
    : (branch.contextTurns || []).filter(Boolean);
  const source = branch.sourceTurnId ? byId.get(branch.sourceTurnId) : null;
  const ownTurns = allTurns.filter(turn => turn.experiment?.branchId === branch.id);
  const lineage = [...context, ...(source && !context.some(turn => turn.id === source.id) ? [source] : []), ...ownTurns];
  const sourceIndex = Math.max(0, Number(branch.sourceIndex ?? context.length) || 0);
  const sourcePosition = sourceIndex + 1;
  const variantNodes = ownTurns.map((turn, index) => ({
    turn,
    position: sourcePosition + index + 1,
    selectionCount: sourceIndex + index + 2
  }));
  return {
    turns: lineage,
    sourceIndex,
    sourcePosition,
    sourceSelectionCount: sourceIndex + 1,
    ownTurns,
    variantNodes,
    emptyMarker: ownTurns.length ? null : { position: sourcePosition + 1, label: "Variante avortée : aucun échange produit" }
  };
}

export function shouldReturnToParentBranch(branch, selectedCount) {
  if (!branch) return false;
  const sourceIndex = Math.max(0, Number(branch.sourceIndex ?? branch.contextTurnIds?.length ?? 0) || 0);
  return Number(selectedCount) <= sourceIndex;
}
