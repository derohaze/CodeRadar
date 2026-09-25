export type SourceTargetType = "folder" | "file";

export interface RecentSource {
  path: string;
  type: SourceTargetType;
  workspace: string;
  pickedAt: number;
}

export const RECENT_SOURCES_KEY = "coderadar.recent-sources";
export const MAX_RECENT_SOURCES = 8;

export function basename(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function inferWorkspace(path: string, type: SourceTargetType) {
  if (!path) return "Select source";

  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");

  if (type === "folder") {
    return parts[parts.length - 1] || normalized;
  }

  return parts[parts.length - 2] || basename(normalized);
}

export function rememberRecentSource(
  recentSources: RecentSource[],
  path: string,
  type: SourceTargetType,
) {
  const entry: RecentSource = {
    path,
    type,
    workspace: inferWorkspace(path, type),
    pickedAt: Date.now(),
  };

  return [
    entry,
    ...recentSources.filter((item) => !(item.path === path && item.type === type)),
  ].slice(0, MAX_RECENT_SOURCES);
}
