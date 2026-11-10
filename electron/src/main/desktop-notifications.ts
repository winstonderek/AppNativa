import { BrowserWindow, Notification, app, ipcMain, shell } from 'electron';
import Store from 'electron-store';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, APP_NAME, IPC_CHANNELS } from '../shared/constants';
import { isAllowedMainNavigation, isPrimaryHost, resolveInAppNotificationUrl } from '../shared/url-utils';
import { logger } from './logger';
import { getTalksWindow } from './call-layout';
import { focusMainWindow, getMainWindow } from './window';
import { isWindowsSetupInstall } from './windows-install';
import { applyWindowsTaskbarBadge } from './windows-taskbar-badge';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 280;

interface DesktopNotificationPayload {
  title: string;
  body?: string;
  url?: string;
}

interface NotificationPrefs {
  registeredWithSystem: boolean;
  registeredWithWindowsToasts: boolean;
}

const prefs = new Store<NotificationPrefs>({
  name: 'notifications',
  defaults: {
    registeredWithSystem: false,
    registeredWithWindowsToasts: false,
  },
});

let lastUnreadCount: number | null = null;

function isTrustedSender(contents: Electron.WebContents): boolean {
  try {
    return isPrimaryHost(new URL(contents.getURL()).hostname);
  } catch {
    return false;
  }
}

function isAppFocused(): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  return Boolean(focused && !focused.isDestroyed());
}

function clampCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(Math.floor(value), 9999));
}

function parsePayload(value: unknown): DesktopNotificationPayload | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;

  const body = typeof raw.body === 'string' ? raw.body.trim() : undefined;
  const url = typeof raw.url === 'string' ? raw.url.trim() : undefined;

  return {
    title: title.slice(0, MAX_TITLE_LENGTH),
    body: body ? body.slice(0, MAX_BODY_LENGTH) : undefined,
    url: url || undefined,
  };
}

export function applyUnreadBadge(count: number): void {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(count > 0 ? (count > 99 ? '99+' : String(count)) : '');
    return;
  }

  if (process.platform === 'win32') {
    applyWindowsTaskbarBadge(count);
    return;
  }

  app.setBadgeCount(count > 0 ? Math.min(count, 99) : 0);
}

export function clearUnreadBadge(): void {
  applyUnreadBadge(0);
}

function getAssetsDir(): string {
  return path.join(__dirname, '..', '..', 'assets');
}

function getNotificationIconPath(): string | undefined {
  const assetsDir = getAssetsDir();
  const candidates =
    process.platform === 'win32'
      ? [path.join(assetsDir, 'icon.ico'), path.join(assetsDir, 'icon.png')]
      : [path.join(assetsDir, 'icon.png')];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

/** Identity Windows uses to match toasts to the Start Menu shortcut. */
export function getWindowsAppUserModelId(): string {
  if (!app.isPackaged) {
    return process.execPath;
  }
  // NSIS writes this same id (electron-builder appId) on the shortcut.
  return APP_ID;
}

/** Call as early as possible on Windows so Chromium inherits the AUMID. */
export function applyWindowsAppUserModelId(): void {
  if (process.platform !== 'win32') return;
  const aumid = getWindowsAppUserModelId();
  app.setAppUserModelId(aumid);
  logger.debug(`Windows AppUserModelID: ${aumid}`);
}

function getStartMenuShortcutPath(): string {
  return path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    `${APP_NAME}.lnk`,
  );
}

function isPynnShortcut(details: Electron.ShortcutDetails, aumid: string): boolean {
  if (details.appUserModelId === aumid) return true;
  const target = (details.target ?? '').replace(/\//g, '\\').toLowerCase();
  return target.endsWith('\\pynn.exe');
}

function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

/**
 * Windows toasts need a Start Menu shortcut whose AppUserModelID matches the
 * running process. The NSIS installer creates it; this repairs it if it is
 * missing or still points at a previous install. A portable launch does not
 * retarget a shortcut that already opens another copy of Pynn.
 */
function ensureStartMenuShortcut(aumid: string): void {
  if (!app.isPackaged) return;

  const shortcutPath = getStartMenuShortcutPath();
  const exists = fs.existsSync(shortcutPath);
  const clsid = (app as Electron.App & { toastActivatorCLSID?: string }).toastActivatorCLSID;

  if (exists) {
    try {
      const current = shell.readShortcutLink(shortcutPath);
      const target = current.target ?? '';
      const pointsHere = samePath(target, process.execPath);
      const ours = isPynnShortcut(current, aumid) || isWindowsSetupInstall();
      if (!ours) return;
      if (!pointsHere && target && fs.existsSync(target) && !isWindowsSetupInstall()) return;

      const sameClsid = !clsid || current.toastActivatorClsid === clsid;
      if (
        pointsHere &&
        current.appUserModelId === aumid &&
        sameClsid &&
        samePath(current.icon, process.execPath)
      ) {
        return;
      }
    } catch (error) {
      logger.debug(`Existing shortcut could not be read: ${shortcutPath}`, error);
    }
  }

  const next: Electron.ShortcutDetails = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    description: APP_NAME,
    appUserModelId: aumid,
    icon: process.execPath,
    iconIndex: 0,
    ...(clsid ? { toastActivatorClsid: clsid } : {}),
  };

  try {
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
    const operation = exists ? 'replace' : 'create';
    if (!shell.writeShortcutLink(shortcutPath, operation, next)) {
      throw new Error(`writeShortcutLink(${operation}) returned false`);
    }
    logger.info(`Windows shortcut ready (${path.basename(shortcutPath)}, ${aumid})`);
  } catch (error) {
    logger.warn(`Failed to register Windows shortcut ${shortcutPath}`, error);
  }
}

/**
 * After `ready`: keep the AUMID set and make sure the Start Menu shortcut
 * still launches this copy. Safe to call on every launch.
 */
export function applyWindowsNotificationIdentity(): void {
  if (process.platform !== 'win32') return;
  applyWindowsAppUserModelId();
  ensureStartMenuShortcut(getWindowsAppUserModelId());
}

/** In-app path (pathname, query, hash) of a primary-host URL. */
function inAppPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!isPrimaryHost(parsed.hostname)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function isOnPrimaryHost(window: BrowserWindow): boolean {
  return inAppPath(window.webContents.getURL()) !== null;
}

/** Chats links go to the Talks window when one is open; the rest to the main window. */
function notificationWindow(path: string | null): BrowserWindow | null {
  const talks = getTalksWindow();
  if (talks && path?.startsWith('/agentic/chats')) return talks;
  const main = getMainWindow();
  return main && !main.isDestroyed() ? main : null;
}

/**
 * Brings the right window forward, then asks the page to route to the link
 * (preload `onNavigate`), so the open app is not reloaded. A window that is
 * not on the Pynn host (a sign-in page) loads the URL instead.
 */
function focusAndNavigate(url: string | null): void {
  const path = url ? inAppPath(url) : null;
  const window = notificationWindow(path);
  if (!window) {
    focusMainWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (!url || !path || !isAllowedMainNavigation(url)) return;

  if (isOnPrimaryHost(window) && !window.webContents.isLoading()) {
    window.webContents.send(IPC_CHANNELS.navigate, path);
    return;
  }
  if (window.webContents.getURL() === url) return;
  window.webContents.loadURL(url).catch((err) => {
    logger.error('Failed to open notification URL', err);
  });
}

/**
 * Shown notifications are kept referenced: a collected Notification loses its
 * click handler (Windows Action Center, macOS Notification Center).
 */
const MAX_LIVE_NOTIFICATIONS = 50;
const liveNotifications = new Set<Notification>();

function keepNotification(notification: Notification): () => void {
  liveNotifications.add(notification);
  if (liveNotifications.size > MAX_LIVE_NOTIFICATIONS) {
    const oldest = liveNotifications.values().next().value;
    if (oldest) liveNotifications.delete(oldest);
  }
  return () => {
    liveNotifications.delete(notification);
  };
}

function showNativeNotification(
  payload: DesktopNotificationPayload,
  options: { ignoreFocus?: boolean } = {},
): void {
  if (!Notification.isSupported()) {
    logger.warn('Native notifications are not supported on this system');
    return;
  }

  if (!options.ignoreFocus && isAppFocused()) {
    logger.debug(`Skipped native notification while focused: ${payload.title}`);
    return;
  }

  const targetUrl = resolveInAppNotificationUrl(payload.url);
  const icon = getNotificationIconPath();
  const notification = new Notification({
    title: payload.title,
    body: payload.body ?? '',
    silent: false,
    timeoutType: 'default',
    ...(icon ? { icon } : {}),
  });

  const release = keepNotification(notification);

  notification.on('failed', (_event, error) => {
    release();
    logger.error(`Native notification failed: ${error}`);
  });

  notification.on('click', () => {
    release();
    focusAndNavigate(targetUrl);
  });

  notification.show();
  logger.info(`Native notification shown: ${payload.title}`);
}

/**
 * Posts one native notification so the OS creates the Pynn row in
 * notification settings. Safe to call every launch; only the first
 * successful registration per platform is persisted.
 */
export function registerDesktopNotifications(): void {
  if (!Notification.isSupported()) {
    logger.warn('Cannot register notifications — API not supported');
    return;
  }

  if (process.platform === 'win32') {
    if (prefs.get('registeredWithWindowsToasts')) return;
    showNativeNotification(
      {
        title: APP_NAME,
        body: 'Notifications are enabled. You can change this in Windows Settings.',
      },
      { ignoreFocus: true },
    );
    prefs.set('registeredWithWindowsToasts', true);
    return;
  }

  if (prefs.get('registeredWithSystem')) return;

  showNativeNotification(
    {
      title: APP_NAME,
      body: 'Notifications are enabled. You can change this in System Settings.',
    },
    { ignoreFocus: true },
  );
  prefs.set('registeredWithSystem', true);
}

function notifyUnreadIncrease(previous: number, next: number): void {
  const added = next - previous;
  if (added <= 0) return;

  showNativeNotification({
    title: APP_NAME,
    body:
      added === 1
        ? 'You have a new notification'
        : `You have ${added} new notifications`,
  });
}

export function setupDesktopNotificationHandlers(): void {
  ipcMain.on(IPC_CHANNELS.unreadCount, (event, payload: unknown) => {
    if (!isTrustedSender(event.sender)) return;
    const count = clampCount(payload);
    if (count === null) return;

    applyUnreadBadge(count);

    // The web app already sends this for the dock badge. Talks does not emit a
    // separate notification socket event, so an increase here is the only
    // signal we have without changing Next.js.
    if (lastUnreadCount !== null) {
      notifyUnreadIncrease(lastUnreadCount, count);
    }
    lastUnreadCount = count;
  });

  ipcMain.on(IPC_CHANNELS.showNotification, (event, payload: unknown) => {
    if (!isTrustedSender(event.sender)) return;
    const parsed = parsePayload(payload);
    if (!parsed) return;
    showNativeNotification(parsed);
  });

  logger.debug(`${APP_NAME} desktop notification handlers configured`);
}
