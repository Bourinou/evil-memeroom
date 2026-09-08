import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha512 } from './stage-releases.mjs';
import { downloadFilenames } from '../server/release-platforms.mjs';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const directory = path.resolve(process.argv[2] || 'release/mac'),
  manifest = {};
for (const platform of ['macArm64', 'macIntel']) {
  const filename = downloadFilenames(version)[platform],
    file = path.join(directory, filename);
  manifest[platform] = {
    version,
    filename,
    bytes: (await stat(file)).size,
    sha512: await sha512(file),
  };
}
await writeFile(
  path.join(directory, 'mac-downloads.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
