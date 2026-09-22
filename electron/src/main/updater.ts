import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, autoUpdater as squirrelUpdater, BrowserWindow, dialog } from 'electron';
import { autoUpdater, type UpdateDownloadedEvent } from 'electron-updater';
import {
  APP_NAME,
  GITHUB_UPDATE_OWNER,
  GITHUB_UPDATE_REPO,
  WINDOWS_SQUIRREL_EXE_NAME,
  WINDOWS_SQUIRREL_PACKAGE_ID,
} from '../shared/constants';
import { isNewerVersion } from '../shared/version';
import { logger, isDevelopment } from './logger';
import { isSquirrelInstall } from './squirrel';
import { destroyTray } from './tray';

const GITHUB_LATEST_DOWNLOAD_URL = `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest/download`;

let initialized = false;
let isManualCheck = false;
let installingUpdate = false;
let windowsSetupSpawned = false;
let pendingWindowsSetup: { version: string; filePath: string } | null = null;

const WINDOWS_SETUP_MARKER = 'windows-setup-launched.json';

export function isInstallingUpdate(): boolean {
  return installingUpdate;
}

/**
 * quitAndInstall is a no-op on macOS if a tray is open, windows stay alive,
 * or the old process still holds the single-instance lock (the relaunched
 * app then exits immediately).
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

function spawnDetached(exe: string, args: string[]): void {
  const child = spawn(exe, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function windowsSetupMarkerPath(): string {
  return path.join(app.getPath('userData'), WINDOWS_SETUP_MARKER);
}

function setupAlreadyLaunched(version: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(windowsSetupMarkerPath(), 'utf8')) as {
      version?: string;
    };
    return parsed.version === version;
  } catch {
    return false;
  }
}

function markSetupLaunched(version: string): void {
  try {
    const file = windowsSetupMarkerPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version }));
  } catch (error) {
    logger.warn('Could not record Windows setup launch', error);
  }
}

/**
 * latest.yml points at Squirrel's Setup.exe. electron-updater launches that
 * file with NSIS flags, which this installer ignores, so the running copy
 * never changes version and the prompt returns on the next launch.
 */
function launchPendingWindowsSetup(force: boolean): void {
  if (!pendingWindowsSetup || windowsSetupSpawned) return;
  if (!force && setupAlreadyLaunched(pendingWindowsSetup.version)) return;
  if (!fs.existsSync(pendingWindowsSetup.filePath)) return;

  windowsSetupSpawned = true;
  spawnDetached(pendingWindowsSetup.filePath, []);
  markSetupLaunched(pendingWindowsSetup.version);
  logger.info(`Started Windows installer for ${pendingWindowsSetup.version}`);
}

function newestInstalledVersion(root: string): string | null {
  let newest: string | null = null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^app-/i.test(entry.name)) continue;
    const version = entry.name.replace(/^app-/i, '');
    if (!newest || isNewerVersion(version, newest)) newest = version;
  }
  return newest;
}

function squirrelInstallRoot(): string | null {
  if (process.platform !== 'win32' || !app.isPackaged) return null;

  if (isSquirrelInstall()) {
    return path.resolve(path.dirname(process.execPath), '..');
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const root = path.join(localAppData, WINDOWS_SQUIRREL_PACKAGE_ID);
  return fs.existsSync(path.join(root, 'Update.exe')) ? root : null;
}

/**
 * Squirrel keeps every version in its own app-* folder. Shortcuts and the
 * portable zip keep launching the old folder, so the update prompt returns
 * even though the new build is already installed. Start the newest one instead.
 */
export function handoffToUpdatedWindowsInstall(): boolean {
  const root = squirrelInstallRoot();
  if (!root) return false;

  const newest = newestInstalledVersion(root);
  if (!newest || !isNewerVersion(newest, app.getVersion())) return false;

  const installedExe = path.join(root, `app-${newest}`, `${WINDOWS_SQUIRREL_EXE_NAME}.exe`);
  const updateExe = path.join(root, 'Update.exe');
  if (!fs.existsSync(installedExe) || !fs.existsSync(updateExe)) return false;

  logger.info(`Opening installed ${APP_NAME} ${newest} instead of ${app.getVersion()}`);
  spawnDetached(updateExe, ['--processStart', WINDOWS_SQUIRREL_EXE_NAME]);
  setImmediate(() => {
    app.quit();
  });
  return true;
}

function installDownloadedUpdate(): void {
  logger.info('Installing downloaded update');
  prepareAppToQuitForUpdate();

  // Wait until the message box is fully dismissed; calling quitAndInstall
  // in the same tick is a known no-op on macOS.
  setImmediate(() => {
    try {
      if (process.platform === 'win32' && isSquirrelInstall()) {
        // quitAndInstall uses --processStartAndWait, which dies with this process.
        const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
        spawnDetached(updateExe, ['--processStart', path.basename(process.execPath)]);
      } else if (process.platform === 'win32') {
        launchPendingWindowsSetup(true);
      } else {
        autoUpdater.quitAndInstall(false, true);
      }
    } catch (error) {
      logger.error('quitAndInstall failed', error);
    }

    app.quit();

    if (process.platform !== 'darwin') return;

    const forceExit = setTimeout(() => {
      logger.warn('Update install did not quit in time; forcing exit');
      app.exit(0);
    }, 1500);

    app.once('will-quit', () => clearTimeout(forceExit));
  });
}

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
      installDownloadedUpdate();
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

  squirrelUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    const version = typeof releaseName === 'string' ? releaseName : undefined;
    if (version && !isNewerVersion(version, app.getVersion())) {
      logger.info(`Already running ${app.getVersion()}; ignoring Squirrel update ${version}`);
      isManualCheck = false;
      return;
    }
    logger.info(`Squirrel update downloaded${version ? `: ${version}` : ''}`);
    isManualCheck = false;
    showRestartDialog(version);
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
  // Windows artifacts are Squirrel setup files, not NSIS. Silent install-on-quit
  // passes NSIS flags and leaves the old app in place.
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'win32';
  if (process.platform === 'win32') {
    app.on('before-quit', () => {
      if (installingUpdate || isSquirrelInstall()) return;
      launchPendingWindowsSetup(false);
    });
  }
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

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    if (!isNewerVersion(info.version, app.getVersion())) {
      logger.info(`Already running ${app.getVersion()}; ignoring update ${info.version}`);
      isManualCheck = false;
      return;
    }
    if (process.platform === 'win32' && info.downloadedFile) {
      pendingWindowsSetup = { version: info.version, filePath: info.downloadedFile };
    }
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
