import { contextBridge } from 'electron';
import { APP_NAME } from '../shared/constants';

/**
 * Minimal preload — remote web content must not access Node.js.
 * Only expose non-sensitive desktop metadata when needed by the web app.
 */
contextBridge.exposeInMainWorld('pynnDesktop', {
  platform: process.platform,
  appName: APP_NAME,
  isDesktopApp: true,
});

export {};
