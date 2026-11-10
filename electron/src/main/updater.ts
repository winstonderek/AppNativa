import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater, type UpdateDownloadedEvent } from 'electron-updater';
import { APP_NAME, GITHUB_UPDATE_OWNER, GITHUB_UPDATE_REPO } from '../shared/constants';
import { isNewerVersion } from '../shared/version';
import { logger, isDevelopment } from './logger';
import { destroyTray } from './tray';
import { isWindowsSetupInstall } from './windows-install';

/**
 * electron-updater reads `latest.yml` (Windows) or `latest-mac.yml` (macOS)
 * from the latest GitHub Release. `app-update.yml` points it at this repo.
 * On Windows the file lists the NSIS setup; a silent reinstall keeps the
 * folder the user chose.
 */
const RELEASES_PAGE_URL = `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest`;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let initialized = false;
let isManualCheck = false;
let checkInProgress = false;
let installingUpdate = false;
let downloadedVersion: string | null = null;

export function isInstallingUpdate(): boolean {
  return installingUpdate;
}

/**
 * quitAndInstall is a no-op on macOS if a tray is open, windows stay alive,
 * or the old process still holds the single-instance lock (the relaunched
 * app then exits immediately). On Windows the NSIS installer also needs the
 * executable unlocked before it can replace the files.
 */
function prepareAppToQuitForUpdate(): void {
  installingUpdate = true;
  app.removeAllListeners('window-all-closed');
  destroyTray();

  for (const window of BrowserWindow.getAllWindows()) {
    window.removeAllListeners('close');
    window.destroy();
  }

  if (app.hasSingleInstanceLock()) {
    app.releaseSingleInstanceLock();
  }
}

/** The portable zip has no uninstaller, so it cannot replace itself. */
function canAutoUpdate(): boolean {
  return process.platform !== 'win32' || isWindowsSetupInstall();
}

function installDownloadedUpdate(): void {
  logger.info(`Installing downloaded update ${downloadedVersion ?? ''}`.trim());
  prepareAppToQuitForUpdate();

  // Wait until the message box is fully dismissed; calling quitAndInstall
  // in the same tick is a known no-op on macOS.
  setImmediate(() => {
    try {
      if (process.platform === 'win32') {
        // Silent NSIS install into the directory chosen at setup, then relaunch.
        autoUpdater.quitAndInstall(true, true);
      } else {
        // quitAndInstall already asks ShipIt to replace the bundle, quit, and
        // relaunch. A following app.quit() or app.exit() kills the process
        // before that handoff, so the app closes and stays on the old version.
        autoUpdater.quitAndInstall(false, true);
      }
    } catch (error) {
      logger.error('quitAndInstall failed', error);
      app.quit();
    }
  });
}

function showRestartDialog(version: string | null): void {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: version
        ? `${APP_NAME} ${version} has been downloaded.`
        : 'A new version has been downloaded.',
      detail: `You are using version ${app.getVersion()}. Restart ${APP_NAME} to apply the update.`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (response !== 0) return;
      installDownloadedUpdate();
    })
    .catch((err) => logger.error('Install dialog failed', err));
}

function showUpToDateDialog(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: 'Updates',
    message: `${APP_NAME} is up to date.`,
    detail: `Version ${app.getVersion()}`,
    noLink: true,
  });
}

function showCheckingDialog(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: 'Updates',
    message: 'Checking for updates…',
    detail: `Version ${app.getVersion()}. You will be notified when the download finishes.`,
    noLink: true,
  });
}

function showManualInstallDialog(): void {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Updates',
      message: `This copy of ${APP_NAME} cannot update itself.`,
      detail: `Version ${app.getVersion()}. Install ${APP_NAME} with Pynn-Setup.exe to get automatic updates.`,
      buttons: ['Download installer', 'Close'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 0) void shell.openExternal(RELEASES_PAGE_URL);
    })
    .catch((err) => logger.error('Manual install dialog failed', err));
}

function handleUpdateNotAvailable(): void {
  checkInProgress = false;
  logger.info('No updates available');
  if (isManualCheck) {
    isManualCheck = false;
    showUpToDateDialog();
  }
}

function handleUpdateDownloaded(version: string | null): void {
  checkInProgress = false;
  if (version && !isNewerVersion(version, app.getVersion())) {
    logger.info(`Already running ${app.getVersion()}; ignoring update ${version}`);
    isManualCheck = false;
    return;
  }
  downloadedVersion = version;
  logger.info(`Update downloaded: ${version ?? 'unknown version'}`);
  isManualCheck = false;
  showRestartDialog(version);
}

function handleUpdateError(error: Error): void {
  checkInProgress = false;
  logger.error('Auto-updater error', error);
  if (isManualCheck) {
    isManualCheck = false;
    dialog.showErrorBox('Update check failed', error.message);
  }
}

function setupElectronUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
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

  autoUpdater.on('update-not-available', handleUpdateNotAvailable);

  autoUpdater.on('download-progress', (progress) => {
    logger.debug(`Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    handleUpdateDownloaded(info.version);
  });

  autoUpdater.on('error', handleUpdateError);
}

function checkForUpdates(): void {
  if (downloadedVersion !== null) {
    if (isManualCheck) {
      isManualCheck = false;
      showRestartDialog(downloadedVersion);
    }
    return;
  }

  if (checkInProgress) {
    if (isManualCheck) showCheckingDialog();
    return;
  }
  checkInProgress = true;

  autoUpdater.checkForUpdates().catch((err: Error) => {
    handleUpdateError(err);
  });
}

function initializeUpdater(): boolean {
  if (isDevelopment()) {
    logger.debug('Auto-updater skipped (development)');
    return false;
  }

  if (!canAutoUpdate()) {
    logger.info('Auto-updater skipped (portable Windows build)');
    return false;
  }

  if (initialized) return true;

  initialized = true;
  setupElectronUpdater();
  return true;
}

export function setupAutoUpdater(): void {
  if (!initializeUpdater()) return;

  setTimeout(() => {
    checkForUpdates();
  }, 10_000);

  setInterval(() => {
    checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
}

export function checkForUpdatesManually(): void {
  if (isDevelopment()) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Updates',
      message: 'Auto-update is disabled in development.',
      detail: `Version ${app.getVersion()}`,
    });
    return;
  }

  if (!canAutoUpdate()) {
    showManualInstallDialog();
    return;
  }

  isManualCheck = true;
  if (!initializeUpdater()) return;
  checkForUpdates();
}
