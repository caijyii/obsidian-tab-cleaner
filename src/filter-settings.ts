const BUILT_IN_GROUP_IDS = ["empty", "duplicates"];

function normalizeGroupIds(savedIds: unknown, strategyIds: string[]): string[] {
  if (!Array.isArray(savedIds)) return [];
  const validIds = new Set([...BUILT_IN_GROUP_IDS, ...strategyIds]);
  return [...new Set(savedIds.filter((id): id is string =>
    typeof id === "string" && id !== "all" && validIds.has(id),
  ))];
}

export function normalizePinnedFilterIds(savedIds: unknown, strategyIds: string[]): string[] {
  if (!Array.isArray(savedIds)) return [...BUILT_IN_GROUP_IDS];
  return normalizeGroupIds(savedIds, strategyIds);
}

export function normalizeRecentFilterIds(savedIds: unknown, strategyIds: string[]): string[] {
  return normalizeGroupIds(savedIds, strategyIds);
}

export function setFilterPinned(
  pinnedIds: string[],
  filterId: string,
  pinned: boolean,
): string[] {
  return [...new Set(pinned ? [...pinnedIds, filterId] : pinnedIds.filter((id) => id !== filterId))];
}

export function movePinnedFilter(
  pinnedIds: string[],
  filterId: string,
  direction: "up" | "down",
): string[] {
  const ids = [...new Set(pinnedIds)];
  const from = ids.indexOf(filterId);
  if (from < 0) return ids;
  const to = from + (direction === "up" ? -1 : 1);
  const moving = ids[from];
  const adjacent = ids[to];
  if (moving === undefined || adjacent === undefined) return ids;
  ids[from] = adjacent;
  ids[to] = moving;
  return ids;
}

export function reorderPinnedFilter(
  pinnedIds: string[],
  draggedId: string,
  targetId: string,
  placement: "before" | "after",
): string[] {
  const ids = [...new Set(pinnedIds)];
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) return ids;
  const reordered = ids.filter((id) => id !== draggedId);
  const targetIndex = reordered.indexOf(targetId);
  reordered.splice(targetIndex + (placement === "after" ? 1 : 0), 0, draggedId);
  return reordered;
}
