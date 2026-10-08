import { contextBridge, ipcRenderer, webFrame } from 'electron';
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
const CHANNEL_TALKS_OPEN = 'pynn:talks-open';
const CHANNEL_UNREAD_COUNT = 'pynn:unread-count';
const CHANNEL_SHOW_NOTIFICATION = 'pynn:show-notification';
const CHANNEL_JS_ALERT = 'pynn:js-alert';
const CHANNEL_JS_CONFIRM = 'pynn:js-confirm';
const CHANNEL_JS_PROMPT_OPEN = 'pynn:js-prompt-open';
const CHANNEL_JS_PROMPT_POLL = 'pynn:js-prompt-poll';
const CHANNEL_OPEN_EXTERNAL = 'pynn:open-external';

const ARG_WINDOW_ROLE = '--pynn-window-role=';
const ARG_APP_VERSION = '--pynn-app-version=';
const ARG_CALLS_SUPPRESSED = '--pynn-calls-suppressed=';
const ARG_MAC_TOOLBAR = '--pynn-mac-toolbar=';

function readArg(prefix: string): string | null {
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const windowRole = (readArg(ARG_WINDOW_ROLE) ?? 'main') as WindowRole;
const appVersion = readArg(ARG_APP_VERSION) ?? '';

/**
 * The macOS toolbar is a view painted on top of the page, and Electron does not
 * let us shrink the window's own web contents. Pad the page by the same height
 * and shrink full-viewport utilities so the app starts below the buttons.
 */
function installMacToolbarInset(): void {
  const height = Number(readArg(ARG_MAC_TOOLBAR) ?? '');
  if (!Number.isFinite(height) || height <= 0) return;

  const px = `${height}px`;
  const size = `calc(100vh - ${px})`;
  const sizeDvh = `calc(100dvh - ${px})`;
  const breakpoints = [
    { prefix: '', query: '' },
    { prefix: 'sm:', query: '@media (min-width: 640px)' },
    { prefix: 'md:', query: '@media (min-width: 768px)' },
    { prefix: 'lg:', query: '@media (min-width: 1024px)' },
    { prefix: 'xl:', query: '@media (min-width: 1280px)' },
    { prefix: '2xl:', query: '@media (min-width: 1536px)' },
  ];
  const utilities: Array<{ name: string; prop: string; value: string }> = [
    { name: 'h-screen', prop: 'height', value: size },
    { name: 'min-h-screen', prop: 'min-height', value: size },
    { name: 'max-h-screen', prop: 'max-height', value: size },
    { name: 'h-dvh', prop: 'height', value: sizeDvh },
    { name: 'min-h-dvh', prop: 'min-height', value: sizeDvh },
    { name: 'max-h-dvh', prop: 'max-height', value: sizeDvh },
    { name: 'h-svh', prop: 'height', value: size },
    { name: 'min-h-svh', prop: 'min-height', value: size },
    { name: 'max-h-svh', prop: 'max-height', value: size },
  ];

  const widgetTops = ['top-1', 'top-2', 'top-3', 'top-3.5', 'top-4']
    .map((name) => `[class~="fixed"][class~="${name}"] { margin-top: ${px} !important; }`)
    .join('\n');
  /**
   * Side sheets and full-screen overlays are position:fixed against the window,
   * so body padding does not move them. Stretch them between the toolbar and
   * the bottom edge. Rails stay out of this: they are sticky, not inset-y-0.
   */
  const fullBleed = (prefix: string): string => {
    const selectors = [
      `[class~="fixed"][class~="${prefix}inset-0"]`,
      `[class~="fixed"][class~="${prefix}inset-y-0"]`,
      `[class~="fixed"][class~="${prefix}top-0"][class~="${prefix}bottom-0"]`,
    ];
    return `${selectors.join(',\n')} {\n  top: ${px} !important;\n  bottom: 0 !important;\n  height: auto !important;\n}`;
  };
  const rules: string[] = [
    `body { padding-top: ${px} !important; box-sizing: border-box !important; }`,
    widgetTops,
    fullBleed(''),
  ];

  for (const bp of breakpoints) {
    const body = utilities
      .map((util) => `[class~="${bp.prefix}${util.name}"] { ${util.prop}: ${util.value} !important; }`)
      .join('\n');
    const block = bp.prefix ? `${body}\n${fullBleed(bp.prefix)}` : body;
    rules.push(bp.query ? `${bp.query} {\n${block}\n}` : block);
  }

  webFrame.insertCSS(rules.join('\n'));
}

installMacToolbarInset();

/**
 * Google refuses calendar consent when the user agent or client hints mention
 * Electron. The main process also rewrites the request headers; this covers
 * the in-page `navigator` checks. Outlook accepts the same Chrome identity.
 */
function patchOAuthBrowserIdentity(): void {
  if (windowRole !== 'oauth') return;
  const platform =
    process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
  void webFrame.executeJavaScript(`(() => {
    try {
      if (window.__pynnOAuthIdentity) return;
      window.__pynnOAuthIdentity = true;
      const clean = (value) => String(value)
        .replace(/\\sElectron\\/\\S+/g, '')
        .replace(/\\sPynn\\/\\S+/g, '')
        .replace(/\\s{2,}/g, ' ')
        .trim();
      const ua = clean(navigator.userAgent);
      Object.defineProperty(Navigator.prototype, 'userAgent', { configurable: true, get: () => ua });
      const major = (ua.match(/Chrome\\/(\\d+)/) || [])[1] || '0';
      const brands = [
        { brand: 'Chromium', version: major },
        { brand: 'Google Chrome', version: major },
        { brand: 'Not_A Brand', version: '24' },
      ];
      const platformLabel = ${JSON.stringify(platform)};
      const data = {
        brands,
        mobile: false,
        platform: platformLabel,
        toJSON() { return { brands, mobile: false, platform: platformLabel }; },
        getHighEntropyValues() {
          return Promise.resolve({
            brands,
            mobile: false,
            platform: platformLabel,
            architecture: '',
            bitness: '',
            model: '',
            platformVersion: '',
            uaFullVersion: major + '.0.0.0',
            fullVersionList: brands.map((brand) => ({ brand: brand.brand, version: brand.version + '.0.0.0' })),
          });
        },
      };
      Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => data });
    } catch (e) {}
  })();`);
}

patchOAuthBrowserIdentity();

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

  /**
   * Open Talks in a window covering the left 50% of the display.
   * Pass a Talks path such as `/agentic/talks` (query string allowed).
   */
  openTalksWindow: (path?: string) => ipcRenderer.invoke(CHANNEL_TALKS_OPEN, path),

  /** Unread in-app notification count for the dock / taskbar badge. */
  setUnreadCount: (count: number) => ipcRenderer.send(CHANNEL_UNREAD_COUNT, count),

  /**
   * Ask the shell to show a native OS notification. Main skips it when a
   * Pynn window is focused.
   */
  showNotification: (payload: unknown) => ipcRenderer.send(CHANNEL_SHOW_NOTIFICATION, payload),

  /** Open a prompt deeplink in a coding app. Main rejects anything else. */
  openExternal: (url: string) => ipcRenderer.invoke(CHANNEL_OPEN_EXTERNAL, url),
});

// Consumed by the web app's isDesktopApp()/getDesktopAppInfo() helpers.
contextBridge.exposeInMainWorld('__PYNN_DESKTOP__', {
  version: appVersion,
  platform: process.platform,
});

function waitForPromptPaint(): void {
  const until = Date.now() + 16;
  while (Date.now() < until) {
    // Yield to the main process so the modal prompt can render.
  }
}

contextBridge.exposeInMainWorld('__pynnJsDialogs', {
  alert: (message: string) => ipcRenderer.sendSync(CHANNEL_JS_ALERT, message),
  confirm: (message: string) => Boolean(ipcRenderer.sendSync(CHANNEL_JS_CONFIRM, message)),
  prompt: (message: string, defaultValue: string) => {
    const id = ipcRenderer.sendSync(CHANNEL_JS_PROMPT_OPEN, message, defaultValue);
    if (!id) return null;
    for (;;) {
      const state = ipcRenderer.sendSync(CHANNEL_JS_PROMPT_POLL, id) as {
        done?: boolean;
        value?: string | null;
      } | null;
      if (state?.done) return state.value ?? null;
      waitForPromptPaint();
    }
  },
});

function patchPageDialogs(): void {
  void webFrame.executeJavaScript(`
    (() => {
      const api = window.__pynnJsDialogs;
      if (!api || window.__pynnJsDialogsPatched) return;
      window.__pynnJsDialogsPatched = true;
      window.alert = (message) => {
        api.alert(message == null ? '' : String(message));
      };
      window.confirm = (message) => Boolean(api.confirm(message == null ? '' : String(message)));
      window.prompt = (message, defaultValue) => {
        const result = api.prompt(
          message == null ? '' : String(message),
          defaultValue == null ? '' : String(defaultValue),
        );
        return result == null ? null : String(result);
      };
    })();
  `);
}

patchPageDialogs();
process.once('loaded', patchPageDialogs);

/**
 * The hosted web app opens a coding app with location.assign after an async call.
 * Chromium drops that custom-protocol navigation once the click gesture expires,
 * so hand prompt deeplinks to the main process instead.
 */
let cursorAssignPatchQueued = false;

function patchCursorPromptLaunch(): void {
  if (cursorAssignPatchQueued) return;
  cursorAssignPatchQueued = true;
  void webFrame.executeJavaScript(`
    (() => {
      if (window.__pynnCursorAssign) return;
      window.__pynnCursorAssign = true;
      const schemes = [
        'cursor:',
        'vscode:',
        'vscode-insiders:',
        'claude:',
        'windsurf:',
        'windsurf-next:',
        'devin:',
      ];
      const assign = Location.prototype.assign;
      Location.prototype.assign = function (url) {
        const value = url == null ? '' : String(url);
        const openExternal = window.pynnDesktop && window.pynnDesktop.openExternal;
        const scheme = value.slice(0, value.indexOf(':') + 1).toLowerCase();
        if (schemes.indexOf(scheme) !== -1 && openExternal) {
          void Promise.resolve(openExternal(value)).then((opened) => {
            if (!opened) assign.call(this, url);
          });
          return;
        }
        return assign.call(this, url);
      };
    })();
  `).catch(() => {
    cursorAssignPatchQueued = false;
  });
}

patchCursorPromptLaunch();
process.once('loaded', patchCursorPromptLaunch);

export {};
