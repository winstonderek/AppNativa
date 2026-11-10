import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ForgeHookMap } from '@electron-forge/shared-types';

interface UpdateFile {
  url: string;
  sha512: string;
  size: number;
}

function sha512Base64(filePath: string): string {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function toUpdateYaml(version: string, files: UpdateFile[], releaseDate: string): string {
  const primary = files[0];
  if (!primary) {
    throw new Error('Cannot write an update manifest without files');
  }

  const fileLines = files.flatMap((file) => [
    `  - url: ${file.url}`,
    `    sha512: ${file.sha512}`,
    `    size: ${file.size}`,
  ]);

  return [
    `version: ${version}`,
    'files:',
    ...fileLines,
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');
}

function isMacUpdateArtifact(artifact: string): boolean {
  return artifact.endsWith('.zip');
}

/**
 * electron-updater reads latest-mac.yml from the GitHub Release.
 * Electron Forge does not generate it — add it as an extra macOS artifact.
 * Windows latest.yml is written by electron-builder next to Pynn-Setup.exe.
 */
export const generateUpdateManifests: ForgeHookMap['postMake'] = async (
  _config,
  makeResults,
) => {
  if (!makeResults.length || makeResults[0].platform !== 'darwin') return makeResults;

  const version = makeResults[0].packageJSON.version;
  const releaseDate = new Date().toISOString();
  const files: UpdateFile[] = [];

  for (const result of makeResults) {
    for (const artifact of result.artifacts) {
      if (!isMacUpdateArtifact(artifact) || !fs.existsSync(artifact)) continue;

      files.push({
        url: path.basename(artifact),
        sha512: sha512Base64(artifact),
        size: fs.statSync(artifact).size,
      });
    }
  }

  if (!files.length) return makeResults;

  const manifestName = 'latest-mac.yml';
  const firstArtifact = makeResults[0].artifacts[0];
  const manifestDir = firstArtifact
    ? path.dirname(firstArtifact)
    : path.join(process.cwd(), 'out', 'make');
  const manifestPath = path.join(manifestDir, manifestName);

  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(manifestPath, toUpdateYaml(version, files, releaseDate));

  makeResults.push({
    artifacts: [manifestPath],
    platform: makeResults[0].platform,
    arch: makeResults[0].arch,
    packageJSON: makeResults[0].packageJSON,
  });

  return makeResults;
};
