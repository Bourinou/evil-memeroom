import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import yazl from 'yazl';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const directory = path.resolve(process.argv[2] || 'release/mac');
for (const arch of ['x64', 'arm64']) {
  const root = path.join(directory, arch === 'x64' ? 'mac' : 'mac-arm64');
  const zip = new yazl.ZipFile(); let links = 0;
  async function add(entry) {
    const file = path.join(root, entry), info = await lstat(file);
    const options = { mode:info.mode, mtime:info.mtime };
    if (info.isSymbolicLink()) { links++; zip.addBuffer(Buffer.from(await readlink(file)), entry, { ...options, compress:false }); }
    else if (info.isDirectory()) { zip.addEmptyDirectory(entry, options); for (const child of await readdir(file)) await add(`${entry}/${child}`); }
    else zip.addFile(file, entry, options);
  }
  await add('MemeRoom.app');
  zip.addFile(path.resolve('scripts/Installer MemeRoom.command'), 'Installer MemeRoom.command', { mode:0o100755 });
  zip.addBuffer(Buffer.from('Décompressez le ZIP. Lancez Installer MemeRoom.command à côté de MemeRoom.app.\nCe script installe l’application dans ~/Applications et répare sa signature locale.\nIl demande votre accord et ne désactive pas Gatekeeper pour les autres applications.\nSi macOS bloque le script, utilisez Confidentialité et sécurité > Ouvrir quand même, uniquement pour cette archive de confiance.\nCette version communautaire n’est pas notariée par Apple.\n'), 'INSTALLATION.txt');
  if (!links) throw new Error('Les liens symboliques des frameworks Mac sont absents.');
  const writing = pipeline(zip.outputStream, createWriteStream(path.join(directory, `MemeRoom-${version}-Mac-${arch}.zip`)));
  zip.end(); await writing;
  console.log(`Archive Mac ${arch} : ${links} liens symboliques conservés.`);
}
