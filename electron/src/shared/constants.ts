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
