import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRuntimeSettings,
  updateRuntimeSettings,
  type RuntimeSettings,
  type UpdateRuntimeSettingsPayload,
} from "@/shared/api/security";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "coderadar.sidebar.collapsed";

export const THEME_STORAGE_KEY = "coderadar.theme";

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  defaultPreset: "balanced",
  defaultScanMode: "deep",
  autoOpenResults: true,
  rememberSidebarState: true,
  motionProfile: "fluid",
  theme: "system",
  surfaceContrast: "soft",
  remediationMaxAttempts: 3,
  remediationReuseExplanation: true,
  updatedAt: new Date(0).toISOString(),
};

function readLocalTheme(): RuntimeSettings["theme"] | null {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return null;
}

function applyThemeToDom(theme: RuntimeSettings["theme"]) {
  try {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.dataset.theme = resolved;
  } catch {
    // ignore
  }
}

export function useRuntimeSettings() {
  const [settings, setSettings] = useState<RuntimeSettings>(() => {
    const localTheme = (() => {
      try {
        if (typeof window !== "undefined") return readLocalTheme();
      } catch {
        // ignore
      }
      return null;
    })();
    return localTheme ? { ...DEFAULT_RUNTIME_SETTINGS, theme: localTheme } : DEFAULT_RUNTIME_SETTINGS;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      try {
        const fetched = await getRuntimeSettings();
        if (!isCancelled) {
          // UI-only priority: keep local theme if user already chose it
          const localTheme = readLocalTheme();
          if (localTheme) fetched.theme = localTheme;
          setSettings(fetched);
          // sync resolved theme to localStorage for bootstrap
          try {
            if (localTheme) window.localStorage.setItem(THEME_STORAGE_KEY, localTheme);
          } catch {
            // ignore
          }
        }
      } catch {
        if (!isCancelled) {
          // keep initial state which already reflects localStorage
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      isCancelled = true;
    };
  }, []);

  const patchSettings = useCallback(async (patch: UpdateRuntimeSettingsPayload) => {
    const previous = settingsRef.current;
    const optimistic = {
      ...previous,
      ...patch,
    } as RuntimeSettings;
    settingsRef.current = optimistic;
    setSettings(optimistic);
    // UI-only: persist theme instantly to localStorage + DOM without waiting for backend
    if ((patch as Record<string, unknown>).theme) {
      const t = (patch as Record<string, unknown>).theme as RuntimeSettings["theme"];
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, t);
      } catch {
        // ignore
      }
      applyThemeToDom(t);
    }
    setIsSaving(true);
    try {
      const persisted = await updateRuntimeSettings(patch);
      // keep local theme choice as source of truth
      if ((patch as Record<string, unknown>).theme) {
        const t = (patch as Record<string, unknown>).theme as RuntimeSettings["theme"];
        (persisted as Record<string, unknown>).theme = t;
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, t);
        } catch {
          // ignore
        }
        applyThemeToDom(t);
      }
      settingsRef.current = persisted;
      setSettings(persisted);
      return persisted;
    } catch (error) {
      // For theme, don't revert — UI stays on chosen theme even if backend offline
      if ((patch as Record<string, unknown>).theme) {
        console.warn("[CodeRadar] theme backend sync failed, keeping local theme", error);
        return optimistic;
      }
      settingsRef.current = previous;
      setSettings(previous);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    settings,
    isLoading,
    isSaving,
    patchSettings,
    setSettings,
  };
}

export function resolveMotionDuration(baseDuration: number, profile: RuntimeSettings["motionProfile"]) {
  if (profile === "instant") return 0.01;
  if (profile === "reduced") return Math.max(0.05, baseDuration * 0.5);
  return baseDuration;
}
