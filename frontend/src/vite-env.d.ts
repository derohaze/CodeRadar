/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    platform: string;
    versions: {
      node: string;
      chrome: string;
      electron: string;
    };
    pickPath?: (kind: "file" | "folder") => Promise<string | null>;
    /** Origin of the local review API, including its `/api/v1` prefix. */
    apiBaseUrl?: string | null;
    /** Per-launch secret the local review API requires on every data route. */
    apiToken?: string | null;
    windowControls?: {
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<boolean | null>;
      isMaximized: () => Promise<boolean>;
      close: () => Promise<void>;
      onStateChanged: (listener: (state: { maximized: boolean }) => void) => () => void;
    };
  };
}