import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { logger } from './logger';

function getUpdateExePath(): string {
  return path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
}

export function isSquirrelInstall(): boolean {
  return process.platform === 'win32' && fs.existsSync(getUpdateExePath());
}

function runUpdateExe(args: string[]): void {
  const updateExe = getUpdateExePath();
  if (!fs.existsSync(updateExe)) {
    logger.warn(`Squirrel Update.exe not found at ${updateExe}`);
    return;
  }

  const child = spawn(updateExe, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

/**
 * Squirrel.Windows relaunches the app on install/update/uninstall with a
 * `--squirrel-*` flag. Those runs must create or remove Start Menu shortcuts
 * (required for Windows toast notifications) and then quit.
 *
 * @returns true when this process should stop starting the UI.
 */
export function handleSquirrelWindowsEvents(): boolean {
  if (process.platform !== 'win32') return false;

  const squirrelEvent = process.argv[1];
  if (!squirrelEvent?.startsWith('--squirrel')) return false;

  const exeName = path.basename(process.execPath);

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdateExe([`--createShortcut=${exeName}`]);
      setTimeout(() => app.quit(), 1000);
      return true;
    case '--squirrel-uninstall':
      runUpdateExe([`--removeShortcut=${exeName}`]);
      setTimeout(() => app.quit(), 1000);
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
}
