import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scanClam } from '../server/media-scan.mjs';
import { client, roomFixture } from './helpers/room.mjs';

test('ClamAV réel accepte un PNG, refuse EICAR et ferme les imports si le moteur disparaît', async (t) => {
  if (!process.env.CLAMAV_HOST)
    throw new Error('Définissez CLAMAV_HOST et CLAMAV_PORT pour le moteur de test.');
  let unavailable = false;
  const fixture = await roomFixture(t, {
    scanMedia: (asset) =>
      scanClam(asset.file, unavailable ? { host: '127.0.0.1', port: 1, timeoutMs: 1000 } : {}),
  });
  const owner = await client(fixture.base);
  const room = await owner.request('create', { name: 'Antivirus' });
  const image = await readFile(new URL('../public/icon.png', import.meta.url));
  const upload = (body) =>
    fetch(`${fixture.base}/api/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${room.token}` },
      body,
    });
  const accepted = await upload(image);
  assert.equal(accepted.status, 201);
  const media = await accepted.json();
  assert.deepEqual(
    Buffer.from(await (await fetch(new URL(media.url, fixture.base))).arrayBuffer()),
    image,
  );
  // EICAR's standard signature must begin the file to match the official test definition.
  const eicar = Buffer.from(
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  );
  const eicarFile = path.join(fixture.directory, 'eicar-test.com');
  await writeFile(eicarFile, eicar);
  await assert.rejects(scanClam(eicarFile), { status: 422 });
  const rejected = await upload(eicar);
  assert.equal(rejected.status, 415, await rejected.text());
  unavailable = true;
  const closed = await upload(image);
  assert.equal(closed.status, 503, await closed.text());
  const peer = await client(fixture.base);
  const joined = await peer.request('join', { code: room.code, name: 'Vérification' });
  assert.deepEqual(
    joined.media.map((value) => value.id),
    [media.id],
    'Les fichiers refusés ne sont jamais publiés.',
  );
});
