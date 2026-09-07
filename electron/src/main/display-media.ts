import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
  systemPreferences,
  webContents,
  type DesktopCapturerSource,
  type IpcMainEvent,
} from 'electron';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/constants';
import { isPrimaryHost } from '../shared/url-utils';
import { logger } from './logger';

export interface ScreenPickerSourceDTO {
  id: string;
  name: string;
  displayType: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
}

interface ScreenPickerPayload {
  sources: ScreenPickerSourceDTO[];
  screenAccess: 'granted' | 'denied' | 'restricted' | 'unknown' | 'not-determined';
}

let pickerOpen = false;

function isTrustedOrigin(origin: string): boolean {
  try {
    return isPrimaryHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function windowFromRequest(request: { frame?: Electron.WebFrameMain | null }): BrowserWindow | null {
  try {
    if (request.frame) {
      const contents = webContents.fromFrame(request.frame);
      if (contents) {
        const fromFrame = BrowserWindow.fromWebContents(contents);
        if (fromFrame && !fromFrame.isDestroyed()) return fromFrame;
      }
    }
  } catch {
    // The requesting frame may already have gone away.
  }

  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
}

function screenAccessStatus(): ScreenPickerPayload['screenAccess'] {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

function toPickerSource(source: DesktopCapturerSource): ScreenPickerSourceDTO {
  const displayType = source.id.startsWith('screen:') ? 'screen' : 'window';
  return {
    id: source.id,
    name: source.name || (displayType === 'screen' ? 'Screen' : 'Window'),
    displayType,
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  };
}

function isInternalPickerSource(source: DesktopCapturerSource): boolean {
  const name = source.name;
  return (
    name === 'Share screen' ||
    name.startsWith('DevTools') ||
    name.includes('screen-picker')
  );
}

async function listCapturableSources(): Promise<DesktopCapturerSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources.filter((source) => !isInternalPickerSource(source));
}

function openScreenRecordingSettings(): void {
  if (process.platform !== 'darwin') return;
  void shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  );
}

function pickDisplaySource(parent: BrowserWindow | null): Promise<string | null> {
  if (pickerOpen) return Promise.resolve(null);
  pickerOpen = true;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (sourceId: string | null) => {
      if (settled) return;
      settled = true;
      pickerOpen = false;
      ipcCleanup();
      if (!picker.isDestroyed()) picker.close();
      resolve(sourceId);
    };

    const picker = new BrowserWindow({
      width: 760,
      height: 580,
      minWidth: 560,
      minHeight: 420,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: false,
      alwaysOnTop: true,
      title: 'Share screen',
      backgroundColor: '#0f172a',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'screen-picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });

    const onResult = (event: IpcMainEvent, sourceId: unknown) => {
      if (event.sender !== picker.webContents) return;
      finish(typeof sourceId === 'string' && sourceId.length > 0 ? sourceId : null);
    };

    const ipcCleanup = () => {
      ipcMain.removeListener(IPC_CHANNELS.screenPickerResult, onResult);
    };

    ipcMain.on(IPC_CHANNELS.screenPickerResult, onResult);

    picker.on('closed', () => {
      finish(null);
    });

    picker.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const sendSources = async () => {
      try {
        const sources = await listCapturableSources();
        const payload: ScreenPickerPayload = {
          sources: sources.map(toPickerSource),
          screenAccess: screenAccessStatus(),
        };
        if (picker.isDestroyed()) return;
        picker.webContents.send(IPC_CHANNELS.screenPickerSources, payload);
      } catch (error) {
        logger.error('Failed to list screen sources', error);
        if (!picker.isDestroyed()) {
          picker.webContents.send(IPC_CHANNELS.screenPickerSources, {
            sources: [],
            screenAccess: screenAccessStatus(),
          } satisfies ScreenPickerPayload);
        }
      }
    };

    picker.once('ready-to-show', () => {
      if (picker.isDestroyed()) return;
      picker.setAlwaysOnTop(true, 'pop-up-menu');
      picker.show();
      picker.focus();
    });

    picker.on('focus', () => {
      if (screenAccessStatus() !== 'granted') {
        void sendSources();
      }
    });

    picker.webContents.once('did-finish-load', () => {
      void sendSources();
    });

    picker.webContents.ipc.handle('pynn:open-screen-settings', () => {
      openScreenRecordingSettings();
    });

    picker
      .loadFile(path.join(__dirname, '..', 'static', 'screen-picker.html'))
      .catch((error) => {
        logger.error('Failed to load screen picker', error);
        finish(null);
      });
  });
}

export function setupDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      void (async () => {
        try {
          if (!isTrustedOrigin(request.securityOrigin)) {
            logger.info(`Display media denied for ${request.securityOrigin}`);
            callback({});
            return;
          }

          const parent = windowFromRequest(request);
          const sourceId = await pickDisplaySource(parent);
          if (!sourceId) {
            logger.debug('Screen share cancelled by user');
            callback({});
            return;
          }

          const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 1, height: 1 },
          });
          const chosen = sources.find((source) => source.id === sourceId);
          if (!chosen) {
            logger.warn(`Chosen screen source disappeared: ${sourceId}`);
            callback({});
            return;
          }

          logger.info(`Screen share granted: ${chosen.name}`);
          callback({
            video: chosen,
            audio: request.audioRequested ? 'loopback' : undefined,
          });
        } catch (error) {
          logger.error('Display media request failed', error);
          callback({});
        }
      })();
    },
  );

  logger.debug('Display media handler configured');
}
