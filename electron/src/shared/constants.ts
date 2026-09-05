export const APP_NAME = 'Pynn';
export const APP_ID = 'ai.pynn.desktop';
export const PROTOCOL_SCHEME = 'pynn';

/** Primary hostname — navigation in the main window stays on this domain and subdomains. */
export const PRIMARY_HOST = 'angelhive.pynn.ai';

/** Override with PYNN_APP_URL to point a local Electron build at another origin. */
export const APP_URL = process.env.PYNN_APP_URL ?? `https://${PRIMARY_HOST}`;

export const DEFAULT_WINDOW_WIDTH = 1440;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

/** The floating call window is a quarter of the display, so its floor is lower. */
export const MIN_CALL_WINDOW_WIDTH = 420;
export const MIN_CALL_WINDOW_HEIGHT = 200;

export type WindowRole = 'main' | 'workspace' | 'call' | 'popup';

export const IPC_CHANNELS = {
  /** Renderer → main: open a floating call window and hand the session over. */
  callOpen: 'pynn:call-open',
  /** Call window → main: read (and consume) the pending LiveKit session. */
  callGetPending: 'pynn:call-get-pending',
  /** Legacy: older web builds signalled that media was already flowing in-place. */
  callConnected: 'pynn:call-connected',
  /** Renderer → main: the call is over, close the floating call window. */
  callEnded: 'pynn:call-ended',
  /** Main → renderer: this window must not render call UI right now. */
  callsSuppressed: 'pynn:calls-suppressed',
  /** Renderer → main: unread in-app notification count for the dock/taskbar badge. */
  unreadCount: 'pynn:unread-count',
  /** Renderer → main: show a native OS notification when the app is in the background. */
  showNotification: 'pynn:show-notification',
} as const;

/** Prefixes for webPreferences.additionalArguments, read synchronously by the sandboxed preload. */
export const ARG_PREFIXES = {
  windowRole: '--pynn-window-role=',
  appVersion: '--pynn-app-version=',
  callsSuppressed: '--pynn-calls-suppressed=',
} as const;

/** Protocols opened via the system default handler (never executed as shell commands). */
export const EXTERNAL_PROTOCOLS = new Set([
  'mailto:',
  'tel:',
  'sms:',
]);

/** Chromium permission types we may grant for the primary domain. */
export const ALLOWED_PERMISSIONS = new Set([
  'media',
  'mediaKeySystem',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'pointerLock',
  'fullscreen',
  'openExternal',
  'clipboard-read',
  'clipboard-write',
  'clipboard-sanitized-write',
  'display-capture',
  'screen-wake-lock',
  'idle-detection',
  'keyboard-lock',
  'window-management',
  'background-sync',
]);

/** Safe web protocols for navigation and external links. */
export const SAFE_WEB_PROTOCOLS = new Set(['https:', 'http:']);
