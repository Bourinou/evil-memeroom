import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { createRoomServer } from '../server/index.mjs';
import { stageReleases } from '../scripts/stage-releases.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'memeroom-releases-'));
  const releasesDir = path.join(directory, 'releases');
  await mkdir(releasesDir);
  const server = createRoomServer({ host: '127.0.0.1', port: 0, dataDir: null, releasesDir });
  const address = await server.start();
  t.after(() => server.stop());
  return { directory, releasesDir, base: `http://127.0.0.1:${address.port}` };
}
test('download page handles unpublished builds and only lists valid local installers', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await (await fetch(f.base + '/api/downloads')).json(), {
    windows: null,
    linux: null,
    macArm64: null,
    macIntel: null,
  });
  assert.match(await (await fetch(f.base + '/telecharger')).text(), /Télécharger l’application/);
  await writeFile(path.join(f.releasesDir, 'MemeRoom-Setup-0.3.0.exe'), 'installer');
  await writeFile(
    path.join(f.releasesDir, 'downloads.json'),
    JSON.stringify({
      windows: { version: '0.3.0', filename: 'MemeRoom-Setup-0.3.0.exe' },
      linux: { version: '0.3.0', filename: '../secret' },
    }),
  );
  const data = await (await fetch(f.base + '/api/downloads')).json();
  assert.equal(data.windows.bytes, 9);
  assert.equal(data.windows.url, '/releases/MemeRoom-Setup-0.3.0.exe');
  assert.equal(data.linux, null);
  const mac = {
    macArm64: { version: '0.4.3', filename: 'MemeRoom-0.4.3-Mac-arm64.zip' },
    macIntel: { version: '0.4.3', filename: 'MemeRoom-0.4.3-Mac-x64.zip' },
  };
  for (const item of Object.values(mac))
    await writeFile(path.join(f.releasesDir, item.filename), 'mac zip');
  await writeFile(path.join(f.releasesDir, 'downloads.json'), JSON.stringify(mac));
  const available = await (await fetch(f.base + '/api/downloads')).json();
  for (const platform of Object.keys(mac)) {
    assert.equal(available[platform].bytes, 7);
    assert.equal((await fetch(f.base + available[platform].url, { method: 'HEAD' })).status, 200);
  }
});
test('release binaries stream exact bytes, HEAD and ranges; metadata is never cached', async (t) => {
  const f = await fixture(t),
    name = 'MemeRoom-Setup-0.3.0.exe';
  await writeFile(path.join(f.releasesDir, name), '0123456789');
  const url = `${f.base}/releases/${name}`;
  const full = await fetch(url);
  assert.equal(await full.text(), '0123456789');
  assert.match(full.headers.get('cache-control'), /immutable/);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  for (const [range, expected] of [
    ['bytes=2-4', '234'],
    ['bytes=-3', '789'],
    ['bytes=8-', '89'],
  ]) {
    const part = await fetch(url, { headers: { range } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), expected);
  }
  for (const range of ['bytes=10-', 'bytes=-0', 'bytes=4-2', 'bytes=0-1,5-6', 'bad'])
    assert.equal((await fetch(url, { headers: { range } })).status, 416);
  await writeFile(path.join(f.releasesDir, 'latest.yml'), 'version: 0.3.0');
  assert.equal(
    (await fetch(f.base + '/releases/latest.yml')).headers.get('cache-control'),
    'no-store',
  );
  for (const name of [
    'downloads.json',
    'secret.txt',
    'MemeRoom-Setup-0.3.0.exe.tmp',
    '..%2fpackage.json',
    'nested/MemeRoom-Setup-0.3.0.exe',
  ])
    assert.equal((await fetch(f.base + '/releases/' + name)).status, 404);
});
test('release symlinks cannot expose a file outside the release directory', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Creating file symlinks requires an elevated Windows privilege; exercised on Linux.');
    return;
  }
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'secret'), 'secret');
  await symlink('../secret', path.join(f.releasesDir, 'MemeRoom-Setup-0.3.0.exe'));
  assert.equal((await fetch(f.base + '/releases/MemeRoom-Setup-0.3.0.exe')).status, 404);
});
test('release staging verifies both hashes before publishing and rejects reused versions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memeroom-staging-'));
  const windowsDir = path.join(root, 'win'),
    linuxDir = path.join(root, 'linux'),
    outputDir = path.join(root, 'out');
  await mkdir(windowsDir);
  await mkdir(linuxDir);
  const exe = 'MemeRoom-Setup-0.3.0.exe',
    appimage = 'MemeRoom-0.3.0-Linux-x86_64.AppImage';
  async function build(dir, filename, manifestName, bytes) {
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    await writeFile(path.join(dir, filename), bytes);
    await writeFile(
      path.join(dir, manifestName),
      yaml.dump({
        version: '0.3.0',
        path: filename,
        sha512,
        files: [{ url: filename, sha512, size: bytes.length }],
      }),
    );
  }
  await build(windowsDir, exe, 'latest.yml', 'windows');
  await writeFile(path.join(windowsDir, exe + '.blockmap'), 'map');
  await build(linuxDir, appimage, 'latest-linux.yml', 'linux');
  const options = { version: '0.3.0', windowsDir, linuxDir, outputDir };
  await writeFile(path.join(linuxDir, appimage), 'corrupt');
  await assert.rejects(stageReleases(options), /modifié ou incomplet/);
  await assert.rejects(readFile(path.join(outputDir, 'latest.yml')), { code: 'ENOENT' });
  await build(linuxDir, appimage, 'latest-linux.yml', 'linux');
  await stageReleases(options);
  await stageReleases(options);
  const downloads = JSON.parse(await readFile(path.join(outputDir, 'downloads.json'), 'utf8'));
  assert.equal(downloads.windows.filename, exe);
  assert.equal(downloads.linux.filename, appimage);
  await build(linuxDir, appimage, 'latest-linux.yml', 'recompiled');
  await assert.rejects(stageReleases(options), /immuable/);
  assert.equal(await readFile(path.join(outputDir, appimage), 'utf8'), 'linux');
});
