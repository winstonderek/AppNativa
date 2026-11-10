import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * electron-builder writes this next to pynn.exe (executableName in
 * electron-builder.config.cjs). The portable zip has no uninstaller, so only
 * a copy installed by Pynn-Setup.exe can update itself.
 */
const WINDOWS_UNINSTALLER_NAME = 'Uninstall pynn.exe';

export function isWindowsSetupInstall(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  const uninstaller = path.join(path.dirname(process.execPath), WINDOWS_UNINSTALLER_NAME);
  return fs.existsSync(uninstaller);
}
