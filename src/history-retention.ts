export const HISTORY_STORAGE_LIMIT = 50;

export function retainedHistory<T>(items: T[]): T[] {
  return items.slice(0, HISTORY_STORAGE_LIMIT);
}

export function visibleHistory<T>(items: T[], displayLimit: number): T[] {
  return items.slice(0, displayLimit);
}
