import { BrowserWindow, WebContents, ipcMain, screen } from 'electron';
import {
  CONTENT_WINDOW_EDGE_MARGIN,
  CONTENT_WINDOW_SIZES,
  type ContentWindowKind,
  IPC_CHANNELS,
  MIN_CONTENT_WINDOW_HEIGHT,
  MIN_CONTENT_WINDOW_WIDTH,
  MIN_FIT_CONTENT_WINDOW_HEIGHT,
  RIGHT_FLOATING_CONTENT_WINDOWS,
} from '../shared/constants';
import { contentWindowKind, isPrimaryHost, resolveContentWindowUrl, urlForLog } from '../shared/url-utils';
import { logger } from './logger';
import { cascadeBounds, createAppWindow, getMainWindow, getWindowRole } from './window';

/**
 * Chromeless pop-out windows: one email, the composer, a calendar event or a
 * Drive document. The web app asks for one with a path under
 * `/agentic/window/`; opening the same path again focuses the window that
 * already shows it.
 */
const contentWindows = new Map<string, BrowserWindow>();
const windowKinds = new WeakMap<BrowserWindow, ContentWindowKind>();

/** Each further right-floating window steps down and left by this much. */
const FLOAT_STEP = 28;

function isTrustedSender(contents: WebContents): boolean {
  try {
    return isPrimaryHost(new URL(contents.getURL()).hostname);
  } catch {
    return false;
  }
}

function focus(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** Top-right of the anchor's display, stepped so open floats stay visible. */
function rightFloatingBounds(anchor: BrowserWindow | null, width: number, height: number): Electron.Rectangle {
  const display = anchor ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay();
  const { workArea } = display;
  const w = Math.min(width, workArea.width);
  const h = Math.min(height, workArea.height);
  let open = 0;
  for (const window of contentWindows.values()) {
    const kind = windowKinds.get(window);
    if (!window.isDestroyed() && kind && RIGHT_FLOATING_CONTENT_WINDOWS.has(kind)) open += 1;
  }
  const step = (open % 6) * FLOAT_STEP;
  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - w - CONTENT_WINDOW_EDGE_MARGIN - step),
    y: Math.min(workArea.y + CONTENT_WINDOW_EDGE_MARGIN + step, workArea.y + workArea.height - h),
    width: w,
    height: h,
  };
}

function openContentWindow(fromWindow: BrowserWindow | null, url: string): boolean {
  const existing = contentWindows.get(url);
  if (existing && !existing.isDestroyed()) {
    focus(existing);
    return true;
  }

  const kind = contentWindowKind(url);
  const size = CONTENT_WINDOW_SIZES[kind];
  const anchor = fromWindow && !fromWindow.isDestroyed() ? fromWindow : getMainWindow();
  const bounds = RIGHT_FLOATING_CONTENT_WINDOWS.has(kind)
    ? rightFloatingBounds(anchor, size.width, size.height)
    : anchor
      ? cascadeBounds(anchor, size.width, size.height)
      : ({ width: size.width, height: size.height } as Electron.Rectangle);

  const window = createAppWindow({
    role: 'content',
    initialUrl: url,
    bounds,
    minWidth: MIN_CONTENT_WINDOW_WIDTH,
    minHeight: kind === 'event' ? MIN_FIT_CONTENT_WINDOW_HEIGHT : MIN_CONTENT_WINDOW_HEIGHT,
    // Calls ring and run in the app window, never in an email or document.
    callsSuppressed: true,
    becomeMain: false,
  });

  windowKinds.set(window, kind);
  contentWindows.set(url, window);
  window.once('closed', () => {
    if (contentWindows.get(url) === window) contentWindows.delete(url);
  });

  logger.info(`Content window opened: ${urlForLog(url)}`);
  return true;
}

/**
 * Resizes a content window's height to its page content, within the work
 * area below the window's top edge. The width and position stay.
 */
function fitContentWindow(window: BrowserWindow, height: number): void {
  if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return;
  const bounds = window.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  const [contentWidth, contentHeight] = window.getContentSize();
  const frame = bounds.height - contentHeight;
  const room = workArea.y + workArea.height - bounds.y - frame;
  const target = Math.round(Math.max(MIN_FIT_CONTENT_WINDOW_HEIGHT, Math.min(height, room)));
  if (Math.abs(target - contentHeight) < 2) return;
  window.setContentSize(contentWidth, target);
}

export function setupContentWindowHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.contentWindowOpen, (event, path: unknown) => {
    if (!isTrustedSender(event.sender)) return false;
    const url = resolveContentWindowUrl(path);
    if (!url) {
      logger.warn('Rejected content window path');
      return false;
    }
    return openContentWindow(BrowserWindow.fromWebContents(event.sender), url);
  });

  ipcMain.on(IPC_CHANNELS.windowClose, (event) => {
    if (!isTrustedSender(event.sender)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    // Only pop-out windows may close themselves; the app window stays.
    if (!window || window.isDestroyed() || getWindowRole(window) !== 'content') return;
    window.close();
  });

  ipcMain.on(IPC_CHANNELS.contentWindowFit, (event, size: unknown) => {
    if (!isTrustedSender(event.sender)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || getWindowRole(window) !== 'content') return;
    const height = (size as { height?: unknown } | null)?.height;
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return;
    // CSS px to window px: the page may be zoomed.
    fitContentWindow(window, height * event.sender.getZoomFactor());
  });

  logger.debug('Content window handlers configured');
}
