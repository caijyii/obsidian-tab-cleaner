export interface FilterOrders {
  displayIds: string[];
  priorityIds: string[];
}

function unique(ids: string[]): string[] {
  return ids.filter((id, index, all) => all.indexOf(id) === index);
}

export function filterOrders(
  builtInIds: string[],
  strategyIds: string[],
  recentFilterIds: string[],
  activeFilterId: string,
  pinnedFilterIds: string[],
): FilterOrders {
  const displaySet = new Set([...builtInIds, ...strategyIds].filter((id) => id !== "all"));
  const pinnedIds = unique(pinnedFilterIds).filter((id) => displaySet.has(id));
  const pinnedSet = new Set(pinnedIds);
  const unpinnedIds = unique([...recentFilterIds, ...builtInIds, ...strategyIds])
    .filter((id) => displaySet.has(id) && !pinnedSet.has(id));
  const displayIds = [...pinnedIds, ...unpinnedIds];
  const priorityIds = unique([
    activeFilterId,
    ...pinnedIds,
    ...displayIds,
  ]).filter((id) => displaySet.has(id));

  return { displayIds, priorityIds };
}
