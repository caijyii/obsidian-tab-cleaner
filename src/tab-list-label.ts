export interface TabListLabels {
  openTabs: string;
  searchResults: string;
  emptyTabs: string;
  duplicateTabs: string;
}

export function tabListLabel(
  filterId: string,
  query: string,
  strategies: Array<{ id: string; name: string }>,
  labels: TabListLabels,
): string {
  if (query.trim()) return labels.searchResults;
  if (filterId === "empty") return labels.emptyTabs;
  if (filterId === "duplicates") return labels.duplicateTabs;
  if (filterId === "all") return labels.openTabs;
  return strategies.find((strategy) => strategy.id === filterId)?.name ?? labels.openTabs;
}
