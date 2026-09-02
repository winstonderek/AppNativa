import {
  app,
  BrowserWindow,
  nativeTheme,
  powerMonitor,
  session,
} from 'electron';
import { APP_ID, APP_NAME, PROTOCOL_SCHEME } from '../shared/constants';
import { applyLaunchAtStartupSetting } from './auto-start';
import { setupCallLayoutHandlers } from './call-layout';
import { consumePendingDeepLinks, handleDeepLink, setupDeepLinkHandlers } from './deep-links';
import { setupSessionDownloads } from './downloads';
import { logger } from './logger';
import { setupPermissions } from './permissions';
import { setupTray } from './tray';
import { setupAutoUpdater } from './updater';
import {
  buildApplicationMenu,
  createMainWindow,
  focusMainWindow,
} from './window';

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
    if (deepLink) {
      handleDeepLink(deepLink);
    }
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    app.setAppUserModelId(APP_ID);

    if (process.platform === 'darwin') {
      // Keep the native title bar (traffic lights area) in light/white chrome on macOS.
      nativeTheme.themeSource = 'light';
    }

    setupDeepLinkHandlers();
    setupPermissions();
    setupSessionDownloads();
    setupCallLayoutHandlers();
    applyLaunchAtStartupSetting();
    buildApplicationMenu();

    session.defaultSession.setSpellCheckerEnabled(true);

    nativeTheme.on('updated', () => {
      logger.debug(`System theme changed: ${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}`);
    });

    powerMonitor.on('resume', () => {
      logger.debug('System resumed from sleep');
    });

    powerMonitor.on('suspend', () => {
      logger.debug('System suspending');
    });

    const pendingUrl = consumePendingDeepLinks();
    createMainWindow(pendingUrl);

    setupTray();
    setupAutoUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        focusMainWindow();
      }
    });

    logger.info(`${APP_NAME} started`);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    logger.debug('Application quitting');
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      logger.warn('Blocked webview attachment');
    });
  });
}
