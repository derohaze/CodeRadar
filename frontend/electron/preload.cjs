const { contextBridge, ipcRenderer } = require('electron');

// Keep track so the renderer can subscribe to maximize changes.
const windowStateListeners = new Set();

ipcRenderer.on('window:state-changed', (_event, state) => {
  for (const listener of windowStateListeners) {
    listener(state);
  }
});

/**
 * Reads the values the main process passed in when it created this window.
 *
 * The local review API listens on an ephemeral port so it never fights another
 * process for a fixed one, and it requires a per-launch token. Both are handed
 * over as launch arguments rather than baked into the renderer build: the port
 * is not known until the server binds, and the token must not be written to disk.
 */
function launchArgument(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  pickPath: (kind) => ipcRenderer.invoke('dialog:pick-path', kind),
  apiBaseUrl: launchArgument('coderadar-api-base-url'),
  apiToken: launchArgument('coderadar-api-token'),
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    close: () => ipcRenderer.invoke('window:close'),
    onStateChanged: (listener) => {
      windowStateListeners.add(listener);
      return () => windowStateListeners.delete(listener);
    }
  }
});
