import { useEffect, useMemo, useRef, useState } from "react";
import {
  inferWorkspace,
  RECENT_SOURCES_KEY,
  rememberRecentSource,
  type RecentSource,
  type SourceTargetType,
} from "./home-screen.utils";

const scanPresets = [
  {
    id: "safe",
    label: "Safe mode",
    description: "Strict checks with calmer defaults and fewer false positives",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Best default for most repositories and day-to-day review flows",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    description: "Broader heuristics to surface more risky paths early",
  },
] as const;

const INTERACTIVE_MODE_KEY = "coderadar.interactiveMode";

type HomeScreenDefaults = {
  preset: (typeof scanPresets)[number]["id"];
  scanMode: "fast" | "deep";
};

export function useHomeScreen(defaults?: HomeScreenDefaults) {
  const resolvedDefaults: HomeScreenDefaults = {
    preset: defaults?.preset ?? "balanced",
    scanMode: defaults?.scanMode ?? "deep",
  };
  const canBrowse = typeof window !== "undefined" && typeof window.electronAPI?.pickPath === "function";
  const [preset, setPresetState] = useState<(typeof scanPresets)[number]["id"]>(resolvedDefaults.preset);
  const [scanMode, setScanModeState] = useState<"fast" | "deep">(resolvedDefaults.scanMode);
  const [interactive, setInteractiveState] = useState(() => readInteractiveDefault());
  const [targetType, setTargetType] = useState<SourceTargetType>("folder");
  const [targetPath, setTargetPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [pickingPath, setPickingPath] = useState(false);
  const [recentSources, setRecentSources] = useState<RecentSource[]>([]);
  const userChangedPresetRef = useRef(false);
  const userChangedModeRef = useRef(false);

  const selectedPreset = scanPresets.find((item) => item.id === preset) ?? scanPresets[1];
  const inferredWorkspace = useMemo(() => inferWorkspace(targetPath, targetType), [targetPath, targetType]);
  const selectedTargetName = useMemo(() => basenameFromPath(targetPath), [targetPath]);
  const scanSummary = useMemo(
    () =>
      scanMode === "deep"
        ? targetType === "folder"
          ? "Deep review will traverse the full folder scope, build repository graphs, trace source-to-sink paths, and push coverage toward full review"
          : "Deep review will fully traverse the selected file, segment it into review blocks, and follow nearby calls to build full path evidence"
        : targetType === "folder"
          ? "Fast review will focus on the highest-risk files and path units first for a quicker partial review"
          : "Fast review will review the selected file quickly, then inspect nearby hotspots for a fast first pass",
    [scanMode, targetType],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(RECENT_SOURCES_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as RecentSource[];
      if (Array.isArray(parsed)) {
        setRecentSources(parsed);
      }
    } catch {
      setRecentSources([]);
    }
  }, []);

  useEffect(() => {
    if (!userChangedPresetRef.current) {
      setPresetState(resolvedDefaults.preset);
    }
    if (!userChangedModeRef.current) {
      setScanModeState(resolvedDefaults.scanMode);
    }
  }, [resolvedDefaults.preset, resolvedDefaults.scanMode]);

  const persistRecentSources = (nextSources: RecentSource[]) => {
    setRecentSources(nextSources);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RECENT_SOURCES_KEY, JSON.stringify(nextSources));
    }
  };

  const rememberSource = (path: string, type: SourceTargetType) => {
    persistRecentSources(rememberRecentSource(recentSources, path, type));
  };

  const visibleRecentSources = recentSources.filter((item) => item.type === targetType);

  const removeRecentSource = (path: string, type: SourceTargetType) => {
    persistRecentSources(recentSources.filter((item) => !(item.path === path && item.type === type)));
  };

  const clearRecentSources = (type: SourceTargetType) => {
    persistRecentSources(recentSources.filter((item) => item.type !== type));
  };

  const pickPath = async () => {
    if (!canBrowse || pickingPath) return;
    setPickingPath(true);
    try {
      const picked = await window.electronAPI?.pickPath?.(targetType);
      if (picked) {
        setTargetPath(picked);
        rememberSource(picked, targetType);
      }
    } finally {
      setPickingPath(false);
    }
  };

  const setPreset = (value: (typeof scanPresets)[number]["id"]) => {
    userChangedPresetRef.current = true;
    setPresetState(value);
  };

  const setScanMode = (value: "fast" | "deep") => {
    userChangedModeRef.current = true;
    setScanModeState(value);
  };

  const setInteractive = (value: boolean) => {
    setInteractiveState(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(INTERACTIVE_MODE_KEY, value ? "on" : "off");
    }
  };

  return {
    canBrowse,
    clearRecentSources,
    inferredWorkspace,
    interactive,
    loading,
    pickPath,
    pickingPath,
    preset,
    recentSources: visibleRecentSources,
    removeRecentSource,
    scanMode,
    scanPresets,
    scanSummary,
    selectedPreset,
    selectedTargetName,
    setInteractive,
    setLoading,
    setPreset,
    setScanMode,
    setTargetPath,
    setTargetType,
    targetPath,
    targetType,
  };
}

function readInteractiveDefault() {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(INTERACTIVE_MODE_KEY);
  if (stored === "off") return false;
  if (stored === "on") return true;
  return true;
}

function basenameFromPath(path: string) {
  if (!path) return "No source selected yet";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}
