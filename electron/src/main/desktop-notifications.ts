import { BrowserWindow, Notification, app, ipcMain } from 'electron';
import Store from 'electron-store';
import { APP_NAME, IPC_CHANNELS } from '../shared/constants';
import { isAllowedMainNavigation, isPrimaryHost, resolveInAppNotificationUrl } from '../shared/url-utils';
import { logger } from './logger';
import { focusMainWindow, getMainWindow } from './window';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 280;

interface DesktopNotificationPayload {
  title: string;
  body?: string;
  url?: string;
}

interface NotificationPrefs {
  registeredWithSystem: boolean;
}

const prefs = new Store<NotificationPrefs>({
  name: 'notifications',
  defaults: {
    registeredWithSystem: false,
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

  app.setBadgeCount(count > 0 ? Math.min(count, 99) : 0);
}

export function clearUnreadBadge(): void {
  applyUnreadBadge(0);
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
  const notification = new Notification({
    title: payload.title,
    body: payload.body ?? '',
    silent: false,
    timeoutType: 'default',
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
 * Posts one native notification so macOS creates the Pynn row in
 * System Settings → Notifications. Safe to call every launch; only the
 * first successful registration is persisted.
 */
export function registerDesktopNotifications(): void {
  if (!Notification.isSupported()) {
    logger.warn('Cannot register notifications — API not supported');
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
