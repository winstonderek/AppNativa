export const APP_NAME = 'Pynn';
export const APP_ID = 'ai.pynn.desktop';
export const APP_URL = 'https://angelhive.pynn.ai';
export const PROTOCOL_SCHEME = 'pynn';

/** Primary hostname — navigation in the main window stays on this domain and subdomains. */
export const PRIMARY_HOST = 'angelhive.pynn.ai';

export const DEFAULT_WINDOW_WIDTH = 1440;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

/** Half-screen call layout needs a smaller floor than MIN_WINDOW_WIDTH, or setBounds gets clamped. */
export const MIN_SPLIT_WINDOW_WIDTH = 420;

export type WindowRole = 'main' | 'workspace' | 'popup';

export const IPC_CHANNELS = {
  /** Renderer → main: media is flowing, split the screen. */
  callConnected: 'pynn:call-connected',
  /** Renderer → main: the call is over, tear the split down. */
  callEnded: 'pynn:call-ended',
  /** Main → renderer: this window must not render call UI right now. */
  callsSuppressed: 'pynn:calls-suppressed',
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
