import { BrowserWindow, Notification, app, ipcMain, shell } from 'electron';
import Store from 'electron-store';
import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME, IPC_CHANNELS, WINDOWS_SQUIRREL_APP_ID } from '../shared/constants';
import { isAllowedMainNavigation, isPrimaryHost, resolveInAppNotificationUrl } from '../shared/url-utils';
import { logger } from './logger';
import { focusMainWindow, getMainWindow } from './window';
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

function getSquirrelUpdateExe(): string | null {
  if (process.platform !== 'win32') return null;
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  return fs.existsSync(updateExe) ? updateExe : null;
}

/** Identity Windows uses to match toasts to the Start Menu shortcut. */
export function getWindowsAppUserModelId(): string {
  if (!app.isPackaged) {
    return process.execPath;
  }
  return WINDOWS_SQUIRREL_APP_ID;
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

/**
 * Windows toasts only appear when a Start Menu shortcut exists with the same
 * AppUserModelID (and ToastActivatorCLSID) as the running process. Squirrel
 * writes one on install; ZIP / older installs may not have a matching one.
 */
function ensureWindowsStartMenuShortcut(aumid: string): void {
  const shortcutPath = getStartMenuShortcutPath();
  const updateExe = getSquirrelUpdateExe();
  const fallbackTarget = updateExe ?? process.execPath;
  const icon = getNotificationIconPath();
  const clsid = (app as Electron.App & { toastActivatorCLSID?: string }).toastActivatorCLSID;

  const next: Electron.ShortcutDetails = {
    target: fallbackTarget,
    cwd: path.dirname(fallbackTarget),
    description: APP_NAME,
    appUserModelId: aumid,
    ...(icon ? { icon, iconIndex: 0 } : {}),
    ...(clsid ? { toastActivatorClsid: clsid } : {}),
  };

  try {
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });

    if (fs.existsSync(shortcutPath)) {
      try {
        const current = shell.readShortcutLink(shortcutPath);
        const sameId = current.appUserModelId === aumid;
        const sameClsid = !clsid || current.toastActivatorClsid === clsid;
        if (sameId && sameClsid) {
          logger.debug(`Windows notification shortcut already registered: ${aumid}`);
          return;
        }
        if (current.target) {
          next.target = current.target;
          next.cwd = current.cwd || path.dirname(current.target);
        }
        if (current.args) next.args = current.args;
      } catch {
        logger.debug('Existing Start Menu shortcut could not be read; replacing it');
      }

      if (!shell.writeShortcutLink(shortcutPath, 'replace', next)) {
        throw new Error('writeShortcutLink(replace) returned false');
      }
    } else if (!shell.writeShortcutLink(shortcutPath, 'create', next)) {
      throw new Error('writeShortcutLink(create) returned false');
    }

    logger.info(`Windows notification shortcut ready (${aumid})`);
  } catch (error) {
    logger.warn('Failed to register Windows notification shortcut', error);
  }
}

/**
 * After `ready`: keep AUMID set and make sure the Start Menu shortcut matches.
 * Safe to call on every launch.
 */
export function applyWindowsNotificationIdentity(): void {
  if (process.platform !== 'win32') return;
  applyWindowsAppUserModelId();
  ensureWindowsStartMenuShortcut(getWindowsAppUserModelId());
}

function focusAndNavigate(url: string | null): void {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (url && isAllowedMainNavigation(url) && window.webContents.getURL() !== url) {
      window.webContents.loadURL(url).catch((err) => {
        logger.error('Failed to open notification URL', err);
      });
    }
    return;
  }

  focusMainWindow();
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

  notification.on('failed', (_event, error) => {
    logger.error(`Native notification failed: ${error}`);
  });

  notification.on('click', () => {
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
