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
  recentStrategyIds: string[],
  activeFilterId: string,
): FilterOrders {
  const displayIds = unique([...builtInIds, ...strategyIds]);
  const displaySet = new Set(displayIds);
  const priorityIds = unique([
    activeFilterId,
    ...builtInIds,
    ...recentStrategyIds,
    ...strategyIds,
  ]).filter((id) => displaySet.has(id));

  return { displayIds, priorityIds };
}
