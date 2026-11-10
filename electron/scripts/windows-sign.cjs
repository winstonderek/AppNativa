/**
 * Azure Artifact Signing (formerly Trusted Signing) has no exportable .pfx.
 * CI downloads the signtool dlib, writes metadata.json, and exports:
 *   AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON, SIGNTOOL_PATH
 * When those are absent, Windows builds stay unsigned (or use a .pfx).
 */
function azureWindowsSignOptions() {
  const dlib = process.env.AZURE_CODE_SIGNING_DLIB;
  const metadata = process.env.AZURE_METADATA_JSON;
  if (!dlib || !metadata) return undefined;

  return {
    ...(process.env.SIGNTOOL_PATH ? { signToolPath: process.env.SIGNTOOL_PATH } : {}),
    timestampServer: 'http://timestamp.acs.microsoft.com',
    hashes: ['sha256'],
    // /a makes signtool look for a local cert and ignore the dlib.
    automaticallySelectCertificate: false,
    signWithParams: ['/v', '/debug', '/dlib', dlib, '/dmdf', metadata],
  };
}

/**
 * Sign one file for electron-builder (the NSIS setup and its uninstaller stub).
 * No certificate means a local or branch build: leave the file unsigned.
 */
async function signWindowsFile(configuration) {
  const file = typeof configuration === 'string' ? configuration : configuration?.path;
  if (!file) return;

  const { sign } = require('@electron/windows-sign');
  const azure = azureWindowsSignOptions();
  if (azure) {
    await sign({ ...azure, files: [file] });
    console.log(`Signed ${file}`);
    return;
  }

  const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
  const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
  if (!certificateFile || !certificatePassword) {
    console.log(`Windows signing skipped for ${file}`);
    return;
  }

  await sign({
    certificateFile,
    certificatePassword,
    timestampServer: 'http://timestamp.digicert.com',
    hashes: ['sha256'],
    files: [file],
  });
  console.log(`Signed ${file}`);
}

module.exports = {
  azureWindowsSignOptions,
  signWindowsFile,
};
