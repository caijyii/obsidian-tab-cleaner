interface PathlessTabTitleOptions {
  sourceTitle: string | null;
  stateTitle: string | null;
  leafTitle: string;
  viewType: string;
}

export function resolvePathlessTabTitle(options: PathlessTabTitleOptions): string {
  return (options.sourceTitle ?? options.stateTitle ?? options.leafTitle) || options.viewType;
}
