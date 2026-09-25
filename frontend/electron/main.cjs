const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, safeStorage } = require('electron');
const crypto = require('node:crypto');
const path = require('path');

// The review engine, bundled from engine/src/node/electron-entry.ts. It is plain
// Node: the review pipeline, the repository indexer, the git adapter, and the
// local HTTP API the renderer talks to. There is no Python or Rust in this
// process, and the app does not require either to be installed.
const engine = require('./review-engine.cjs');

let mainWindow;
let tray = null;
let isQuitting = false;
/** Where the renderer should send its requests, and how to authenticate them. */
let apiTarget = null;
const INITIAL_WINDOW_WIDTH = 1120;
const INITIAL_WINDOW_HEIGHT = 720;
const MIN_WINDOW_WIDTH = 980;
const MIN_WINDOW_HEIGHT = 640;
const APP_NAME = 'CodeRadar';
const APP_ID = 'com.coderadar.desktop';
const APP_ICON_PATH = process.platform === 'win32'
  ? path.join(__dirname, '../public/icon.ico')
  : path.join(__dirname, '../public/icon.png');

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

/**
 * The API key cipher, backed by the OS keychain through Electron's safeStorage.
 *
 * `protection()` is what makes saving a key an honest refusal on a machine with
 * no key store, instead of writing the key to disk in plain text.
 */
function createKeyCipher() {
  const available = safeStorage.isEncryptionAvailable();
  const backend = available && typeof safeStorage.getSelectedStorageBackend === 'function'
    ? safeStorage.getSelectedStorageBackend()
    : 'unknown';

  return {
    protection: () => ({ available, level: available ? (backend === 'basic_text' ? 'basic' : 'os') : 'none' }),
    encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
    decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
  };
}

/**
 * Points the renderer at the review engine.
 *
 * Two modes, chosen by the environment:
 *
 * - **External** (`CODE_RADAR_API_BASE_URL` set): a standalone engine process is
 *   already running, and this process only records where it is. That is the
 *   development layout, where the backend is its own process that can be
 *   restarted, curled, and debugged without touching the app.
 * - **Embedded** (default): this process starts the engine itself, on an
 *   ephemeral port, so the packaged app is self-contained. A desktop app cannot
 *   ask the user to start a server first.
 *
 * The token is generated per launch in embedded mode and never written to disk.
 */
async function connectReviewApi() {
  const externalBaseUrl = process.env.CODE_RADAR_API_BASE_URL;
  if (externalBaseUrl !== undefined && externalBaseUrl !== '') {
    if (process.env.CODE_RADAR_API_TOKEN === undefined) {
      console.warn('[CodeRadar] CODE_RADAR_API_BASE_URL is set without CODE_RADAR_API_TOKEN; the engine will reject every request.');
    }
    return { baseUrl: externalBaseUrl, token: process.env.CODE_RADAR_API_TOKEN ?? '', close: async () => {} };
  }

  const cipher = createKeyCipher();
  const settingsStore = engine.createSettingsStore({
    filePath: path.join(app.getPath('userData'), 'settings.json'),
    cipher,
  });

  const service = engine.createReviewService({
    settingsStore,
    promptsDir: engine.resolvePromptsDir(__dirname),
  });

  const configuredPort = Number.parseInt(process.env.CODE_RADAR_API_PORT ?? '', 10);
  const server = await engine.startReviewApiServer({
    service,
    token: crypto.randomBytes(32).toString('hex'),
    port: Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 0,
  });

  return { baseUrl: `${server.origin}/api/v1`, token: server.token, close: () => server.close() };
}

function createWindow() {
  // The renderer discovers the API through these arguments, so nothing has to
  // hardcode a port and the token never reaches a file on disk.
  const additionalArguments = apiTarget === null
    ? []
    : [`--coderadar-api-base-url=${apiTarget.baseUrl}`, `--coderadar-api-token=${apiTarget.token}`];

  mainWindow = new BrowserWindow({
    width: INITIAL_WINDOW_WIDTH,
    height: INITIAL_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    center: true,
    show: false,
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    frame: process.platform === 'win32' ? false : true,
    roundedCorners: true,
    title: APP_NAME,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments
    },
    icon: APP_ICON_PATH
  });

  mainWindow.removeMenu();

  // ÙÙŠ Development mode Ù‡Ù†Ø­Ù…Ù„ Ù…Ù† Vite dev server
  // ÙÙŠ Production Ù‡Ù†Ø­Ù…Ù„ Ù…Ù† Ø§Ù„Ù…Ù„ÙØ§Øª Ø§Ù„Ù…Ø¨Ù†ÙŠØ©
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:8080');
    // Open DevTools in a detached window (mode: 'detach') so the developer
    // can close it on its own without closing or affecting the main app.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.setTitle(APP_NAME);
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
    mainWindow.setSize(INITIAL_WINDOW_WIDTH, INITIAL_WINDOW_HEIGHT);
    mainWindow.center();
    mainWindow.show();
  });

  const broadcastWindowState = () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('window:state-changed', {
      maximized: mainWindow.isMaximized(),
    });
  };

  mainWindow.on('maximize', broadcastWindowState);
  mainWindow.on('unmaximize', broadcastWindowState);
  mainWindow.on('enter-full-screen', broadcastWindowState);
  mainWindow.on('leave-full-screen', broadcastWindowState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  if (tray) return;

  tray = new Tray(APP_ICON_PATH);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `Open ${APP_NAME}`,
        click: () => {
          if (!mainWindow) {
            createWindow();
            return;
          }
          mainWindow.show();
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );

  tray.on('double-click', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    mainWindow.show();
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  // The engine is started before the window so the renderer's first request has
  // somewhere to go. A failure here is reported and the window still opens: a
  // review engine that will not start must not look like an app that will not run.
  try {
    apiTarget = await connectReviewApi();
  } catch (error) {
    console.error('[CodeRadar] The review engine is unavailable', error);
  }

  ipcMain.removeHandler('dialog:pick-path');
  ipcMain.handle('dialog:pick-path', async (_event, kind) => {
    if (!mainWindow) return null;

    const properties = kind === 'file' ? ['openFile'] : ['openDirectory'];
    const title = kind === 'file' ? 'Choose a file to scan' : 'Choose a folder to scan';

    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.removeHandler('window:minimize');
  ipcMain.handle('window:minimize', () => {
    if (!mainWindow) return;
    mainWindow.minimize();
  });

  ipcMain.removeHandler('window:toggle-maximize');
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return null;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });

  ipcMain.removeHandler('window:is-maximized');
  ipcMain.handle('window:is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.removeHandler('window:close');
  ipcMain.handle('window:close', () => {
    if (!mainWindow) return;
    // Match the existing behavior of hiding-to-tray on close.
    mainWindow.hide();
  });

  createTray();
  createWindow();
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', (event) => {
  if (apiTarget === null) return;
  const target = apiTarget;
  apiTarget = null;
  event.preventDefault();
  target.close().then(() => app.quit(), () => app.quit());
});
