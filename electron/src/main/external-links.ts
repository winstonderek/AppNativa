import {
  BrowserWindow,
  HandlerDetails,
  shell,
  WebContents,
} from 'electron';
import {
  classifyUrl,
  deepLinkToAppUrl,
  isAllowedMainNavigation,
  isAllowedPopupNavigation,
  isSafeForExternalOpen,
  normalizeUrl,
} from '../shared/url-utils';
import { logger } from './logger';
import { getPopupWindowOptions } from './window';

export async function openExternalSafely(url: string): Promise<boolean> {
  const normalized = normalizeUrl(url);
  if (!isSafeForExternalOpen(normalized)) {
    logger.warn(`Blocked external open: ${normalized}`);
    return false;
  }

  try {
    await shell.openExternal(normalized);
    logger.debug(`Opened externally: ${normalized}`);
    return true;
  } catch (error) {
    logger.error('Failed to open external URL', error);
    return false;
  }
}

export function setupNavigationHandlers(
  webContents: WebContents,
  options: { isPopup?: boolean } = {},
): void {
  const { isPopup = false } = options;

  webContents.on('will-navigate', (event, url) => {
    const classification = classifyUrl(url);

    if (classification === 'deep-link') {
      event.preventDefault();
      const target = deepLinkToAppUrl(url);
      webContents.loadURL(target).catch((err) => logger.error('Deep link navigation failed', err));
      return;
    }

    if (classification === 'external-protocol') {
      event.preventDefault();
      void openExternalSafely(url);
      return;
    }

    if (classification === 'external-web') {
      event.preventDefault();
      void openExternalSafely(url);
      return;
    }

    const allowed = isPopup ? isAllowedPopupNavigation(url) : isAllowedMainNavigation(url);
    if (!allowed) {
      event.preventDefault();
      logger.info(`Blocked navigation: ${url}`);
    }
  });

  webContents.setWindowOpenHandler((details: HandlerDetails) => {
    const url = details.url;
    const classification = classifyUrl(url);

    if (classification === 'blocked') {
      logger.warn(`Blocked window.open: ${url}`);
      return { action: 'deny' };
    }

    if (classification === 'external-protocol') {
      void openExternalSafely(url);
      return { action: 'deny' };
    }

    if (classification === 'deep-link') {
      const target = deepLinkToAppUrl(url);
      webContents.loadURL(target).catch((err) => logger.error('Deep link load failed', err));
      return { action: 'deny' };
    }

    if (classification === 'primary') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: getPopupWindowOptions(),
      };
    }

    if (classification === 'external-web') {
      void openExternalSafely(url);
      return { action: 'deny' };
    }

    return { action: 'deny' };
  });
}

export function setupExternalLinkHandlers(window: BrowserWindow): void {
  window.webContents.on('did-create-window', (childWindow, details) => {
    logger.debug(`Child window created: ${details.url}`);
    setupNavigationHandlers(childWindow.webContents, { isPopup: true });
  });
}
