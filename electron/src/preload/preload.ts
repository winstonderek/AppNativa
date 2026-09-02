import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_NAME,
  ARG_PREFIXES,
  IPC_CHANNELS,
  type WindowRole,
} from '../shared/constants';

function readArg(prefix: string): string | null {
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const windowRole = (readArg(ARG_PREFIXES.windowRole) ?? 'main') as WindowRole;
const appVersion = readArg(ARG_PREFIXES.appVersion) ?? '';

let callsSuppressed = readArg(ARG_PREFIXES.callsSuppressed) === 'true';
const suppressionListeners = new Set<(suppressed: boolean) => void>();

ipcRenderer.on(IPC_CHANNELS.callsSuppressed, (_event, suppressed: boolean) => {
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

  /** Media is flowing: ask the shell to move this window aside and open a workspace window. */
  notifyCallConnected: () => ipcRenderer.send(IPC_CHANNELS.callConnected),

  /** The call is over: ask the shell to close this window and restore the workspace window. */
  notifyCallEnded: () => ipcRenderer.send(IPC_CHANNELS.callEnded),
});

// Consumed by the web app's isDesktopApp()/getDesktopAppInfo() helpers.
contextBridge.exposeInMainWorld('__PYNN_DESKTOP__', {
  version: appVersion,
  platform: process.platform,
});

export {};
