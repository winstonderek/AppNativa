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
  ARG_PREFIXES,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type WindowRole,
} from '../shared/constants';
import { setupDownloads } from './downloads';
import { setupExternalLinkHandlers, setupNavigationHandlers } from './external-links';
import { setupContextMenu } from './context-menu';
import { logger, isDevelopment } from './logger';
import { checkForUpdatesManually } from './updater';

type WindowState = ReturnType<typeof windowStateKeeper>;

let mainWindow: BrowserWindow | null = null;
let mainWindowState: WindowState | null = null;
let checkoutWindow: BrowserWindow | null = null;
const popupWindows = new Set<BrowserWindow>();
const windowRoles = new WeakMap<BrowserWindow, WindowRole>();

const MACOS_WINDOW_CHROME: Partial<Electron.BrowserWindowConstructorOptions> = {
  backgroundColor: '#ffffff',
  titleBarStyle: 'default',
};

function getPlatformWindowOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (process.platform === 'darwin') {
    return MACOS_WINDOW_CHROME;
  }

  return {
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
  };
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Promotes a window to be the one the tray, deep links and `activate` act on.
 * Used when the workspace window outlives the window that hosted a call.
 */
export function setMainWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  mainWindow = window;
  windowRoles.set(window, 'main');
}

/** The shared window-state keeper, so callers can pause/transfer bounds persistence. */
export function getMainWindowState(): WindowState | null {
  return mainWindowState;
}

export function getWindowRole(window: BrowserWindow): WindowRole {
  return windowRoles.get(window) ?? 'main';
}

export function getPopupWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1024,
    height: 768,
    minWidth: 640,
    minHeight: 480,
    autoHideMenuBar: true,
    title: APP_NAME,
    ...getPlatformWindowOptions(),
    webPreferences: getWebPreferences('popup'),
  };
}

export function getCheckoutWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: 720,
    height: 840,
    minWidth: 480,
    minHeight: 640,
    autoHideMenuBar: true,
    title: APP_NAME,
    ...getPlatformWindowOptions(),
    webPreferences: getWebPreferences('checkout'),
  };
}

function getWebPreferences(
  role: WindowRole,
  callsSuppressed = false,
): Electron.WebPreferences {
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
    additionalArguments: [
      `${ARG_PREFIXES.windowRole}${role}`,
      `${ARG_PREFIXES.appVersion}${app.getVersion()}`,
      `${ARG_PREFIXES.callsSuppressed}${callsSuppressed}`,
    ],
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

export interface AppWindowInit {
  initialUrl?: string;
  role?: WindowRole;
  /** Explicit bounds. When omitted, the persisted window state is used instead. */
  bounds?: Electron.Rectangle;
  minWidth?: number;
  minHeight?: number;
  alwaysOnTop?: boolean;
  callsSuppressed?: boolean;
  /** Whether this window becomes the target of the tray and deep links. */
  becomeMain?: boolean;
}

/**
 * Creates a full application window (main or workspace) with the complete
 * navigation, download, context-menu and error handling setup.
 */
export function createAppWindow(init: AppWindowInit = {}): BrowserWindow {
  const role = init.role ?? 'main';
  const becomeMain = init.becomeMain ?? role === 'main';
  const usePersistedBounds = !init.bounds;

  if (usePersistedBounds && !mainWindowState) {
    mainWindowState = windowStateKeeper({
      defaultWidth: DEFAULT_WINDOW_WIDTH,
      defaultHeight: DEFAULT_WINDOW_HEIGHT,
      file: 'main-window-state.json',
    });
  }

  const bounds =
    init.bounds ??
    ({
      x: mainWindowState?.x,
      y: mainWindowState?.y,
      width: mainWindowState?.width ?? DEFAULT_WINDOW_WIDTH,
      height: mainWindowState?.height ?? DEFAULT_WINDOW_HEIGHT,
    } as Electron.Rectangle);

  const window = new BrowserWindow({
    ...bounds,
    minWidth: init.minWidth ?? MIN_WINDOW_WIDTH,
    minHeight: init.minHeight ?? MIN_WINDOW_HEIGHT,
    alwaysOnTop: init.alwaysOnTop ?? false,
    show: false,
    title: APP_NAME,
    ...getPlatformWindowOptions(),
    autoHideMenuBar: false,
    webPreferences: getWebPreferences(role, init.callsSuppressed ?? false),
  });

  windowRoles.set(window, role);

  if (becomeMain) {
    mainWindow = window;
  }

  if (usePersistedBounds) {
    mainWindowState?.manage(window);
  }

  setupNavigationHandlers(window.webContents);
  setupExternalLinkHandlers(window);
  setupDownloads(window.webContents);
  setupContextMenu(window.webContents);
  setupKeyboardShortcuts(window);

  window.webContents.setVisualZoomLevelLimits(1, 3);

  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return;
    window.show();
    if (isDevelopment()) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  });

  window.webContents.on('did-finish-load', () => {
    if (window.isDestroyed()) return;
    const url = window.webContents.getURL();
    if (url.includes('loading.html') || url.includes('error.html')) return;
    logger.debug(`Page loaded: ${url}`);
  });

  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(APP_NAME);
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED — navigation cancelled
    logger.error(`Load failed: ${errorCode} ${errorDescription} — ${validatedURL}`);
    if (!window.isDestroyed()) {
      showErrorPage(window.webContents, errorCode, errorDescription, validatedURL);
    }
  });

  window.webContents.on('certificate-error', (event, _url, _error, _certificate, callback) => {
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

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  loadAppUrl(window, init.initialUrl ?? APP_URL);

  return window;
}

export function createMainWindow(initialUrl?: string): BrowserWindow {
  return createAppWindow({ initialUrl, role: 'main' });
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

    popup.on('page-title-updated', (event) => {
      event.preventDefault();
      popup.setTitle(APP_NAME);
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

/**
 * Opens hosted Stripe Checkout / Customer Portal inside the desktop app.
 * Completing or cancelling the flow redirects to the Pynn success/cancel URL,
 * which is handed back to the main window.
 */
export function openCheckoutWindow(url: string): BrowserWindow | null {
  if (checkoutWindow && !checkoutWindow.isDestroyed()) {
    checkoutWindow.loadURL(url).catch((err) => logger.error('Checkout reload failed', err));
    checkoutWindow.show();
    checkoutWindow.focus();
    return checkoutWindow;
  }

  try {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const window = new BrowserWindow({
      ...getCheckoutWindowOptions(),
      parent,
      modal: false,
    });

    checkoutWindow = window;
    popupWindows.add(window);
    windowRoles.set(window, 'checkout');

    attachCheckoutWindowHandlers(window);

    window.on('closed', () => {
      popupWindows.delete(window);
      if (checkoutWindow === window) checkoutWindow = null;
    });

    window.loadURL(url).catch((err) => {
      logger.error('Checkout window load failed', err);
      window.close();
    });

    return window;
  } catch (error) {
    logger.error('Failed to create checkout window', error);
    return null;
  }
}

function attachCheckoutWindowHandlers(window: BrowserWindow): void {
  setupNavigationHandlers(window.webContents, { isCheckout: true });
  setupDownloads(window.webContents);
  setupContextMenu(window.webContents);

  window.webContents.on('did-create-window', (childWindow) => {
    popupWindows.add(childWindow);
    windowRoles.set(childWindow, 'checkout');
    attachCheckoutWindowHandlers(childWindow);
    childWindow.on('closed', () => {
      popupWindows.delete(childWindow);
    });
  });
}

/** After Stripe redirects to a Pynn URL, continue in the main window. */
export function returnCheckoutToApp(url: string, fromWindow: BrowserWindow): void {
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    main.webContents.loadURL(url).catch((err) => logger.error('Checkout return navigation failed', err));
    focusMainWindow();
    if (!fromWindow.isDestroyed() && fromWindow !== main) {
      fromWindow.close();
    }
    return;
  }

  if (!fromWindow.isDestroyed()) {
    fromWindow.webContents.loadURL(url).catch((err) => logger.error('Checkout fallback navigation failed', err));
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
              {
                label: 'Check for Updates…',
                click: () => checkForUpdatesManually(),
              },
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
          label: 'Check for Updates…',
          click: () => checkForUpdatesManually(),
        },
        { type: 'separator' },
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
