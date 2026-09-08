import { cp, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUILD_FILES } from './source-files.mjs';

export async function prepareBuild(root, destination) {
  await mkdir(destination, { recursive: true });
  if (
    (await realpath(root)) === (await realpath(destination)) ||
    (await readdir(destination)).length
  )
    throw new Error(
      'La destination de compilation doit être un dossier vide distinct des sources.',
    );
  for (const entry of BUILD_FILES)
    await cp(path.join(root, entry), path.join(destination, entry), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage : node scripts/prepare-build.mjs DOSSIER_VIDE');
  await prepareBuild(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    path.resolve(process.argv[2]),
  );
}
