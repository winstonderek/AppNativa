import {
  BrowserWindow,
  Menu,
  MenuItem,
  WebContents,
  app,
  nativeTheme,
} from 'electron';
import windowStateKeeper from 'electron-window-state';
import path from 'node:path';
import {
  APP_NAME,
  APP_URL,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from '../shared/constants';
import { setupDownloads } from './downloads';
import { setupExternalLinkHandlers, setupNavigationHandlers } from './external-links';
import { setupContextMenu } from './context-menu';
import { logger, isDevelopment } from './logger';

let mainWindow: BrowserWindow | null = null;
const popupWindows = new Set<BrowserWindow>();

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getPopupWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1024,
    height: 768,
    minWidth: 640,
    minHeight: 480,
    autoHideMenuBar: true,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    webPreferences: getWebPreferences(),
  };
}

function getWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: true,
    devTools: isDevelopment(),
    zoomFactor: 1,
    enableBlinkFeatures: '',
  };
}

function getStaticPath(filename: string): string {
  return path.join(__dirname, '..', 'static', filename);
}

function showErrorPage(
  webContents: WebContents,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
): void {
  const params = new URLSearchParams({
    code: String(errorCode),
    url: validatedURL,
  });

  if (isDevelopment()) {
    params.set('detail', errorDescription);
  }

  webContents
    .loadFile(getStaticPath('error.html'), { query: Object.fromEntries(params) })
    .catch((err) => logger.error('Failed to load error page', err));
}

export function createMainWindow(initialUrl?: string): BrowserWindow {
  const mainWindowState = windowStateKeeper({
    defaultWidth: DEFAULT_WINDOW_WIDTH,
    defaultHeight: DEFAULT_WINDOW_HEIGHT,
    file: 'main-window-state.json',
  });

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    autoHideMenuBar: false,
    webPreferences: getWebPreferences(),
  });

  mainWindowState.manage(mainWindow);

  setupNavigationHandlers(mainWindow.webContents);
  setupExternalLinkHandlers(mainWindow);
  setupDownloads(mainWindow.webContents);
  setupContextMenu(mainWindow.webContents);
  setupKeyboardShortcuts(mainWindow);

  mainWindow.webContents.setVisualZoomLevelLimits(1, 3);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDevelopment()) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow?.webContents.getURL() ?? '';
    if (url.includes('loading.html') || url.includes('error.html')) return;
    logger.debug(`Page loaded: ${url}`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED — navigation cancelled
    logger.error(`Load failed: ${errorCode} ${errorDescription} — ${validatedURL}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      showErrorPage(mainWindow.webContents, errorCode, errorDescription, validatedURL);
    }
  });

  mainWindow.webContents.on('certificate-error', (event, _url, _error, _certificate, callback) => {
    // Never bypass invalid certificates in production
    if (isDevelopment()) {
      event.preventDefault();
      callback(true);
      logger.warn('Certificate error bypassed in development');
    } else {
      callback(false);
      logger.error('Certificate error — connection rejected');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const targetUrl = initialUrl ?? APP_URL;
  loadAppUrl(mainWindow, targetUrl);

  return mainWindow;
}

export function loadAppUrl(window: BrowserWindow, url: string): void {
  window.webContents
    .loadFile(getStaticPath('loading.html'))
    .then(() => window.webContents.loadURL(url))
    .catch((err) => {
      logger.error('Failed to load app URL', err);
      window.webContents.loadURL(url).catch((loadErr) => logger.error('Direct load also failed', loadErr));
    });
}

export function createPopupWindow(url: string, parent?: WebContents): BrowserWindow | null {
  try {
    const popup = new BrowserWindow({
      ...getPopupWindowOptions(),
      parent: parent ? BrowserWindow.fromWebContents(parent) ?? undefined : undefined,
      modal: false,
    });

    popupWindows.add(popup);
    setupNavigationHandlers(popup.webContents, { isPopup: true });
    setupDownloads(popup.webContents);
    setupContextMenu(popup.webContents);

    popup.on('closed', () => {
      popupWindows.delete(popup);
    });

    popup.loadURL(url).catch((err) => {
      logger.error('Popup load failed', err);
      popup.close();
    });

    return popup;
  } catch (error) {
    logger.error('Failed to create popup window', error);
    return null;
  }
}

function setupKeyboardShortcuts(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    const isMac = process.platform === 'darwin';
    const mod = isMac ? input.meta : input.control;

    if (!mod || input.alt || input.shift && input.key.toLowerCase() !== 'r') {
      // Handle back/forward separately
    }

    // Reload: Ctrl/Cmd+R
    if (mod && !input.shift && input.key.toLowerCase() === 'r') {
      window.webContents.reload();
      event.preventDefault();
      return;
    }

    // Hard reload: Ctrl/Cmd+Shift+R
    if (mod && input.shift && input.key.toLowerCase() === 'r') {
      window.webContents.reloadIgnoringCache();
      event.preventDefault();
      return;
    }

    // Back: Alt+Left (Win/Linux) or Cmd+[ (macOS)
    if (
      (!isMac && input.alt && input.key === 'ArrowLeft') ||
      (isMac && input.meta && input.key === '[')
    ) {
      if (window.webContents.canGoBack()) {
        window.webContents.goBack();
        event.preventDefault();
      }
      return;
    }

    // Forward: Alt+Right or Cmd+]
    if (
      (!isMac && input.alt && input.key === 'ArrowRight') ||
      (isMac && input.meta && input.key === ']')
    ) {
      if (window.webContents.canGoForward()) {
        window.webContents.goForward();
        event.preventDefault();
      }
      return;
    }

    // DevTools: F12 or Ctrl/Cmd+Shift+I (development only)
    if (isDevelopment()) {
      if (
        input.key === 'F12' ||
        (mod && input.shift && input.key.toLowerCase() === 'i')
      ) {
        window.webContents.toggleDevTools();
        event.preventDefault();
      }
    }
  });
}

export function buildApplicationMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: (_, focusedWindow) => {
            const win = focusedWindow as BrowserWindow | undefined;
            win?.webContents.reload();
          },
        },
        {
          label: 'Hard Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_, focusedWindow) => {
            const win = focusedWindow as BrowserWindow | undefined;
            win?.webContents.reloadIgnoringCache();
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDevelopment()
          ? ([
              { type: 'separator' as const },
              {
                label: 'Toggle Developer Tools',
                accelerator: 'CmdOrCtrl+Shift+I',
                click: (_, focusedWindow) => {
                  const win = focusedWindow as BrowserWindow | undefined;
                  win?.webContents.toggleDevTools();
                },
              },
            ] as Electron.MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }]),
      ],
    },
  ];

  if (!isMac) {
    template.push({
      label: 'Help',
      submenu: [
        {
          label: `${APP_NAME} Support`,
          click: () => {
            void import('electron').then(({ shell }) => shell.openExternal(APP_URL));
          },
        },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function hideMainWindow(): void {
  mainWindow?.hide();
}

export function closeAllPopups(): void {
  for (const popup of popupWindows) {
    if (!popup.isDestroyed()) popup.close();
  }
  popupWindows.clear();
}
