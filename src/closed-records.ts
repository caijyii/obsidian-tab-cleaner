import type { ClosedTabRecord, TabDescriptor } from "./types";

function historyKey(tab: TabDescriptor): string | null {
  if (tab.path) return `file:${tab.path}`;
  if (tab.url) return `web:${tab.url}`;
  if (tab.isEmpty) return "empty";
  return null;
}

export function toClosedRecords(tabs: TabDescriptor[]): ClosedTabRecord[] {
  const records = new Map<string, ClosedTabRecord>();

  for (const tab of tabs) {
    const key = historyKey(tab);
    if (key === null) continue;
    const existing = records.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    records.set(key, {
      path: tab.path,
      url: tab.url,
      extension: tab.extension,
      title: tab.title,
      viewState: tab.viewState,
      count: 1,
    });
  }

  return [...records.values()];
}
