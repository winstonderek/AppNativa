import { autoUpdater } from 'electron-updater';
import { dialog } from 'electron';
import { APP_NAME } from '../shared/constants';
import { logger, isDevelopment } from './logger';

let initialized = false;

export function setupAutoUpdater(): void {
  if (initialized || isDevelopment()) {
    logger.debug('Auto-updater skipped (development or already initialized)');
    return;
  }

  initialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => logger.info(String(message)),
    warn: (message) => logger.warn(String(message)),
    error: (message) => logger.error(String(message)),
    debug: (message) => logger.debug(String(message)),
  };

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for updates…');
  });

  autoUpdater.on('update-available', (info) => {
    logger.info(`Update available: ${info.version}`);
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update available',
        message: `${APP_NAME} ${info.version} is available.`,
        detail: 'Would you like to download it now?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          void autoUpdater.downloadUpdate();
        }
      })
      .catch((err) => logger.error('Update dialog failed', err));
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('No updates available');
  });

  autoUpdater.on('download-progress', (progress) => {
    logger.debug(`Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`Update downloaded: ${info.version}`);
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: 'A new version has been downloaded.',
        detail: `Restart ${APP_NAME} to apply the update.`,
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      })
      .catch((err) => logger.error('Install dialog failed', err));
  });

  autoUpdater.on('error', (error) => {
    logger.error('Auto-updater error', error);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.warn('Update check failed (publisher may not be configured yet)', err.message);
    });
  }, 10_000);
}

export function checkForUpdatesManually(): void {
  if (isDevelopment()) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Updates',
      message: 'Auto-update is disabled in development.',
    });
    return;
  }

  autoUpdater.checkForUpdates().catch((err) => {
    dialog.showErrorBox('Update check failed', err.message);
  });
}
