import type { TabDescriptor } from "./types";

// Track only fields visible in the cleaner. Editor cursor/scroll changes must
// not replace a row or tooltip target while the user is interacting with it.
export function tabListStateSignature(tabs: TabDescriptor[]): string {
  return JSON.stringify(tabs.map((tab) => [
    tab.id,
    tab.title,
    tab.path,
    tab.url,
    tab.extension,
    tab.viewType,
    tab.isEmpty,
    tab.isDuplicate,
    tab.isPinned,
    tab.isActive,
    tab.isRestorable,
  ]));
}
