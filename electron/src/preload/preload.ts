import { contextBridge, ipcRenderer } from 'electron';
import type { WindowRole } from '../shared/constants';

/**
 * Sandboxed preload scripts cannot `require` relative files — Electron replaces
 * `require` with a polyfill that only resolves a handful of built-in modules.
 * Any import here that survives compilation aborts the whole script and silently
 * exposes nothing, so these values are inlined on purpose.
 *
 * Keep in sync with APP_NAME, IPC_CHANNELS and ARG_PREFIXES in ../shared/constants.
 * Type-only imports are erased by tsc and are safe.
 */
const APP_NAME = 'Pynn';

const CHANNEL_CALL_OPEN = 'pynn:call-open';
const CHANNEL_CALL_GET_PENDING = 'pynn:call-get-pending';
const CHANNEL_CALL_CONNECTED = 'pynn:call-connected';
const CHANNEL_CALL_ENDED = 'pynn:call-ended';
const CHANNEL_CALLS_SUPPRESSED = 'pynn:calls-suppressed';
const CHANNEL_UNREAD_COUNT = 'pynn:unread-count';
const CHANNEL_SHOW_NOTIFICATION = 'pynn:show-notification';

const ARG_WINDOW_ROLE = '--pynn-window-role=';
const ARG_APP_VERSION = '--pynn-app-version=';
const ARG_CALLS_SUPPRESSED = '--pynn-calls-suppressed=';

function readArg(prefix: string): string | null {
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const windowRole = (readArg(ARG_WINDOW_ROLE) ?? 'main') as WindowRole;
const appVersion = readArg(ARG_APP_VERSION) ?? '';

let callsSuppressed = readArg(ARG_CALLS_SUPPRESSED) === 'true';
const suppressionListeners = new Set<(suppressed: boolean) => void>();

ipcRenderer.on(CHANNEL_CALLS_SUPPRESSED, (_event, suppressed: boolean) => {
  callsSuppressed = Boolean(suppressed);
  for (const listener of suppressionListeners) {
    try {
      listener(callsSuppressed);
    } catch {
      // A failing web listener must not break the bridge.
    }
  }
});

/**
 * Minimal preload — remote web content must not access Node.js.
 * Only expose non-sensitive desktop metadata and the call-layout signals.
 */
contextBridge.exposeInMainWorld('pynnDesktop', {
  platform: process.platform,
  appName: APP_NAME,
  isDesktopApp: true,
  version: appVersion,
  windowRole,

  /** True while another window of this app owns the active call. */
  areCallsSuppressed: () => callsSuppressed,

  onCallsSuppressedChange: (listener: (suppressed: boolean) => void) => {
    suppressionListeners.add(listener);
    return () => {
      suppressionListeners.delete(listener);
    };
  },

  /**
   * Ask the shell to open a floating call window (50% × 75% of the work area)
   * and hand this LiveKit session to it. The current window stays put.
   */
  openCallWindow: (session: unknown) => ipcRenderer.invoke(CHANNEL_CALL_OPEN, session),

  /** Call window only: consume the session the workspace window just handed over. */
  getPendingCall: () => ipcRenderer.invoke(CHANNEL_CALL_GET_PENDING),

  /** Legacy in-place signal. Newer builds use openCallWindow instead. */
  notifyCallConnected: () => ipcRenderer.send(CHANNEL_CALL_CONNECTED),

  /** The call is over: close the floating call window. */
  notifyCallEnded: () => ipcRenderer.send(CHANNEL_CALL_ENDED),

  /** Unread in-app notification count for the dock / taskbar badge. */
  setUnreadCount: (count: number) => ipcRenderer.send(CHANNEL_UNREAD_COUNT, count),

  /**
   * Ask the shell to show a native OS notification. Main skips it when a
   * Pynn window is focused.
   */
  showNotification: (payload: unknown) => ipcRenderer.send(CHANNEL_SHOW_NOTIFICATION, payload),
});

// Consumed by the web app's isDesktopApp()/getDesktopAppInfo() helpers.
contextBridge.exposeInMainWorld('__PYNN_DESKTOP__', {
  version: appVersion,
  platform: process.platform,
});

export {};
