import {
  BrowserWindow,
  HandlerDetails,
  shell,
  WebContents,
} from 'electron';
import {
  classifyUrl,
  deepLinkToAppUrl,
  isAllowedCheckoutNavigation,
  isAllowedMainNavigation,
  isAllowedPopupNavigation,
  isSafeForExternalOpen,
  normalizeUrl,
} from '../shared/url-utils';
import { logger } from './logger';
import {
  getCheckoutWindowOptions,
  getPopupWindowOptions,
  openCheckoutWindow,
  returnCheckoutToApp,
} from './window';

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

function openStripeCheckoutInApp(url: string): void {
  const opened = openCheckoutWindow(url);
  if (!opened) {
    logger.warn(`Checkout window failed; falling back to browser: ${url}`);
    void openExternalSafely(url);
  }
}

function handOffCheckoutIfPossible(webContents: WebContents, url: string): boolean {
  const fromWindow = BrowserWindow.fromWebContents(webContents);
  if (!fromWindow) return false;
  returnCheckoutToApp(url, fromWindow);
  return true;
}

export function setupNavigationHandlers(
  webContents: WebContents,
  options: { isPopup?: boolean; isCheckout?: boolean } = {},
): void {
  const { isPopup = false, isCheckout = false } = options;

  const onTopLevelNavigation = (event: Electron.Event, url: string): void => {
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

    if (classification === 'stripe-checkout') {
      if (isCheckout) return;
      event.preventDefault();
      openStripeCheckoutInApp(url);
      return;
    }

    if (classification === 'primary' && isCheckout) {
      event.preventDefault();
      handOffCheckoutIfPossible(webContents, url);
      return;
    }

    if (classification === 'external-web') {
      if (isCheckout && isAllowedCheckoutNavigation(url)) return;
      event.preventDefault();
      void openExternalSafely(url);
      return;
    }

    const allowed = isPopup ? isAllowedPopupNavigation(url) : isAllowedMainNavigation(url);
    if (!allowed) {
      event.preventDefault();
      logger.info(`Blocked navigation: ${url}`);
    }
  };

  webContents.on('will-navigate', onTopLevelNavigation);

  // Only intercept Stripe entry/exit on redirects. A full navigation policy
  // here would break same-window OAuth (Pynn 302 → accounts.google.com → app).
  webContents.on('will-redirect', (event, url) => {
    const classification = classifyUrl(url);

    if (classification === 'stripe-checkout' && !isCheckout) {
      event.preventDefault();
      openStripeCheckoutInApp(url);
      return;
    }

    if (classification === 'primary' && isCheckout) {
      event.preventDefault();
      handOffCheckoutIfPossible(webContents, url);
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

    if (classification === 'stripe-checkout') {
      if (isCheckout) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: getCheckoutWindowOptions(),
        };
      }
      openStripeCheckoutInApp(url);
      return { action: 'deny' };
    }

    if (classification === 'primary') {
      if (isCheckout) {
        handOffCheckoutIfPossible(webContents, url);
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: getPopupWindowOptions(),
      };
    }

    if (classification === 'external-web') {
      if (isCheckout) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: getCheckoutWindowOptions(),
        };
      }
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
