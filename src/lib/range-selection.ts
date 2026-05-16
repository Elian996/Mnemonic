export function toggleRangeSelection({
  selectedIds,
  orderedIds,
  targetId,
  anchorId
}: {
  selectedIds: ReadonlySet<string>;
  orderedIds: string[];
  targetId: string;
  anchorId?: string | null;
}) {
  const next = new Set(selectedIds);
  const targetIndex = orderedIds.indexOf(targetId);
  const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;

  if (anchorIndex >= 0 && targetIndex >= 0) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const shouldSelectRange = !selectedIds.has(targetId);
    for (const rangeId of orderedIds.slice(start, end + 1)) {
      if (shouldSelectRange) {
        next.add(rangeId);
      } else {
        next.delete(rangeId);
      }
    }
    return next;
  }

  if (next.has(targetId)) {
    next.delete(targetId);
  } else {
    next.add(targetId);
  }
  return next;
}
