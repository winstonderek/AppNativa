import { app, dialog, DownloadItem, BrowserWindow, WebContents } from 'electron';
import path from 'node:path';
import { logger } from './logger';

export function setupDownloads(webContents: WebContents): void {
  webContents.session.on('will-download', (_event, item: DownloadItem, wc) => {
    const filename = item.getFilename();
    logger.info(`Download started: ${filename}`);

    const defaultPath = path.join(app.getPath('downloads'), filename);

    item.setSaveDialogOptions({
      title: 'Save file',
      defaultPath,
      buttonLabel: 'Save',
    });

    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        logger.info(`Download completed: ${item.getSavePath()}`);
      } else if (state === 'cancelled') {
        logger.info(`Download cancelled: ${filename}`);
      } else if (state === 'interrupted') {
        logger.error(`Download interrupted: ${filename}`);
        const hostWindow = BrowserWindow.fromWebContents(wc);
        if (hostWindow && !hostWindow.isDestroyed()) {
          dialog
            .showMessageBox(hostWindow, {
              type: 'error',
              title: 'Download failed',
              message: `Could not download "${filename}".`,
              detail: 'The download was interrupted. Please try again.',
            })
            .catch(() => undefined);
        }
      }
    });
  });
}

export function setupSessionDownloads(): void {
  app.on('session-created', (session) => {
    session.on('will-download', (_event, item) => {
      logger.debug(`Session download: ${item.getFilename()}`);
    });
  });
}
