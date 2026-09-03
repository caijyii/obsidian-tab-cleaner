export interface DuplicateCandidate {
  path: string | null;
  isEmpty: boolean;
}

export interface DuplicateSelectionCandidate extends DuplicateCandidate {
  isPinned: boolean;
  isActive: boolean;
  isSelectable: boolean;
}

export function duplicateGroupKey(tab: DuplicateCandidate): string | null {
  if (tab.path) return `file:${tab.path}`;
  if (tab.isEmpty) return "empty";
  return null;
}

export function duplicateFlags(tabs: DuplicateCandidate[]): boolean[] {
  const counts = new Map<string, number>();
  const keys = tabs.map(duplicateGroupKey);

  for (const key of keys) {
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return keys.map((key) => key !== null && (counts.get(key) ?? 0) > 1);
}

export function duplicateDefaultSelectionFlags(
  tabs: DuplicateSelectionCandidate[],
): boolean[] {
  const selected = tabs.map(() => false);
  const groups = new Map<string, number[]>();

  for (const [index, tab] of tabs.entries()) {
    const key = duplicateGroupKey(tab);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  }

  for (const indexes of groups.values()) {
    const keeper =
      indexes.find((index) => tabs[index]?.isPinned) ??
      indexes.find((index) => tabs[index]?.isActive) ??
      indexes[0];
    for (const index of indexes) {
      if (index !== keeper && tabs[index]?.isSelectable) selected[index] = true;
    }
  }

  return selected;
}
