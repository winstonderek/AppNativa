import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { PublisherGithub } from '@electron-forge/publisher-github';
import path from 'node:path';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Pynn',
    executableName: 'pynn',
    appBundleId: 'ai.pynn.desktop',
    asar: true,
    icon: path.resolve(__dirname, 'assets', 'icon'),
    extendInfo: {
      NSUserNotificationsUsageDescription:
        'Pynn can notify you about messages and activity when the app is in the background.',
      NSUserNotificationAlertStyle: 'alert',
    },
    osxSign: process.env.APPLE_IDENTITY
      ? {
          identity: process.env.APPLE_IDENTITY,
          hardenedRuntime: true,
          'gatekeeper-assess': false,
          entitlements: path.resolve(__dirname, 'entitlements.plist'),
          'entitlements-inherit': path.resolve(__dirname, 'entitlements.plist'),
        }
      : undefined,
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD
        ? {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID!,
          }
        : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'Pynn',
      setupExe: 'Pynn-Setup.exe',
      setupIcon: path.resolve(__dirname, 'assets', 'icon.ico'),
      // Squirrel requires HTTPS iconUrl for shortcuts; set after pushing to GitHub:
      // SQUIRREL_ICON_URL=https://raw.githubusercontent.com/<owner>/<repo>/main/electron/assets/icon.ico
      ...(process.env.SQUIRREL_ICON_URL ? { iconUrl: process.env.SQUIRREL_ICON_URL } : {}),
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerDMG({
      name: 'Pynn',
      icon: path.resolve(__dirname, 'assets', 'icon.icns'),
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: process.env.GITHUB_REPOSITORY_OWNER ?? 'your-org',
        name: process.env.GITHUB_REPOSITORY_NAME ?? 'pynn-desktop',
      },
      draft: true,
    }),
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};

export default config;
