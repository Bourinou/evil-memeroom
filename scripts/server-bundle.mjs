import { createWriteStream } from 'node:fs';
import { readFile, readdir, mkdir, lstat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { listDownloads } from '../server/releases.mjs';
import { SERVER_FILES } from './source-files.mjs';

export async function packServer({
  root,
  output,
  includeReleases = false,
  releasesDir = path.join(root, 'releases'),
}) {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  output ||= path.join(root, 'release', `MemeRoom-${version}-Serveur.zip`);
  const entries = [];
  async function add(absolute, name) {
    const info = await lstat(absolute);
    if (info.isSymbolicLink())
      throw new Error(`Lien symbolique interdit dans le livrable : ${name}`);
    if (info.isDirectory()) {
      for (const child of (await readdir(absolute)).sort())
        await add(path.join(absolute, child), `${name}/${child}`);
    } else if (info.isFile()) entries.push({ absolute, name });
  }
  for (const entry of SERVER_FILES) await add(path.join(root, entry), entry);
  if (includeReleases) {
    const downloads = await listDownloads(releasesDir);
    if (!Object.values(downloads).some(Boolean)) throw new Error('Aucun téléchargement préparé.');
    await add(path.join(releasesDir, 'downloads.json'), 'releases/downloads.json');
    for (const [platform, value] of Object.entries(downloads)) {
      if (!value) continue;
      const filename = value.url.slice('/releases/'.length);
      await add(path.join(releasesDir, filename), `releases/${filename}`);
      const optional =
        platform === 'windows'
          ? ['latest.yml', `${filename}.blockmap`]
          : platform === 'linux'
            ? ['latest-linux.yml']
            : [];
      for (const name of optional) {
        try {
          await add(path.join(releasesDir, name), `releases/${name}`);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
  }
  await mkdir(path.dirname(output), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const { absolute, name } of entries)
    zip.addFile(absolute, name, { compress: !name.startsWith('releases/') });
  try {
    const writing = pipeline(zip.outputStream, createWriteStream(output + '.tmp'));
    zip.end();
    await writing;
    await rename(output + '.tmp', output);
    return output;
  } catch (error) {
    zip.outputStream.destroy();
    await rm(output + '.tmp', { force: true });
    throw error;
  }
}
