import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareBuild } from '../scripts/prepare-build.mjs';
import { packServer } from '../scripts/server-bundle.mjs';

test('un dossier de compilation isolé contient aussi les données nécessaires aux tests serveur', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'memeroom-build-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await prepareBuild(process.cwd(), directory);
  for (const entry of [
    'tests/server-bundle.test.mjs',
    'docs/ADMINISTRATION.md',
    'deploy/clamd.conf',
    'Dockerfile',
    'eslint.config.mjs',
  ])
    await access(path.join(directory, entry));
  for (const entry of ['node_modules', '.git', '.env', 'data', 'releases', '.test-artifacts'])
    await assert.rejects(access(path.join(directory, entry)), { code: 'ENOENT' });
  await access(await packServer({ root: directory }));
});
test('Linux et Mac utilisent la même préparation de sources', async () => {
  for (const file of ['build-linux.sh', 'build-mac.sh']) {
    const source = await readFile(`scripts/${file}`, 'utf8');
    assert.match(source, /node "\$source_dir\/scripts\/prepare-build.mjs" "\$build_dir"/);
    assert.doesNotMatch(source, /for entry in/);
  }
});
