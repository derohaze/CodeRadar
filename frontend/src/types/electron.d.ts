export interface ElectronWindowState {
  maximized: boolean;
}

export interface ElectronWindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean | null>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
  onStateChanged: (listener: (state: ElectronWindowState) => void) => () => void;
}

export interface ElectronAPI {
  platform: string;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  pickPath?: (kind: "file" | "folder") => Promise<string | null>;
  /**
   * Origin of the local review API inside the Electron main process, including
   * its `/api/v1` prefix. Null when the app is not running under Electron, or
   * when the engine did not start.
   */
  apiBaseUrl?: string | null;
  /** Per-launch secret the local review API requires on every data route. */
  apiToken?: string | null;
  windowControls?: ElectronWindowControls;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}