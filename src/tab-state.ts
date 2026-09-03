type ViewStateLike = { state?: unknown };

export function stateString(viewState: ViewStateLike, key: string): string | null {
  const state = viewState.state;
  if (!state || typeof state !== "object" || !(key in state)) return null;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function basename(value: string): string {
  return decoded(value).split(/[\\/]/).pop() ?? "";
}

function extensionFromName(value: string): string {
  return basename(value).match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLocaleLowerCase() ?? "";
}

export function extensionFromSource(source: string, depth = 0): string {
  if (!source) return "";
  if (/^data:text\/html(?:[;,]|$)/i.test(source)) return "html";

  try {
    const parsed = new URL(source);
    const pathExtension = extensionFromName(parsed.pathname);
    if (pathExtension) return pathExtension;
    if (depth >= 1) return "";
    for (const value of parsed.searchParams.values()) {
      const extension = extensionFromSource(value, depth + 1);
      if (extension) return extension;
    }
    return "";
  } catch {
    return extensionFromName(source.split(/[?#]/)[0] ?? source);
  }
}

export function titleFromSource(source: string): string | null {
  if (!source) return null;
  try {
    const parsed = new URL(source);
    for (const key of ["file", "path", "src", "url"]) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;
      const title = basename(value.split(/[?#]/)[0] ?? value);
      if (title) return title;
    }
    const title = basename(parsed.pathname);
    return title || parsed.hostname || null;
  } catch {
    const title = basename(source.split(/[?#]/)[0] ?? source);
    return title || null;
  }
}
