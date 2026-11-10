const path = require('node:path');
const { signWindowsFile } = require('./scripts/windows-sign.cjs');

const icon = path.join(__dirname, 'assets', 'icon.ico');
const plainSidebar = path.join(__dirname, 'assets', 'nsis', 'installer-sidebar.bmp');
const plainHeader = path.join(__dirname, 'assets', 'nsis', 'installer-header.bmp');

/**
 * Assisted NSIS installer. electron-updater applies updates by re-running this
 * setup in silent mode; it reads the install folder from the uninstall key,
 * so `guid` and `appId` must stay stable.
 *
 * The uninstaller file name is `Uninstall pynn.exe` (executableName). The app
 * uses that file to tell an installed copy from the portable zip.
 *
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'ai.pynn.desktop',
  productName: 'Pynn',
  // Must match packagerConfig.executableName. Shortcuts and the uninstaller
  // (`Uninstall pynn.exe`) are named from this, not from productName.
  executableName: 'pynn',
  npmRebuild: false,
  directories: {
    output: 'out/make/nsis',
  },
  // A publish config makes electron-builder write latest.yml. The make script
  // passes --publish never, so the build does not upload a release itself.
  publish: {
    provider: 'github',
    owner: 'winstonderek',
    repo: 'AppNativa',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon,
    // Forge already signed pynn.exe and the DLLs. Skip resedit so those
    // signatures stay intact. The setup and uninstaller are still signed
    // through signtoolOptions.sign.
    signAndEditExecutable: false,
    signtoolOptions: {
      signingHashAlgorithms: ['sha256'],
      sign: signWindowsFile,
    },
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Pynn',
    uninstallDisplayName: 'Pynn',
    menuCategory: false,
    installerIcon: icon,
    uninstallerIcon: icon,
    // Replace the stock NSIS sidebar and header (the framed tile graphic).
    installerSidebar: plainSidebar,
    uninstallerSidebar: plainSidebar,
    installerHeader: plainHeader,
    installerLanguages: ['en_US'],
    displayLanguageSelector: false,
    // Don't launch the app while the wizard is still open. That startup
    // paints Electron's green splash on top of the installer.
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
    artifactName: 'Pynn-Setup.${ext}',
    guid: '6C8E4F20-9A1B-4D73-8E5F-2B7C0D1A4E93',
  },
};
