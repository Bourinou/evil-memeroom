import { createWriteStream } from 'node:fs';
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { listDownloads } from '../server/releases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const downloads = await listDownloads(path.join(root, 'releases'));
if (
  ['windows', 'linux', 'macArm64', 'macIntel'].some(
    (platform) => downloads[platform]?.version !== version,
  )
)
  throw new Error('Préparez les quatre téléchargements avec npm run stage:releases.');
const zip = new yazl.ZipFile();
async function add(entry) {
  const absolute = path.join(root, entry);
  if ((await stat(absolute)).isDirectory()) {
    for (const child of await readdir(absolute)) await add(`${entry}/${child}`);
  } else zip.addFile(absolute, entry, { compress: !entry.startsWith('releases/') });
}
for (const entry of [
  'server',
  'shared',
  'public',
  'deploy',
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'compose.yaml',
  'compose.nginx.yaml',
  'nginx-location.conf.example',
  'Caddyfile',
  '.env.example',
  '.dockerignore',
  'DEPLOYER.md',
  'LICENSE',
  'AUTHORS.md',
])
  await add(entry);
// Only include this version; older releases already on the server should be kept there.
for (const name of [
  'latest.yml',
  'latest-linux.yml',
  'downloads.json',
  `MemeRoom-Setup-${version}.exe`,
  `MemeRoom-Setup-${version}.exe.blockmap`,
  `MemeRoom-${version}-Linux-x86_64.AppImage`,
  `MemeRoom-${version}-Mac-arm64.zip`,
  `MemeRoom-${version}-Mac-x64.zip`,
])
  await add(`releases/${name}`);
await mkdir(path.join(root, 'release'), { recursive: true });
const output = path.join(root, 'release', `MemeRoom-${version}-Serveur.zip`);
const writing = pipeline(zip.outputStream, createWriteStream(output));
zip.end();
await writing;
console.log(output);
