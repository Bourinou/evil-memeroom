import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, copyFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { downloadFilenames } from '../server/release-platforms.mjs';

export async function sha512(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}

export async function stageReleases({ version, windowsDir, linuxDir, macDir, outputDir }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version invalide.');
  const plans = [],
    downloads = {};
  for (const [platform, directory, metadata, filename] of [
    ['windows', windowsDir, 'latest.yml', `MemeRoom-Setup-${version}.exe`],
    ['linux', linuxDir, 'latest-linux.yml', `MemeRoom-${version}-Linux-x86_64.AppImage`],
  ]) {
    const manifest = yaml.load(await readFile(path.join(directory, metadata), 'utf8'));
    const entry = manifest?.files?.find((file) => file.url === filename);
    const source = path.join(directory, filename);
    if (
      manifest?.version !== version ||
      manifest?.path !== filename ||
      manifest?.files?.length !== 1 ||
      !entry
    )
      throw new Error(`${metadata} ne correspond pas à la version ${version}.`);
    const digest = await sha512(source);
    const size = (await stat(source)).size;
    if (digest !== entry.sha512 || digest !== manifest.sha512 || size !== entry.size)
      throw new Error(`Fichier modifié ou incomplet : ${filename}`);
    const binaries = [filename];
    if (platform === 'windows') {
      await stat(`${source}.blockmap`);
      binaries.push(`${filename}.blockmap`);
    }
    plans.push({ directory, metadata, binaries });
    downloads[platform] = { version, filename };
  }
  if (macDir) {
    const metadata = JSON.parse(await readFile(path.join(macDir, 'mac-downloads.json'), 'utf8'));
    const binaries = [];
    for (const platform of ['macArm64', 'macIntel']) {
      const filename = downloadFilenames(version)[platform],
        item = metadata[platform];
      const source = path.join(macDir, filename);
      if (
        item?.version !== version ||
        item?.filename !== filename ||
        item?.sha512 !== (await sha512(source)) ||
        item?.bytes !== (await stat(source)).size
      )
        throw new Error(`Archive Mac modifiée ou incomplète : ${filename}`);
      binaries.push(filename);
      downloads[platform] = { version, filename };
    }
    plans.push({ directory: macDir, binaries });
  }
  // Validate both builds before changing the directory served to clients.
  await mkdir(outputDir, { recursive: true });
  for (const plan of plans)
    for (const name of plan.binaries) {
      const target = path.join(outputDir, name),
        source = path.join(plan.directory, name);
      let existing;
      try {
        existing = await sha512(target);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (existing && existing !== (await sha512(source)))
        throw new Error(`La version publiée est immuable : ${name}. Incrémentez la version.`);
    }
  for (const plan of plans)
    for (const name of plan.binaries) {
      const target = path.join(outputDir, name);
      await copyFile(path.join(plan.directory, name), target + '.tmp');
      await rename(target + '.tmp', target);
    }
  // Clients see each new manifest only after every referenced binary is ready.
  for (const plan of plans) {
    if (!plan.metadata) continue; // Unsigned Mac builds use manual updates.
    const target = path.join(outputDir, plan.metadata);
    await copyFile(path.join(plan.directory, plan.metadata), target + '.tmp');
    await rename(target + '.tmp', target);
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    path.join(outputDir, 'downloads.json.tmp'),
    JSON.stringify(downloads, null, 2) + '\n',
  );
  await rename(path.join(outputDir, 'downloads.json.tmp'), path.join(outputDir, 'downloads.json'));
  return downloads;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const result = await stageReleases({
    version,
    windowsDir: path.resolve(process.argv[2] || path.join(root, `release/build-${version}`)),
    linuxDir: path.resolve(process.argv[3] || path.join(root, 'release')),
    macDir: path.resolve(process.argv[4] || path.join(root, 'release/mac')),
    outputDir: path.join(root, 'releases'),
  });
  console.log('Téléchargements et mises à jour prêts dans releases/', result);
}
