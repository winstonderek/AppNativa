/**
 * Windows artifacts: NSIS setup (Pynn-Setup.exe + latest.yml + blockmap) and
 * a portable zip. Forge packages and signs the app; electron-builder only
 * builds the installer. Run via `npm run make:win` so TypeScript is compiled first.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packagedDir = path.join(root, 'out', 'Pynn-win32-x64');
const nsisDir = path.join(root, 'out', 'make', 'nsis');
const setupExe = path.join(nsisDir, 'Pynn-Setup.exe');
const manifestPath = path.join(nsisDir, 'latest.yml');
const zipDir = path.join(root, 'out', 'make', 'zip', 'win32', 'x64');
const zipPath = path.join(zipDir, 'Pynn-win32-x64.zip');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function assertUpdateManifest() {
  if (!fs.existsSync(setupExe)) {
    console.error(`NSIS setup was not produced at ${setupExe}`);
    process.exit(1);
  }
  if (!fs.existsSync(manifestPath)) {
    console.error(`latest.yml was not produced at ${manifestPath}`);
    process.exit(1);
  }

  const manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('Pynn-Setup.exe')) {
    console.error('latest.yml does not reference Pynn-Setup.exe');
    process.exit(1);
  }

  const blockMap = fs.readdirSync(nsisDir).find((name) => name.endsWith('.blockmap'));
  if (!blockMap) {
    console.error(`No .blockmap in ${nsisDir}`);
    process.exit(1);
  }
}

run('npm', ['exec', '--', 'electron-forge', 'package', '--platform=win32', '--arch=x64']);

if (!fs.existsSync(packagedDir)) {
  console.error(`Packaged app not found at ${packagedDir}`);
  process.exit(1);
}

run('npm', [
  'exec',
  '--',
  'electron-builder',
  '--win',
  'nsis',
  '--x64',
  `--prepackaged=${packagedDir}`,
  '--config',
  'electron-builder.config.cjs',
  '--publish',
  'never',
]);
assertUpdateManifest();

fs.mkdirSync(zipDir, { recursive: true });
fs.rmSync(zipPath, { force: true });
run('tar', ['-a', '-c', '-f', zipPath, '-C', packagedDir, '.']);

if (!fs.existsSync(zipPath)) {
  console.error(`Portable zip was not produced at ${zipPath}`);
  process.exit(1);
}

console.log(`Windows setup: ${setupExe}`);
console.log(`Update manifest: ${manifestPath}`);
console.log(`Portable zip: ${zipPath}`);
