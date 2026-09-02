import { BrowserWindow, WebContents, ipcMain, screen } from 'electron';
import {
  APP_URL,
  IPC_CHANNELS,
  MIN_SPLIT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from '../shared/constants';
import { isPrimaryHost } from '../shared/url-utils';
import { logger } from './logger';
import {
  createAppWindow,
  getMainWindowState,
  getWindowRole,
  setMainWindow,
} from './window';

interface ActiveLayout {
  /** The window where LiveKit connected. Closed when the call ends. */
  callWindow: BrowserWindow;
  /** The window opened alongside it, which survives the call. */
  workspaceWindow: BrowserWindow;
  restoreBounds: Electron.Rectangle;
  wasMaximized: boolean;
  wasFullScreen: boolean;
}

let active: ActiveLayout | null = null;
let entering = false;

function isTrustedSender(contents: WebContents): boolean {
  try {
    return isPrimaryHost(new URL(contents.getURL()).hostname);
  } catch {
    return false;
  }
}

function sendSuppression(window: BrowserWindow, suppressed: boolean): void {
  if (window.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.callsSuppressed, suppressed);
}

function restoreWindow(
  window: BrowserWindow,
  bounds: Electron.Rectangle,
  maximized: boolean,
  fullScreen: boolean,
): void {
  if (window.isDestroyed()) return;

  // Raise the floor back before setting bounds, otherwise the larger minimum wins.
  window.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
  window.setBounds(bounds);

  if (maximized) window.maximize();
  if (fullScreen) window.setFullScreen(true);
}

/**
 * Splits the screen: the window that hosts the call moves to the left half and a
 * fresh workspace window opens on the right so the user can keep working.
 */
function enterCallLayout(callWindow: BrowserWindow): void {
  if (active || entering) return;
  if (callWindow.isDestroyed()) return;

  entering = true;

  const restoreBounds = callWindow.getNormalBounds();
  const wasMaximized = callWindow.isMaximized();
  const wasFullScreen = callWindow.isFullScreen();

  // Do not persist the temporary half-screen geometry as the user's window size.
  getMainWindowState()?.unmanage();

  const applySplit = () => {
    entering = false;
    if (callWindow.isDestroyed()) return;

    const { workArea } = screen.getDisplayMatching(restoreBounds);
    const leftWidth = Math.floor(workArea.width / 2);
    const rightWidth = workArea.width - leftWidth;
    const minHeight = Math.min(MIN_WINDOW_HEIGHT, workArea.height);

    if (callWindow.isMaximized()) callWindow.unmaximize();
    callWindow.setMinimumSize(Math.min(MIN_SPLIT_WINDOW_WIDTH, leftWidth), minHeight);
    callWindow.setBounds({
      x: workArea.x,
      y: workArea.y,
      width: leftWidth,
      height: workArea.height,
    });

    const workspaceWindow = createAppWindow({
      role: 'workspace',
      initialUrl: APP_URL,
      bounds: {
        x: workArea.x + leftWidth,
        y: workArea.y,
        width: rightWidth,
        height: workArea.height,
      },
      minWidth: Math.min(MIN_SPLIT_WINDOW_WIDTH, rightWidth),
      callsSuppressed: true,
      becomeMain: true,
    });

    active = {
      callWindow,
      workspaceWindow,
      restoreBounds,
      wasMaximized,
      wasFullScreen,
    };

    watchLayout(active);
    logger.info('Call layout entered — call window left, workspace window right');
  };

  if (wasFullScreen) {
    // Bounds changes are ignored while a window is full screen, and on macOS the
    // transition is animated, so wait for it to finish.
    callWindow.once('leave-full-screen', applySplit);
    callWindow.once('closed', () => {
      entering = false;
    });
    callWindow.setFullScreen(false);
    return;
  }

  applySplit();
}

function watchLayout(layout: ActiveLayout): void {
  const { callWindow, workspaceWindow } = layout;

  callWindow.once('closed', () => {
    if (active !== layout) return;
    exitCallLayout('call window closed');
  });

  // A reload or navigation destroys the call state without an IPC hang-up.
  callWindow.webContents.once('did-navigate', () => {
    if (active !== layout) return;
    exitCallLayout('call window navigated away');
  });

  callWindow.webContents.once('render-process-gone', () => {
    if (active !== layout) return;
    exitCallLayout('call renderer gone');
  });

  // The user may close the workspace window while still on the call; in that case
  // the call window takes over again instead of being closed later.
  workspaceWindow.once('closed', () => {
    if (active !== layout) return;
    active = null;

    if (callWindow.isDestroyed()) return;
    restoreWindow(callWindow, layout.restoreBounds, layout.wasMaximized, false);
    setMainWindow(callWindow);
    getMainWindowState()?.manage(callWindow);
    logger.info('Workspace window closed during call — call window promoted back');
  });

  // Re-assert suppression across reloads, in both directions.
  workspaceWindow.webContents.on('did-finish-load', () => {
    if (workspaceWindow.isDestroyed()) return;
    sendSuppression(workspaceWindow, active?.workspaceWindow === workspaceWindow);
  });
}

function exitCallLayout(reason: string): void {
  const layout = active;
  if (!layout) return;
  active = null;

  const { callWindow, workspaceWindow, restoreBounds, wasMaximized, wasFullScreen } = layout;

  if (!workspaceWindow.isDestroyed()) {
    restoreWindow(workspaceWindow, restoreBounds, wasMaximized, wasFullScreen);
    setMainWindow(workspaceWindow);
    getMainWindowState()?.manage(workspaceWindow);
    sendSuppression(workspaceWindow, false);
    workspaceWindow.focus();
  }

  if (!callWindow.isDestroyed()) {
    callWindow.close();
  }

  logger.info(`Call layout exited: ${reason}`);
}

export function setupCallLayoutHandlers(): void {
  ipcMain.on(IPC_CHANNELS.callConnected, (event) => {
    if (!isTrustedSender(event.sender)) return;

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    // The workspace window must never host a call, so it can never start a split.
    if (getWindowRole(window) === 'workspace') {
      logger.warn('Ignored call-connected from the workspace window');
      return;
    }

    enterCallLayout(window);
  });

  ipcMain.on(IPC_CHANNELS.callEnded, (event) => {
    if (!isTrustedSender(event.sender)) return;
    if (!active) return;

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window !== active.callWindow) return;

    exitCallLayout('call ended');
  });

  logger.debug('Call layout handlers configured');
}
