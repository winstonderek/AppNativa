export const APP_NAME = 'Pynn';
export const APP_ID = 'ai.pynn.desktop';
export const PROTOCOL_SCHEME = 'pynn';

/** GitHub repo that hosts desktop installers and auto-update assets. */
export const GITHUB_UPDATE_OWNER = 'winstonderek';
export const GITHUB_UPDATE_REPO = 'AppNativa';

/**
 * Squirrel.Windows NuGet id — must match MakerSquirrel `name` in forge.config.ts.
 * Start Menu shortcuts get AppUserModelID `com.squirrel.{id}.{exe}`.
 */
export const WINDOWS_SQUIRREL_PACKAGE_ID = 'Pynn';

/** Packaged Windows executable — must match packagerConfig.executableName. */
export const WINDOWS_SQUIRREL_EXE_NAME = 'pynn';

/** AppUserModelID written on Squirrel shortcuts. Toast notifications fail if this mismatches. */
export const WINDOWS_SQUIRREL_APP_ID = `com.squirrel.${WINDOWS_SQUIRREL_PACKAGE_ID}.${WINDOWS_SQUIRREL_EXE_NAME}`;

/** Primary hostname — navigation in the main window stays on this domain and subdomains. */
export const PRIMARY_HOST = 'angelhive.pynn.ai';

/** Override with PYNN_APP_URL to point a local Electron build at another origin. */
export const APP_URL = process.env.PYNN_APP_URL ?? `https://${PRIMARY_HOST}`;

export const DEFAULT_WINDOW_WIDTH = 1440;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

/** The floating call window must fit video, controls, and the local camera PiP. */
export const MIN_CALL_WINDOW_WIDTH = 480;
export const MIN_CALL_WINDOW_HEIGHT = 400;

export type WindowRole = 'main' | 'workspace' | 'call' | 'popup' | 'checkout';

/**
 * Hosted Stripe surfaces that should stay inside the desktop app instead of
 * the system browser. 3DS / bank challenge pages are not listed here — those
 * are allowed only after a checkout window is already open.
 */
export const STRIPE_CHECKOUT_HOSTS = new Set([
  'checkout.stripe.com',
  'billing.stripe.com',
  'pay.stripe.com',
]);

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
  /** Main → screen picker: the list of capturable screens and windows. */
  screenPickerSources: 'pynn:screen-picker-sources',
  /** Screen picker → main: the chosen source id, or null if cancelled. */
  screenPickerResult: 'pynn:screen-picker-result',
  /** Renderer → main (sync): window.alert */
  jsAlert: 'pynn:js-alert',
  /** Renderer → main (sync): window.confirm */
  jsConfirm: 'pynn:js-confirm',
  /** Renderer → main (sync): open a modal prompt window, returns id */
  jsPromptOpen: 'pynn:js-prompt-open',
  /** Renderer → main (sync): poll prompt result */
  jsPromptPoll: 'pynn:js-prompt-poll',
  /** Prompt window → main: submitted value or null */
  jsPromptResult: 'pynn:js-prompt-result',
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
