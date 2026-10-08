import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload for the macOS window toolbar.
 * Channel names stay inlined — sandboxed preloads cannot require sibling files.
 */
const CHANNEL_STATE = 'pynn:toolbar-state';
const CHANNEL_BACK = 'pynn:toolbar-back';
const CHANNEL_FORWARD = 'pynn:toolbar-forward';
const CHANNEL_RELOAD = 'pynn:toolbar-reload';
const CHANNEL_NEW_WINDOW = 'pynn:toolbar-new-window';

export interface ToolbarState {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

contextBridge.exposeInMainWorld('pynnToolbar', {
  onState: (listener: (state: ToolbarState) => void) => {
    const handler = (_event: unknown, state: ToolbarState) => listener(state);
    ipcRenderer.on(CHANNEL_STATE, handler);
  },
  back: () => ipcRenderer.send(CHANNEL_BACK),
  forward: () => ipcRenderer.send(CHANNEL_FORWARD),
  reload: () => ipcRenderer.send(CHANNEL_RELOAD),
  newWindow: () => ipcRenderer.send(CHANNEL_NEW_WINDOW),
});
