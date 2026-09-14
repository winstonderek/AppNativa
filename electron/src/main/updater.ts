import { autoUpdater as squirrelUpdater, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import {
  APP_NAME,
  GITHUB_UPDATE_OWNER,
  GITHUB_UPDATE_REPO,
} from '../shared/constants';
import { logger, isDevelopment } from './logger';
import { isSquirrelInstall } from './squirrel';

const GITHUB_LATEST_DOWNLOAD_URL = `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest/download`;

let initialized = false;
let isManualCheck = false;

function showRestartDialog(version?: string): void {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: version
        ? `${APP_NAME} ${version} has been downloaded.`
        : 'A new version has been downloaded.',
      detail: `Restart ${APP_NAME} to apply the update.`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response !== 0) return;
      if (isSquirrelInstall()) {
        squirrelUpdater.quitAndInstall();
        return;
      }
      autoUpdater.quitAndInstall();
    })
    .catch((err) => logger.error('Install dialog failed', err));
}

function showUpToDateDialog(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: 'Updates',
    message: `${APP_NAME} is up to date.`,
  });
}

function setupSquirrelUpdater(): void {
  squirrelUpdater.setFeedURL({ url: GITHUB_LATEST_DOWNLOAD_URL });

  squirrelUpdater.on('checking-for-update', () => {
    logger.info('Checking for updates (Squirrel)…');
  });

  squirrelUpdater.on('update-available', () => {
    logger.info('Squirrel update available, downloading…');
  });

  squirrelUpdater.on('update-not-available', () => {
    logger.info('No updates available');
    if (isManualCheck) {
      isManualCheck = false;
      showUpToDateDialog();
    }
  });

  squirrelUpdater.on('update-downloaded', () => {
    logger.info('Squirrel update downloaded');
    isManualCheck = false;
    showRestartDialog();
  });

  squirrelUpdater.on('error', (error) => {
    logger.error('Squirrel auto-updater error', error);
    if (isManualCheck) {
      isManualCheck = false;
      dialog.showErrorBox('Update check failed', error.message);
    }
  });
}

function setupElectronUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => logger.info(String(message)),
    warn: (message) => logger.warn(String(message)),
    error: (message) => logger.error(String(message)),
    debug: (message) => logger.debug(String(message)),
  };

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_UPDATE_OWNER,
    repo: GITHUB_UPDATE_REPO,
  });

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for updates…');
  });

  autoUpdater.on('update-available', (info) => {
    logger.info(`Update available: ${info.version} (downloading)`);
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('No updates available');
    if (isManualCheck) {
      isManualCheck = false;
      showUpToDateDialog();
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    logger.debug(`Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`Update downloaded: ${info.version}`);
    isManualCheck = false;
    showRestartDialog(info.version);
  });

  autoUpdater.on('error', (error) => {
    logger.error('Auto-updater error', error);
    if (isManualCheck) {
      isManualCheck = false;
      dialog.showErrorBox('Update check failed', error.message);
    }
  });
}

function checkForUpdates(): void {
  if (isSquirrelInstall()) {
    squirrelUpdater.checkForUpdates();
    return;
  }

  autoUpdater.checkForUpdates().catch((err) => {
    logger.warn('Update check failed', err.message);
    if (isManualCheck) {
      isManualCheck = false;
      dialog.showErrorBox('Update check failed', err.message);
    }
  });
}

function initializeUpdater(): boolean {
  if (isDevelopment()) {
    logger.debug('Auto-updater skipped (development)');
    return false;
  }

  if (initialized) return true;

  initialized = true;
  if (isSquirrelInstall()) {
    setupSquirrelUpdater();
  } else {
    setupElectronUpdater();
  }
  return true;
}

export function setupAutoUpdater(): void {
  if (!initializeUpdater()) return;

  setTimeout(() => {
    checkForUpdates();
  }, 10_000);
}

export function checkForUpdatesManually(): void {
  if (isDevelopment()) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Updates',
      message: 'Auto-update is disabled in development.',
    });
    return;
  }

  isManualCheck = true;
  if (!initializeUpdater()) return;
  checkForUpdates();
}
